import * as THREE from "three";
import { createScene } from "./scene.js";
import { loadGLTFModel, loadDXFModel } from "./models.js";
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

// ======================== 全局状态 ========================
const allModelInstances = [];

// ======================== 加载初始模型（含 DXF 布局图）=======================
async function loadAllModels() {
  // --- GLTF/GLB 设备模型 ---
  const configs = [
    { url: "/models/assembleStation.glb", label: "组装工位", count: 4, positions: [[5.5,0,-3],[12.5,0,-3],[19.5,0,-3],[26.5,0,-3]] },
    { url: "/models/telescopicFork.glb", label: "伸缩臂", count: 1, positions: [[16,0,-7]] },
    { url: "/models/weldHangingRobot.glb", label: "焊接悬挂机器人", count: 2, positions: [[9,0,-5],[23,0,-5]] },
  ];
  for (const cfg of configs) {
    for (let i = 0; i < cfg.count; i++) {
      const lbl = cfg.count > 1 ? cfg.label + " #" + (i + 1) : cfg.label;
      const model = await loadGLTFModel(scene, cfg.url, { label: lbl, rotateX: -Math.PI / 2, position: cfg.positions[i], labelOffset: 3 });
      // 打印一个组装工位的模型结构
      if (cfg.label === "组装工位" && i === 0) {
        console.log("组装工位模型结构:", model.children);
      }
      model.userData.id = lbl;
      allModelInstances.push(model);
    }
  }

  // --- DXF 产线布局图 ---
  // try {
  //   console.time("DXF load");
  //   const layout = await loadDXFModel(scene, "/models/layout_simplified.dxf", { position: [0, 0, 10], scale: 0.001 });
  //   console.timeEnd("DXF load");
  //   if (layout) allModelInstances.push(layout);
  // } catch(e) { console.warn("DXF layout load failed:", e); }

  return allModelInstances;
}

// ======================== WebSocket 数据通信 ========================
let ws;
function connectWebSocket() {
  ws = new WebSocket("ws://localhost:8765");
  ws.onopen = function() { ui.updateInfo("\u2713 已连接到数据源", "rgba(0,200,0,0.7)"); };
  ws.onmessage = function(event) {
  try { var data = JSON.parse(event.data); dataHandler.process(data); }
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

// ======================== 标签显隐切换 ========================
let _labelsVisible = true;
function toggleLabels() {
  _labelsVisible = !_labelsVisible;
  var btn = document.getElementById('btn-labels');
  if (btn) btn.textContent = _labelsVisible ? '隐藏标签' : '显示标签';
  allModelInstances.forEach(function(m) {
    m.traverse(function(ch) {
      if (ch.isCSS2DObject) {
        ch.visible = _labelsVisible;
        if (ch.element) ch.element.style.display = _labelsVisible ? '' : 'none';
      }
    });
  });
}

// ======================== 初始化 importer / UI / dataHandler ========================
const importerCtx = { scene, camera, controls, allModelInstances };
const importer = initImporter(importerCtx);

const ui = setupUI(controls, sendCommand, { onView: importer.setView, onReset: importer.resetPositions, onToggleLabels: toggleLabels });

const dataHandler = new DataHandler({
  allModelInstances: allModelInstances,
  updateInfo: ui.updateInfo
});

connectWebSocket();

// ======================== 初始化其他模块 ========================
const ctx = { scene, camera, controls, renderer, labelRenderer, allModelInstances, dataHandler };
const interaction = initInteraction(ctx, importer);

// ======================== 加载模型并恢复持久化数据 ========================
loadAllModels()
  .then(async function(instances) {
    dataHandler.objects.cube = instances[0]; 
    var allBox = new THREE.Box3().setFromObject(scene);
    var size = allBox.getSize(new THREE.Vector3());
    var center = allBox.getCenter(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z);
    console.log("Scene size:", size.x.toFixed(1), size.y.toFixed(1), size.z.toFixed(1));
    var dist = Math.min(Math.max(maxDim * 1.5, 5), 300);
    camera.position.set(dist * 0.6, dist * 0.6, dist);
    controls.target.copy(center);
    controls.update();
    importer.saveDefaultTransforms();  // 保存当前位置为默认值（复位用）
    importer.loadPositions();  // 恢复之前保存的变换状态
    console.log("All models loaded:", instances.length);
  })
  .catch(function(e) { console.warn("Model loading failed:", e); });

// ======================== 全局错误捕获（控制台显示在 #info）========================
window.addEventListener("error", function(e) {
  var info = document.getElementById("info");
  if (info) { info.textContent = "JS Error: " + (e.message || e.error); info.style.background = "rgba(200,0,0,0.8)"; }
  console.error("Global error:", e);
});

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
