import * as THREE from "three";
import { createScene, USE_OUTLINE } from "./scene.js";
import { loadGLTFTemplate, createInstanceFromTemplate, loadDXFModel } from "./models.js";
import { DataHandler } from "./data_handler.js";
import { setupUI } from "./ui.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { initInteraction } from "./interaction.js";
import { initImporter } from "./importer.js";

// ======================== 场景初始化 ========================
console.clear();  // 清空控制台
const container = document.body;
const { scene, camera, renderer, labelRenderer, controls, composer, outlinePass } = createScene(container);

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
  const configs = [
    { url: "/models/TransferRobot.glb", label: "搬运机器人", count: 1, positions: [[15,0,0]], parts: [] },
    { url: "/models/AssembleStation.glb", label: "组装工位", count: 4, positions: [[5.5,0,-3],[12.5,0,-3],[19.5,0,-3],[26.5,0,-3]], parts: ["Bracket", "PositionPin", "LeftSlide", "RightSlide", "Clamp"] },
    { url: "/models/WeldHangingRobot.glb", label: "焊接悬挂机器人", count: 2, positions: [[9,0,-5],[23,0,-5]], parts: [] },
    { url: "/models/Buffer.glb", label: "缓冲区", count: 4, positions: [[6,0,2],[10,0,2],[18,0,2],[22,0,2]], parts: [] },
    // { url: "/models/test.glb", label: "test", count: 1, positions: [[0,0,0]] },
  ];

  // === 第一阶段：每类文件只加载一次，得到模板（共享 geometry/material）===
  const templates = {};
  for (const cfg of configs) {
    const startTime = performance.now();

    templates[cfg.url] = await loadGLTFTemplate(cfg.url);

    const endTime = performance.now();
    if (import.meta.env.DEV) {
      const label = cfg.label || cfg.url;
      console.log(`GLTF loaded: ${label} (${(endTime - startTime).toFixed(2)} ms)`);
    }
  }

  // === 第二阶段：从模板 .clone() 逐个实例化 ===
  for (const cfg of configs) {
    const template = templates[cfg.url];

    for (let i = 0; i < cfg.count; i++) {
      const startTime = performance.now();
      const lbl = cfg.count > 1 ? cfg.label + " #" + (i + 1) : cfg.label;
      const model = createInstanceFromTemplate(template, {
        label: lbl,
        // rotateX: -Math.PI / 2,
        position: cfg.positions[i],
        labelOffset: 3,
      });
      // 提取零件
      if (cfg.parts && cfg.parts.length > 0) {
        const parts = {};
        for (const partName of cfg.parts) {
          const part = model.getObjectByName(partName);
          if (part) {
            parts[partName] = part;
          } else if (import.meta.env.DEV) {
            console.warn(`零件 "${partName}" 在模型 "${cfg.label}" 中未找到`);
          }
        }
      model.userData.parts = parts;
      }

      model.userData.id = lbl;
      scene.add(model);
      allModelInstances.push(model);

      const endTime = performance.now();
      if (import.meta.env.DEV) {
        const label = cfg.label || cfg.url;
        console.log(`Instance created: ${label} (#${i + 1}) (${(endTime - startTime).toFixed(2)} ms)`);
      }
    }
  }

  // --- DXF 产线布局图 ---
  // try {
  //   const startTime = performance.now();
  //   const layout = await loadDXFModel(scene, "/models/layout.dxf", { position: [0, 0, 10], scale: 0.001 });
  //   const endTime = performance.now();
  //   if (import.meta.env.DEV) {
  //     console.log(`DXF loaded: (${(endTime - startTime).toFixed(2)} ms)`);
  //   }
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
  try { const data = JSON.parse(event.data); dataHandler.process(data); }
  catch(e) { console.error(e); }
  };
  ws.onclose = function() {
    ui.updateInfo("\u26d4 连接断开，正在重连...", "rgba(200,0,0,0.7)");
    setTimeout(connectWebSocket, 3000);
  };
  ws.onerror = function(e) { console.error("WS error:", e); };
}
function sendCommand(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) { ws.send(msg); }
  else { alert("WebSocket 未连接"); }
}

// ======================== 标签显隐切换 ========================
let _labelsVisible = true;
function toggleLabels() {
  _labelsVisible = !_labelsVisible;
  const btn = document.getElementById("btn-labels");
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
const interaction = initInteraction(ctx, importer, outlinePass);

// ======================== 加载模型并恢复持久化数据 ========================
loadAllModels()
  .then(async function(instances) {
    dataHandler.objects.cube = instances[0];
    const allBox = new THREE.Box3().setFromObject(scene);
    const size = allBox.getSize(new THREE.Vector3());
    const center = allBox.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    console.log("Scene size:", size.x.toFixed(1), size.y.toFixed(1), size.z.toFixed(1));
    const dist = Math.min(Math.max(maxDim * 0.4, 5), 300);
    camera.position.set(-dist * 0.1 + 5, dist * 0.6, dist);
    controls.target.set(center.x + 15, center.y, center.z);
    controls.update();
    importer.saveDefaultTransforms();
    importer.loadPositions();
    console.log("All models loaded:", instances.length);
  })
  .catch(function(e) { console.warn("Model loading failed:", e); });

// ======================== 全局错误捕获（控制台显示在 #info）========================
window.addEventListener("error", function(e) {
  const info = document.getElementById("info");
  if (info) { info.textContent = "JS Error: " + (e.message || e.error); info.style.background = "rgba(200,0,0,0.8)"; }
  console.error("Global error:", e);
});

// ======================== 窗口尺寸自适应 ========================
window.addEventListener("resize", function() {
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
  if (USE_OUTLINE && composer) {
    composer.setSize(w, h);
    if (outlinePass) outlinePass.resolution.set(w, h);
  }
});

// ======================== 主渲染循环 ========================
const _offset = new THREE.Vector3();
const _clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = _clock.getDelta();
  controls.update();
  importer.updateViewTransition(delta);
  _offset.copy(camera.position).normalize().multiplyScalar(axisDist);
  axisCam.position.copy(_offset); axisCam.lookAt(0, 0, 0);
  if (USE_OUTLINE && composer && outlinePass && outlinePass.selectedObjects.length > 0) composer.render(delta);
  else renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  axisRenderer.render(axisScene, axisCam);
}
animate();
