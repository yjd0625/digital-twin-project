import * as THREE from "three";
import { createScene } from "./scene.js";
import { createDefaultDevice } from "./models.js";
import { DataHandler } from "./data_handler.js";
import { setupUI } from "./ui.js";

const container = document.body;
const { scene, camera, renderer, labelRenderer, controls } = createScene(container);

const device = createDefaultDevice(scene, { label: "设备 #1" });
const dataHandler = new DataHandler({ cube: device });

let ws;
function connectWebSocket() {
  ws = new WebSocket("ws://localhost:8765");
  ws.onopen = () => {
    console.log("WebSocket connected");
    ui.updateInfo("✓ 已连接到数据源", "rgba(0,200,0,0.7)");
  };
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      dataHandler.process(data);
      const raw = data.value || data.raw || JSON.stringify(data);
      ui.updateInfo("最新数据: " + raw);
    } catch (e) { console.error(e); }
  };
  ws.onclose = () => {
    console.log("Disconnected");
    ui.updateInfo("⛔ 连接断开，正在重连...", "rgba(200,0,0,0.7)");
    setTimeout(connectWebSocket, 3000);
  };
  ws.onerror = (e) => console.error("WS error:", e);
}
function sendCommand(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) { ws.send(msg); }
  else { alert("WebSocket 未连接"); }
}
const ui = setupUI(controls, sendCommand);
connectWebSocket();

window.addEventListener("resize", () => {
  const w = (container.clientWidth || window.innerWidth), h = (container.clientHeight || window.innerHeight);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();

