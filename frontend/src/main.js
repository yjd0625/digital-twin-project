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
        { url: "/models/assembleStation.glb", label: "组装工位", count: 4, positions: [[0,0,0],[4,0,0],[0,0,4],[4,0,4]] },
        { url: "/models/telescopicFork.glb", label: "伸缩叉车", count: 1, positions: [[-4,0,0]] },
        { url: "/models/weldHangingRobot.glb", label: "悬挂焊接机器人", count: 2, positions: [[-4,0,4],[-4,0,-4]] },
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
        loadPositions();
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
let _ctrlDown = false;
function _keyupCtrl(e) { if (e.key === "Control") _ctrlDown = false; }
document.addEventListener("keyup", _keyupCtrl);
const _dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const selectedObjects = [];
const selectionBoxes = {};
function selectObject(obj, multi) {
  if (multi) {
    if (selectedObjects.indexOf(obj) >= 0) {
      if (selectionBoxes[obj.id]) { scene.remove(selectionBoxes[obj.id]); delete selectionBoxes[obj.id]; }
      var i = selectedObjects.indexOf(obj);
      if (i >= 0) selectedObjects.splice(i, 1);
      return;
    }
    selectedObjects.push(obj);
  } else {
    deselectAll();
    selectedObjects.push(obj);
  }
  var bx = new THREE.BoxHelper(obj, 0x00ff00);
  bx.update();
  scene.add(bx);
  selectionBoxes[obj.id] = bx;
}
function deselectAll() {
  for (var k in selectionBoxes) { scene.remove(selectionBoxes[k]); }
  for (var k in selectionBoxes) delete selectionBoxes[k];
  selectedObjects.length = 0;
}
function updateSelectionBoxes() {
  for (var k in selectionBoxes) selectionBoxes[k].update();
}
renderer.domElement.addEventListener("pointerdown", (e) => {
  _ptrDown.x = e.clientX; _ptrDown.y = e.clientY;
    _targetCamPos = null; // user input cancels transition
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
      selectObject(m, _ctrlDown); hit = true; break;
    }
  }
  if (!hit) deselectAll();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Control") { _ctrlDown = true; return; }
  if (e.key === "Delete" && selectedObjects.length) {
    for (var i = selectedObjects.length - 1; i >= 0; i--) {
      var obj = selectedObjects[i];
      obj.traverse(function(ch) { if (ch.isCSS2DObject && ch.element) ch.element.remove(); });
      var idx = allModelInstances.indexOf(obj);
      if (idx >= 0) allModelInstances.splice(idx, 1);
      scene.remove(obj);
      if (dataHandler.objects.cube === obj)
        dataHandler.objects.cube = allModelInstances.length > 0 ? allModelInstances[0] : null;
    }
    deselectAll();
    return;
  }
  if (!selectedObjects.length) return;
  var moved = true;
  switch (e.key) {
    case "ArrowUp":    selectedObjects.forEach(function(o) { o.position.x += MOVE_STEP; }); break;
    case "ArrowDown":  selectedObjects.forEach(function(o) { o.position.x -= MOVE_STEP; }); break;
    case "ArrowLeft":  selectedObjects.forEach(function(o) { o.position.z -= MOVE_STEP; }); break;
    case "ArrowRight": selectedObjects.forEach(function(o) { o.position.z += MOVE_STEP; }); break;
    default: moved = false;
  }
  if (moved) { updateSelectionBoxes(); savePositions(); }
});
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.shiftKey) {
    if (!selectedObjects.length) {
      var r = renderer.domElement.getBoundingClientRect();
      _mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      _mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      _raycaster.setFromCamera(_mouse, camera);
      for (var mi = 0; mi < allModelInstances.length; mi++) {
        if (_raycaster.intersectObject(allModelInstances[mi], true).length > 0) {
          selectObject(allModelInstances[mi], _ctrlDown);
          break;
        }
      }
    }
    if (selectedObjects.length) {
      isDragging = true;
      controls.enabled = false;
    }
  }
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!isDragging || !selectedObjects.length) return;
  const rect = renderer.domElement.getBoundingClientRect();
  _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_mouse, camera);
  const pt = _raycaster.ray.intersectPlane(_dragPlane, new THREE.Vector3());
    if (pt) {
    if (selectedObjects.length) {
      var dx = pt.x - selectedObjects[0].position.x;
      var dz = pt.z - selectedObjects[0].position.z;
      selectedObjects.forEach(function(o) { o.position.x += dx; o.position.z += dz; });
      updateSelectionBoxes();
      savePositions();
    }
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
    // ==== view switching + model import + position persistence ====
    const VIEW_PRESETS = {
      top:     { pos: [0, 15, 0.01], target: [0, 0, 0] },
      front:   { pos: [0, 0, 15],    target: [0, 0, 0] },
      side:    { pos: [15, 0, 0],    target: [0, 0, 0] },
      default: { pos: null,          target: [0, 0, 0] },
    };
    let _targetCamPos = null;
    const _targetCtrlTarget = new THREE.Vector3(0, 0, 0);
    function setView(name) {
      const cfg = VIEW_PRESETS[name]; if (!cfg) return;
      if (name === "default") {
        const b = new THREE.Box3().setFromObject(scene);
        const s = b.getSize(new THREE.Vector3());
        const d = Math.max(Math.max(s.x, s.y, s.z) * 1.5, 5);
        _targetCamPos = new THREE.Vector3(d * 0.6, d * 0.6, d);
      } else _targetCamPos = new THREE.Vector3(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      _targetCtrlTarget.set(cfg.target[0], cfg.target[1], cfg.target[2]);
    }
    function importModelFile(file) {
      const name = file.name;
      const ext = name.split(".").pop().toLowerCase();
      const label = name.replace(/\.[^.]+$/, "");
      function addToScene(obj, sizeY) {
        const div = document.createElement("div");
        div.textContent = label;
        div.style.cssText = "color:white;font:bold 13px Arial;text-shadow:1px 1px 3px rgba(0,0,0,0.8);background:rgba(0,0,0,0.5);padding:2px 8px;border-radius:10px;border:1px solid #00aaff";
        const lbl = new CSS2DObject(div); lbl.position.set(0, sizeY / 2 + 0.5, 0); obj.add(lbl);
        scene.add(obj); allModelInstances.push(obj); selectObject(obj);
        console.log("Imported:", name);
      }
        if (ext === "dxf" || ext === "dwg") {
    var reader = new FileReader();
    reader.onload = function(e) {
      import("dxf-parser").then(function(mod) {
        try {
          var parser = new mod.default();
          var drawing = parser.parseSync(e.target.result);
          if (!drawing.entities || !drawing.entities.length) { console.warn("DXF has no entities"); return; }
          var verts = [];
          var mx = -Infinity, nx = Infinity, my = -Infinity, ny = Infinity;
          function addSeg(x1, y1, x2, y2) { verts.push(x1, y1, 0, x2, y2, 0); if (x1 > mx) mx = x1; if (x1 < nx) nx = x1; if (x2 > mx) mx = x2; if (x2 < nx) nx = x2; if (y1 > my) my = y1; if (y1 < ny) ny = y1; if (y2 > my) my = y2; if (y2 < ny) ny = y2; }
          drawing.entities.forEach(function(ent) {
            try {
              if (ent.type === "LINE" && ent.vertices && ent.vertices.length >= 2) {
                addSeg(ent.vertices[0].x, ent.vertices[0].y, ent.vertices[1].x, ent.vertices[1].y);
              } else if ((ent.type === "LWPOLYLINE" || ent.type === "POLYLINE") && ent.vertices && ent.vertices.length >= 2) {
                for (var vi = 1; vi < ent.vertices.length; vi++) addSeg(ent.vertices[vi-1].x, ent.vertices[vi-1].y, ent.vertices[vi].x, ent.vertices[vi].y);
                if (ent.closed) { var v = ent.vertices; addSeg(v[v.length-1].x, v[v.length-1].y, v[0].x, v[0].y); }
              } else if (ent.type === "CIRCLE" && ent.center && ent.radius) {
                for (var a = 0; a < 64; a++) { var a1 = (a/64)*Math.PI*2, a2 = ((a+1)/64)*Math.PI*2; addSeg(ent.center.x+Math.cos(a1)*ent.radius, ent.center.y+Math.sin(a1)*ent.radius, ent.center.x+Math.cos(a2)*ent.radius, ent.center.y+Math.sin(a2)*ent.radius); }
              } else if (ent.type === "ARC" && ent.center && ent.radius) {
                var sa = (ent.startAngle||0)*Math.PI/180, ea = (ent.endAngle||360)*Math.PI/180;
                for (var i = 0; i < 32; i++) { var a1 = sa+(ea-sa)*(i/32), a2 = sa+(ea-sa)*((i+1)/32); addSeg(ent.center.x+Math.cos(a1)*ent.radius, ent.center.y+Math.sin(a1)*ent.radius, ent.center.x+Math.cos(a2)*ent.radius, ent.center.y+Math.sin(a2)*ent.radius); }
              }
            } catch(e2) {}
          });
          if (!verts.length) { console.warn("DXF no renderable entities"); return; }
          var group = new THREE.Group();
          var geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
          group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x00aaff })));
          var pw = Math.max(mx - nx || 1, 1), ph = Math.max(my - ny || 1, 1);
          var pgeo = new THREE.PlaneGeometry(pw * 1.2, ph * 1.2);
          var pmat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.02, side: THREE.DoubleSide, depthWrite: false });
          var clickPlane = new THREE.Mesh(pgeo, pmat);
          clickPlane.position.set((mx + nx) / 2, (my + ny) / 2, 0);
          group.add(clickPlane);
          var box = new THREE.Box3().setFromObject(group);
          var center = box.getCenter(new THREE.Vector3());
          var size = box.getSize(new THREE.Vector3());
          var maxDim = Math.max(size.x, size.y, size.z);
          var sc = maxDim > 0 ? 3 / maxDim : 1;
          group.rotation.x = -Math.PI / 2;
          group.scale.set(sc, sc, sc);
          group.position.set(-center.x * sc, -box.min.y * sc, -center.z * sc);
          addToScene(group, size.y * sc);
        } catch(e3) { console.error("DXF error:", e3); }
      });
    };
    reader.readAsText(file);
  } else {
        const reader = new FileReader();
        reader.onload = async function() {
          const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
          try {
            const gltf = await (new GLTFLoader()).loadAsync(URL.createObjectURL(file));
            const mdl = gltf.scene;
            const box = new THREE.Box3().setFromObject(mdl);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const sc = maxDim > 0 ? 3 / maxDim : 1;
            mdl.scale.set(sc, sc, sc);
            mdl.position.set(-center.x * sc, -box.min.y * sc, -center.z * sc);
            mdl.traverse(function(ch) { if (ch.isMesh) { ch.castShadow = true; ch.receiveShadow = true; } });
            addToScene(mdl, size.y * sc);
          } catch(e) { console.error(e); }
          URL.revokeObjectURL(reader.result);
        };
        reader.readAsDataURL(file);
      }
    }
    function savePositions() {
      const data = allModelInstances.map(function(m) { return { x: m.position.x, y: m.position.y, z: m.position.z }; });
      localStorage.setItem("dt_model_positions", JSON.stringify(data));
    }
    function loadPositions() {
      const raw = localStorage.getItem("dt_model_positions"); if (!raw) return;
      try {
        const data = JSON.parse(raw);
        allModelInstances.forEach(function(m, i) { if (i < data.length) m.position.set(data[i].x, data[i].y, data[i].z); });
      } catch(e) { console.warn(e); }
    }
const ui = setupUI(controls, sendCommand, { onView: setView, onImport: importModelFile });
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

  // camera view transition
  if (_targetCamPos) {
    camera.position.lerp(_targetCamPos, 0.12);
    controls.target.lerp(_targetCtrlTarget, 0.12);
    if (camera.position.distanceTo(_targetCamPos) < 0.05) _targetCamPos = null;
  }
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





