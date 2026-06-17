import * as THREE from "three";
import { createScene } from "./scene.js";
import { createDefaultDevice, loadGLTFModel } from "./models.js";
import { DataHandler } from "./data_handler.js";
import { setupUI } from "./ui.js";

const container = document.body;
const { scene, camera, renderer, labelRenderer, controls } = createScene(container);

// ======================== 左下角固定坐标轴 ========================
const axisScene = new THREE.Scene();
const axisCam = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
const axisDist = 3;
axisCam.position.set(axisDist, axisDist * 0.7, axisDist);
axisCam.lookAt(0, 0, 0);
axisScene.add(new THREE.AxesHelper(1.5));
axisScene.add(new THREE.GridHelper(3, 3, 0x888888, 0x444444));

// X / Y / Z 文字标签（Sprite）
function makeLabel(text, color) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.font = "Bold 44px Arial";
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
const xLbl = makeLabel("X", "#ff4444"); xLbl.position.set(1.7, 0, 0);  axisScene.add(xLbl);
const yLbl = makeLabel("Y", "#44ff44"); yLbl.position.set(0, 1.7, 0);  axisScene.add(yLbl);
const zLbl = makeLabel("Z", "#4444ff"); zLbl.position.set(0, 0, 1.7);  axisScene.add(zLbl);

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
loadGLTFModel(scene, "/models/assembleStation.glb", {
  label: "\u7ec4\u88c5\u5de5\u4f4d",
  rotateX: -Math.PI / 2,
  // position: [0, 0, 0],     // <-- 模型坐标在此修改
  // labelOffset: 2.5,        // <-- 标签高度在此修改
})
  .then((model) => {
    dataHandler.objects.cube = model;

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = Math.max(maxDim * 1.5, 3);
    camera.position.set(dist * 0.6, dist * 0.6, dist);
    controls.target.set(0, 0, 0);
    controls.update();
    console.log("3D model loaded, maxDim=", maxDim);
  })
  .catch((e) => console.warn("Model load failed, keeping cube:", e));

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
      dataHandler.process(data);
      const raw = data.value || data.raw || JSON.stringify(data);
      ui.updateInfo("\u6700\u65b0\u6570\u636e: " + raw);
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

  // \u53ea\u540c\u6b65\u65cb\u8f6c\uff0c\u4f4d\u7f6e\u56fa\u5b9a\uff08\u53f3\u952e\u5e73\u79fb\u65f6\u8f74\u4e0d\u4f1a\u79fb\u52a8\uff09\r\n  _offset\.copy\(camera\.position\)\.normalize\(\)\.multiplyScalar\(axisDist\);\r\n  axisCam\.position\.copy\(_offset\);
  axisCam.quaternion.copy(camera.quaternion);

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  axisRenderer.render(axisScene, axisCam);
}
animate();


