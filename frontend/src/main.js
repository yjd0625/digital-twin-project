import * as THREE from "three";
import { createScene, USE_OUTLINE } from "./scene.js";
import { loadGLTFTemplate, createInstanceFromTemplate, loadDXFModel } from "./models.js";
import { DataHandler } from "./data_handler.js";
import { setupUI } from "./ui.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { initInteraction } from "./interaction.js";
import { initImporter } from "./importer.js";
import { initHistoryPanel } from "./history_panel.js";

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

// 蓝图缓存：object 名 → 已加载的 GLB 模板（避免重复加载同一文件）
const blueprints = {};

// ======================== 加载初始模型（含 DXF 布局图）=======================
async function loadAllModels() {
  const configs = [
    { url: "/models/TransferRobot.glb", label: "搬运机器人", count: 1, positions: [[15,0,0]], parts: [] },
    { url: "/models/AssembleStation.glb", label: "组装工位", count: 4, positions: [[5.5,0,-3],[12.5,0,-3],[19.5,0,-3],[26.5,0,-3]], parts: ["Bracket", "PositionPin", "LeftSlide", "RightSlide", "Clamp"] },
    { url: "/models/WeldHangingRobot.glb", label: "焊接悬挂机器人", count: 2, positions: [[9,0,-5],[23,0,-5]], parts: ["Z1", "Y1", "Y2", "Z2", "Y3", "Z3"] },
    { url: "/models/Buffer.glb", label: "缓冲区", count: 4, positions: [[6,0,2],[10,0,2],[18,0,2],[22,0,2]], parts: [] },
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
      const lbl = cfg.label + " #" + (i + 1);
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
let reconnectAttempts = 0;   // 连续断线次数，用于指数退避
let wsPingTimer = null;      // 周期心跳定时器
// 后端 REST/WS 基址：与后端 HTTP_PORT(8300) 对齐，改成 8300 以外的端口需同步修改
const API_BASE = `http://${window.location.hostname}:8300`;
function connectWebSocket() {
  // 用当前页面 host 解析后端地址（兼容 dev 与 Docker 发布两种模式）
  ws = new WebSocket(`ws://${window.location.hostname}:8300/ws`);
  ws.onopen = function() {
    reconnectAttempts = 0;   // 连上了 → 重置退避计数
    // 周期心跳：每 15s 发一次 ping，探测中间链路死连接
    if (wsPingTimer) clearInterval(wsPingTimer);
    wsPingTimer = setInterval(function() {
      try { if (ws.readyState === WebSocket.OPEN) ws.send("ping"); } catch (e) { /* 忽略 */ }
    }, 15000);
    ui.updateInfo("\u2713 已连接到数据源", "rgba(0,200,0,0.7)");
  };
  ws.onmessage = function(event) {
    let data = event.data;
    // 心跳回应/空帧忽略（后端不会主动回 ping，这里仅防御）
    if (data === "pong" || data === "ping") return;
    // 防御：若后端误发来双重编码的 JSON 字符串，这里再解析一层
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (e) { /* 保持原样，交给 process 判断 */ }
    }
    // 诊断日志：确认收到的真实类型与 type 字段（排查时看这一行）
    console.log("[WS] onmessage → typeof=" + typeof data +
      " | type=" + ((data && data.type) || "(none)") +
      " | raw=" + String(event.data).slice(0, 200));
    try { if (dataHandler) dataHandler.process(data); }    // 加载完成前不处理数据
    catch (e) { console.error(e); }
  };
  ws.onclose = function() {
    if (wsPingTimer) { clearInterval(wsPingTimer); wsPingTimer = null; }
    ui.updateInfo("\u26d4 连接断开，正在重连...", "rgba(200,0,0,0.7)");
    // 指数退避重连：3s → 6s → 12s → 24s → 封顶 30s，叠加随机抖动避免惊群
    const delay = Math.min(30000, 3000 * Math.pow(2, reconnectAttempts)) + Math.random() * 1000;
    reconnectAttempts++;
    setTimeout(connectWebSocket, delay);
  };
  ws.onerror = function(e) { console.error("WS error:", e); };
}

// ======================== 标签显隐切换 ========================
let _labelsVisible = false;   // 默认不显示设备标签
function applyLabelsVisibility() {
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
function toggleLabels() {
  _labelsVisible = !_labelsVisible;
  applyLabelsVisibility();
}

// ======================== 初始化 importer / UI / dataHandler ========================
const importerCtx = { scene, camera, controls, allModelInstances };
const importer = initImporter(importerCtx);

function resetAll() {
  if (dataHandler) dataHandler.detachAll();          // 先把挂着的物体卸回场景根，避免复位时坐标错位
  if (dataHandler) dataHandler.removeCreatedModels(); // 删除动态创建的模型（初始模型保留）
  importer.resetPositions();
  if (dataHandler) dataHandler.clearActions();
  if (interaction) interaction.deselectAll();
}
const ui = setupUI(controls, { onView: importer.setView, onReset: resetAll, onToggleLabels: toggleLabels });
let dataHandler = null;
let interaction = null;

connectWebSocket();

// ======================== 动态创建模型（响应后端 "create" 指令）========================
/**
 * 后端 "create" 指令的实际建模逻辑，由 DataHandler 通过 ctx.onCreateModel 调用。
 * @param {string}   object   蓝图名，对应 /models/<object>.glb（如 "Part" → /models/Part.glb）
 * @param {number[]} position 放置位置 [x, y, z]
 * @param {object}   opts     { id, parts, scale, rotateX, autoAlignGround }
 */
async function onCreateModel(object, position, opts = {}) {
  const id = opts.id || object;
  // create 语义为「新增」，若同 id 已存在则不替换（避免重复堆叠）
  if (dataHandler && dataHandler.findModelById(id)) {
    console.warn(`[create] 已存在 id="${id}" 的模型，create 仅新增不替换，忽略`);
    return;
  }
  // 1. 获取/加载蓝图模板（同一 object 只加载一次，之后克隆）
  let template;
  try {
    if (!blueprints[object]) {
      console.log(`[create] 首次加载蓝图: /models/${object}.glb`);
      blueprints[object] = await loadGLTFTemplate(`/models/${object}.glb`);
    }
    template = blueprints[object];
  } catch (e) {
    console.error(`[create] 蓝图加载失败 object="${object}":`, e);
    return;
  }
  // 2. 克隆并应用实例级参数（位置 / 贴地居中 / 缩放 / 标签）
  const model = createInstanceFromTemplate(template, {
    position: position || [0, 0, 0],
    label: id,
    autoAlignGround: opts.autoAlignGround !== undefined ? opts.autoAlignGround : true,
    scale: opts.scale !== undefined ? opts.scale : 1,
    rotateX: opts.rotateX,
  });
  model.userData.id = id;
  model.userData.createdByCommand = true;   // 标记为动态创建，复位时删除（初始模型无此标记）
  // 3. 可选：预填零件缓存（加速后续 action/state 按名查找；未给则依赖 getObjectByName）
  if (opts.parts && Array.isArray(opts.parts) && opts.parts.length) {
    const parts = {};
    for (const pn of opts.parts) {
      const p = model.getObjectByName(pn);
      if (p) parts[pn] = p;
      else if (import.meta.env.DEV) console.warn(`[create] 零件 "${pn}" 在 "${object}" 中未找到`);
    }
    model.userData.parts = parts;
  }
  // 4. 加入场景与共享实例数组（interaction / importer 立即可见，可选中/拖拽/复位）
  scene.add(model);
  allModelInstances.push(model);
  // 5. 记录该模型复位基线（回到创建时的位置/姿态）
  importer.captureDefault(model);
  // 6. 登记进 id→模型 查找表，使后续 state/action 能按 id 驱动它
  if (dataHandler) dataHandler.registerModel(id, model);
  // 7. 同步当前标签显隐（默认不显示）
  applyLabelsVisibility();
  console.log(`[create] 已创建模型 id="${id}" object="${object}" @`, position);
}

// ======================== 加载模型（默认状态，后续由后端同步）========================
loadAllModels()
  .then(async function(instances) {
    dataHandler = new DataHandler({
      allModelInstances: instances,
      updateInfo: ui.updateInfo,
      updateSpeed: ui.updateSpeed,
      onCreateModel: onCreateModel,
      scene: scene
    });
    dataHandler.objects.cube = instances[0];
    dataHandler.onResetRequested = resetAll;   // 后端 "reset" 消息触发前端复位
    const ctx = { scene, camera, controls, renderer, labelRenderer, allModelInstances, dataHandler };
    interaction = initInteraction(ctx, importer, outlinePass);

    // 历史数据面板（从后端 /api/history 读 InfluxDB 时序，零依赖 SVG 折线图）
    initHistoryPanel({
      apiBase: `http://${window.location.hostname}:8300`,
      getDevices: () => allModelInstances.map((m) => ({
        id: m.userData.id,
        parts: Object.keys(m.userData.parts || {}),
      })),
      // 场景绑定看板：读当前 3D 选中的模型，供面板「绑定选中设备」一键填入
      getSelectedDevice: () => {
        const id = interaction && interaction.getSelectedId ? interaction.getSelectedId() : null;
        if (!id) return null;
        const m = allModelInstances.find((x) => x.userData.id === id);
        return m ? { id, parts: Object.keys(m.userData.parts || {}) } : null;
      },
    });

    const allBox = new THREE.Box3();
    // 只统计模型实例，排除 GridHelper/灯光/标签等辅助对象（它们会放大包围盒、把相机推远）
    for (const m of allModelInstances) allBox.expandByObject(m);
    const size = allBox.getSize(new THREE.Vector3());
    const center = allBox.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    console.log("Scene size:", size.x.toFixed(1), size.y.toFixed(1), size.z.toFixed(1));
    // 视距经验系数：0.4×最大尺寸，夹在 [5, 300] 之间
    const VIEW_DIST_SCALE = 0.4, VIEW_DIST_MIN = 5, VIEW_DIST_MAX = 300;
    const dist = Math.min(Math.max(maxDim * VIEW_DIST_SCALE, VIEW_DIST_MIN), VIEW_DIST_MAX);
    camera.position.set(-dist * 0.1 + 5, dist * 0.6, dist);
    controls.target.set(center.x, center.y, center.z);
    controls.update();
    // 捕获加载后的默认姿态作为复位基线（纯内存）
    importer.saveDefaultTransforms();
    // 应用标签初始显隐（默认不显示设备标签）
    applyLabelsVisibility();
    // 加载完成后主动拉取后端最近一次 state 快照并应用，
    // 补偿加载窗口内 WebSocket 消息被丢弃导致的初始状态丢失
    fetch(`${API_BASE}/api/state`)
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(resp) {
        if (resp && resp.state && dataHandler) {
          dataHandler.process(resp.state);
          console.log("[sync] 已应用加载后拉取的全量 state 快照");
        } else {
          console.log("[sync] 后端暂无 state 快照（数据源尚未推送）");
        }
      })
      .catch(function(e) { console.warn("[sync] 拉取全量 state 失败（可忽略，等待实时推送）:", e); });
    console.log("All models loaded:", instances.length);
  })
  .catch(function(e) { console.warn("Model loading failed:", e); });

// ======================== 全局错误捕获（控制台显示在 #info）========================
window.addEventListener("error", function(e) {
  // 只更新文本、不覆盖背景：背景颜色由 updateInfo 管理（连接状态语义），
  // 避免 JS 错误后状态栏一直保持红色、误导状态判断
  const info = document.getElementById("info");
  if (info) info.textContent = "JS Error: " + (e.message || e.error);
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
  if (dataHandler) dataHandler.updateAnimations(delta);   // 推进动作指令动画
  if (interaction) interaction.updateSelectionBoxes();    // 选中框跟随动画中的模型
  _offset.copy(camera.position).normalize().multiplyScalar(axisDist);
  axisCam.position.copy(_offset); axisCam.lookAt(0, 0, 0);
  if (USE_OUTLINE && composer && outlinePass && outlinePass.selectedObjects.length > 0) composer.render(delta);
  else renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  axisRenderer.render(axisScene, axisCam);
}
animate();
