import * as THREE from "three";
import { createScene } from "./scene.js";
import { createDefaultDevice, loadGLTFModel, loadDXFModel } from "./models.js";
import { DataHandler } from "./data_handler.js";
import { setupUI } from "./ui.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { initInteraction } from "./interaction.js";
import { initImporter } from "./importer.js";

// ======================== 场景初始化 ========================
const container = document.body;
const { scene, camera, renderer, labelRenderer, controls } = createScene(container);

// ======================== 左下角固定坐标轴 ========================
const axisScene = new THREE.Scene();
const axisCam = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
const axisDist = 3;
axisCam.position.set(axisDist, axisDist * 0.7, axisDist);
axisCam.lookAt(0, 0, 0);
axisScene.add(new THREE.AxesHelper(1.5));

function makeLabel(text, color) {
  const c = document.createElement("canvas"); c.width = 64; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color; ctx.font = "Bold 32px Arial";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6;
  ctx.fillText(text, 32, 32);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  sprite.scale.set(0.6, 0.6, 1);
  return sprite;
}
axisScene.add(makeLabel("X", "#ff4444")); axisScene.children[axisScene.children.length-1].position.set(0.9, 0, 0);
axisScene.add(makeLabel("Y", "#44ff44")); axisScene.children[axisScene.children.length-1].position.set(0, 0.9, 0);
axisScene.add(makeLabel("Z", "#4444ff")); axisScene.children[axisScene.children.length-1].position.set(0, 0, 0.9);

const axisRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
axisRenderer.setPixelRatio(window.devicePixelRatio);
axisRenderer.setSize(130, 130);
axisRenderer.domElement.style.position = "absolute";
axisRenderer.domElement.style.bottom = "15px"; axisRenderer.domElement.style.left = "15px";
axisRenderer.domElement.style.pointerEvents = "none"; axisRenderer.domElement.style.zIndex = "1";
axisRenderer.domElement.style.borderRadius = "6px";
document.body.appendChild(axisRenderer.domElement);

// ======================== DataHandler 占位对象 ========================
const _placeholder = createDefaultDevice(scene, { label: "" });
_placeholder.visible = false;
const dataHandler = new DataHandler({ cube: _placeholder });

// ======================== 加载初始模型（含 DXF 布局图）=======================
const allModelInstances = [];

async function loadAllModels() {
  // --- GLTF/GLB 设备模型 ---
  const configs = [
    { url: "/models/assembleStation.glb", label: "\u7ec4\u88c5\u5de5\u4f4d", count: 4, positions: [[0,0,0],[4,0,0],[0,0,4],[4,0,4]] },
    { url: "/models/telescopicFork.glb", label: "\u4f38\u7f29\u53c9", count: 1, positions: [[-4,0,0]] },
    { url: "/models/weldHangingRobot.glb", label: "\u710a\u63a5\u673a\u5668\u4eba", count: 2, positions: [[-4,0,4],[-4,0,-4]] },
  ];
  for (const cfg of configs) {
    for (let i = 0; i < cfg.count; i++) {
      const lbl = cfg.count > 1 ? cfg.label + " #" + (i + 1) : cfg.label;
      const model = await loadGLTFModel(scene, cfg.url, { label: lbl, rotateX: -Math.PI / 2, position: cfg.positions[i], labelOffset: 3 });
      allModelInstances.push(model);
    }
  }

  // --- DXF 产线布局图 ---
  try {
    const layout = await loadDXFModel(scene, "/models/layout.dxf", { label: "\u4ea7\u7ebf\u5e03\u5c40\u56fe", position: [0, 0, 0] });
    if (layout) allModelInstances.push(layout);
  } catch(e) { console.warn("DXF layout load failed:", e); }
}

// ======================== 数据驱动所有模型 ========================
function applyDataToModels(data) {
  const raw = data.value || data.raw || JSON.stringify(data);
  const val = raw.length / 10;
  const hue = ((raw.length * 10) % 360) / 360;
  allModelInstances.forEach(function(m) {
    m.rotation.x = val; m.rotation.y = val * 0.5;
    m.traverse(function(ch) { if (ch.isMesh && ch.material) ch.material.color.setHSL(hue, 0.8, 0.5); });
  });
  ui.updateInfo("\u6700\u65b0\u6570\u636e: " + raw);
}

// ======================== 初始化各模块 ========================
const ctx = { scene, camera, controls, renderer, labelRenderer, allModelInstances, dataHandler };
const importer = initImporter(ctx);
const interaction = initInteraction(ctx, importer);

// ======================== 加载模型并恢复持久化数据 ========================
loadAllModels()
  .then(async function(instances) {
    dataHandler.objects.cube = instances[0];
    var allBox = new THREE.Box3().setFromObject(scene);
    var size = allBox.getSize(new THREE.Vector3());
    var center = allBox.getCenter(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z);
    var dist = Math.max(maxDim * 1.5, 5);
    camera.position.set(dist * 0.6, dist * 0.6, dist);
    controls.target.copy(center);
    controls.update();
    importer.loadPositions();  // 恢复之前保存的变换状态
    console.log("All models loaded:", instances.length);
  })
  .catch(function(e) { console.warn("Model loading failed:", e); });

// ======================== WebSocket 数据通信 ========================
let ws;
function connectWebSocket() {
  ws = new WebSocket("ws://localhost:8765");
  ws.onopen = function() { ui.updateInfo("\u2713 \u5df2\u8fde\u63a5\u5230\u6570\u636e\u6e90", "rgba(0,200,0,0.7)"); };
  ws.onmessage = function(event) {
    try { var data = JSON.parse(event.data); applyDataToModels(data); }
    catch(e) { console.error(e); }
  };
  ws.onclose = function() {
    ui.updateInfo("\u26d4 \u8fde\u63a5\u65ad\u5f00\uff0c\u6b63\u5728\u91cd\u8fde...", "rgba(200,0,0,0.7)");
    setTimeout(connectWebSocket, 3000);
  };
  ws.onerror = function(e) { console.error("WS error:", e); };
}
function sendCommand(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) { ws.send(msg); }
  else { alert("WebSocket \u672a\u8fde\u63a5"); }
}

// ======================== UI 绑定 ========================
const ui = setupUI(controls, sendCommand, { onView: importer.setView });
connectWebSocket();

// ======================== 窗口尺寸自适应 ========================
window.addEventListener("resize", function() {
  var w = container.clientWidth || window.innerWidth;
  var h = container.clientHeight || window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
});

// ======================== 主渲染循环 ========================
const _offset = new THREE.Vector3();
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  importer.updateViewTransition();  // 视角切换平滑过渡
  _offset.copy(camera.position).normalize().multiplyScalar(axisDist);
  axisCam.position.copy(_offset); axisCam.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  axisRenderer.render(axisScene, axisCam);
}
animate();
