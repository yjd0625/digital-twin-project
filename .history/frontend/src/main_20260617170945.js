import * as THREE from "three";
import { createScene } from "./scene.js";
import { createDefaultDevice, loadGLTFModel } from "./models.js";
import { DataHandler } from "./data_handler.js";
import { setupUI } from "./ui.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const container = document.body;
const { scene, camera, renderer, labelRenderer, controls } = createScene(container);

// ======================== 左下角固定坐标轴 ========================
const axisScene = new THREE.Scene();
const axisCam = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
const axisDist = 3;
axisCam.position.set(axisDist, axisDist * 0.7, axisDist);
axisCam.lookAt(0, 0, 0);
axisScene.add(new THREE.AxesHelper(1.5));
// axisScene.add(new THREE.GridHelper(3, 3, 0x888888, 0x444444));

// X / Y / Z 文字标签（Sprite）
function makeLabel(text, color) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.font = "Bold 32px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 6;
  ctx.fillText(text, 32, 32);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false })
  );
  sprite.scale.set(0.6, 0.6, 1);
  return sprite;
}
const xLbl = makeLabel("X", "#ff4444"); xLbl.position.set(0.9, 0, 0);  axisScene.add(xLbl);
const yLbl = makeLabel("Y", "#44ff44"); yLbl.position.set(0, 0.9, 0);  axisScene.add(yLbl);
const zLbl = makeLabel("Z", "#4444ff"); zLbl.position.set(0, 0, 0.9);  axisScene.add(zLbl);

const axisRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
axisRenderer.setPixelRatio(window.devicePixelRatio);
axisRenderer.setSize(130, 130);
axisRenderer.domElement.style.position = "absolute";
axisRenderer.domElement.style.bottom = "15px";
axisRenderer.domElement.style.left = "15px";
axisRenderer.domElement.style.pointerEvents = "none";
axisRenderer.domElement.style.zIndex = "1";
axisRenderer.domElement.style.borderRadius = "6px";
document.body.appendChild(axisRenderer.domElement);

// ======================== 占位对象（不可见，仅用于 DataHandler 引用）=======================
let dataDevice = createDefaultDevice(scene, { label: "" });  // 不传 label，不创建标签
dataDevice.visible = false;
const dataHandler = new DataHandler({ cube: dataDevice });

// ======================== 加载真实 3D 模型 ========================
// rotateX: -PI/2 修复 Z-up → Y-up（CAD 导出 vs Three.js 默认）
    // ==== load all 3D models ====
    const allModelInstances = [];
    async function loadAllModels() {
      const configs = [
        { url: "/models/assembleStation.glb", label: "组装工位\u7ec4\u88c5\u5de5\u4f4d", count: 4, positions: [[0,0,0],[4,0,0],[0,0,4],[4,0,4]] },
        { url: "/models/telescopicFork.glb", label: "\u4f38\u7f29\u53c9", count: 1, positions: [[-4,0,0]] },
        { url: "/models/weldHangingRobot.glb", label: "\u710a\u63a5\u673a\u5668\u4eba", count: 2, positions: [[-4,0,4],[-4,0,-4]] },
      ];
      function makeLabel(text) {
        const d = document.createElement("div");
        d.textContent = text;
        Object.assign(d.style, { color: "white", fontFamily: "Arial,sans-serif", fontSize: "13px", fontWeight: "bold",
          textShadow: "1px 1px 3px rgba(0,0,0,0.8)", background: "rgba(0,0,0,0.5)", padding: "2px 8px", borderRadius: "10px", border: "1px solid #00aaff" });
        return new CSS2DObject(d);
      }
      for (const cfg of configs) {
        for (let i = 0; i < cfg.count; i++) {
          const lbl = (cfg.count > 1 ? cfg.label + " #" + (i + 1) : cfg.label);
          const model = await loadGLTFModel(scene, cfg.url, { label: lbl, rotateX: -Math.PI / 2, position: cfg.positions[i], labelOffset: 3 });
          allModelInstances.push(model);
        }
      }
      return allModelInstances;
    }
    loadAllModels()
      .then((instances) => {
        dataHandler.objects.cube = instances[0];
        const allBox = new THREE.Box3().setFromObject(scene);
        const size = allBox.getSize(new THREE.Vector3());
        const center = allBox.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const dist = Math.max(maxDim * 1.5, 5);
        camera.position.set(dist * 0.6, dist * 0.6, dist);
        controls.target.copy(center);
        controls.update();
        console.log("All models loaded:", instances.length);
      })
      .catch((e) => console.warn("Model loading failed:", e));

    // apply data to all model instances
    function applyDataToModels(data) {
      const raw = data.value || data.raw || JSON.stringify(data);
      const val = raw.length / 10;
      const hue = ((raw.length * 10) % 360) / 360;
      allModelInstances.forEach(function(m) {
        m.rotation.x = val;
        m.rotation.y = val * 0.5;
        m.traverse(function(ch) { if (ch.isMesh && ch.material) ch.material.color.setHSL(hue, 0.8, 0.5); });
      });
      ui.updateInfo("\u6700\u65b0\u6570\u636e: " + raw);
    }


// ======================== 模型选择与移动 ========================
const _raycaster = new THREE.Raycaster();
const _mouse = new THREE.Vector2();
let selectedObject = null;
let selectionBox = null;
let isDragging = false;
let _ptrDown = { x: 0, y: 0 };
const MOVE_STEP = 0.1;
const _dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function selectObject(obj) {
  if (selectedObject === obj) return;
  deselectObject();
  selectedObject = obj;
  selectionBox = new THREE.BoxHelper(obj, 0x00ff00);
  selectionBox.update();
  scene.add(selectionBox);
}
function deselectObject() {
  if (selectionBox) { scene.remove(selectionBox); selectionBox = null; }
  selectedObject = null;
}
renderer.domElement.addEventListener("pointerdown", (e) => {
  _ptrDown.x = e.clientX; _ptrDown.y = e.clientY;
});
renderer.domElement.addEventListener("pointerup", (e) => {
  const dx = e.clientX - _ptrDown.x, dy = e.clientY - _ptrDown.y;
  if (Math.sqrt(dx * dx + dy * dy) > 5) return;
  if (!allModelInstances.length) return;
  const rect = renderer.domElement.getBoundingClientRect();
  _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_mouse, camera);
  let hit = false;
  for (const m of allModelInstances) {
    if (_raycaster.intersectObject(m, true).length > 0) {
      selectObject(m); hit = true; break;
    }
  }
  if (!hit) deselectObject();
});
document.addEventListener("keydown", (e) => {
  if (!selectedObject) return;
  let moved = true;
  switch (e.key) {
    case "ArrowUp":    selectedObject.position.x += MOVE_STEP; break;
    case "ArrowDown":  selectedObject.position.x -= MOVE_STEP; break;
    case "ArrowLeft":  selectedObject.position.z -= MOVE_STEP; break;
    case "ArrowRight": selectedObject.position.z += MOVE_STEP; break;
    default: moved = false;
  }
  if (moved && selectionBox) selectionBox.update();
});
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.shiftKey && selectedObject) {
    isDragging = true;
    controls.enabled = false;
  }
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!isDragging || !selectedObject) return;
  const rect = renderer.domElement.getBoundingClientRect();
  _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_mouse, camera);
  const pt = _raycaster.ray.intersectPlane(_dragPlane, new THREE.Vector3());
  if (pt) {
    selectedObject.position.x = pt.x;
    selectedObject.position.z = pt.z;
    if (selectionBox) selectionBox.update();
  }
});
document.addEventListener("pointerup", () => {
  if (isDragging) { isDragging = false; controls.enabled = true; }
});

// ======================== WebSocket 数据通信 ========================
let ws;
function connectWebSocket() {
  ws = new WebSocket("ws://localhost:8765");
  ws.onopen = () => {
    console.log("WebSocket connected");
    ui.updateInfo("\u2713 \u5df2\u8fde\u63a5\u5230\u6570\u636e\u6e90", "rgba(0,200,0,0.7)");
  };
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      applyDataToModels(data);
    } catch (e) { console.error(e); }
  };
  ws.onclose = () => {
    console.log("Disconnected");
    ui.updateInfo("\u26d4 \u8fde\u63a5\u65ad\u5f00\uff0c\u6b63\u5728\u91cd\u8fde...", "rgba(200,0,0,0.7)");
    setTimeout(connectWebSocket, 3000);
  };
  ws.onerror = (e) => console.error("WS error:", e);
}
function sendCommand(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) { ws.send(msg); }
  else { alert("WebSocket \u672a\u8fde\u63a5"); }
}
const ui = setupUI(controls, sendCommand);
connectWebSocket();

// ======================== 窗口尺寸自适应 ========================
window.addEventListener("resize", () => {
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
});

// ======================== 主渲染循环 ========================
const _offset = new THREE.Vector3();  // 复用变量，避免每帧 new
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // \u4f4d\u7f6e\u6cbf\u4e3b\u76f8\u673a\u65b9\u5411\u56fa\u5b9a\u8ddd\u79bb\uff0c\u6bcf\u5e27\u91cd\u65b0\u6307\u5411\u539f\u70b9
  _offset.copy(camera.position).normalize().multiplyScalar(axisDist);
  axisCam.position.copy(_offset);
  axisCam.lookAt(0, 0, 0);

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  axisRenderer.render(axisScene, axisCam);
}
animate();





