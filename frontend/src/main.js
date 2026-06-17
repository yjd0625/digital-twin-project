import * as THREE from "three";
import { createScene } from "./scene.js";
import { createDefaultDevice, loadGLTFModel } from "./models.js";
import { DataHandler } from "./data_handler.js";
import { setupUI } from "./ui.js";

const container = document.body;
const { scene, camera, renderer, labelRenderer, controls } = createScene(container);

// ======================== 左下角固定坐标轴 ========================
// 独立的场景 + 渲染器，跟随主相机旋转
const axisScene = new THREE.Scene();
const axisCam = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
axisCam.position.set(3, 2, 5);
axisCam.lookAt(0, 0, 0);
axisScene.add(new THREE.AxesHelper(1.5));              // 红X 绿Y 蓝Z
axisScene.add(new THREE.GridHelper(3, 3, 0x888888, 0x444444));

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

// ======================== 数据驱动的设备对象 ========================
// 模型加载前用方块占位，加载后替换为真实模型
let dataDevice = createDefaultDevice(scene, { label: "\u8bbe\u5907 #1" });
const dataHandler = new DataHandler({ cube: dataDevice });

// ======================== 参考方块（始终可见，辅助对比大小） ========================
const refCube = createDefaultDevice(scene, {
  label: "1m\u00b3 \u53c2\u8003",
  position: [2.5, 0, 0],
  color: 0xff8800,
  emissive: 0x662200,
});

// ======================== 加载真实 3D 模型 ========================
loadGLTFModel(scene, "/models/assembleStation.glb", { label: "\u7ec4\u88c5\u5de5\u4f4d" })
  .then((model) => {
    // 隐藏方块，替换数据指向
    dataDevice.visible = false;
    dataHandler.objects.cube = model;

    // 根据模型尺寸自动调整相机距离
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = Math.max(maxDim * 1.5, 3);
    camera.position.set(dist * 0.6, dist * 0.6, dist);
    controls.target.set(0, 0, 0);
    controls.update();

    console.log("3D model loaded: assembleStation.glb, dist=", dist);
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
      dataHandler.process(data);  // 驱动 3D 对象状态变化
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
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // 左下角坐标轴同步主相机旋转
  axisCam.position.copy(camera.position).normalize().multiplyScalar(3);
  axisCam.quaternion.copy(camera.quaternion);

  renderer.render(scene, camera);        // 主场景
  labelRenderer.render(scene, camera);    // 浮动标签
  axisRenderer.render(axisScene, axisCam); // 左下角坐标轴
}
animate();
