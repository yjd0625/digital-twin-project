import * as THREE from "three";
import { createScene } from "./scene.js";
import { createDefaultDevice, loadGLTFModel } from "./models.js";
import { DataHandler } from "./data_handler.js";
import { setupUI } from "./ui.js";

const container = document.body;
const { scene, camera, renderer, labelRenderer, controls } = createScene(container);

const device = createDefaultDevice(scene, { label: "\u8bbe\u5907 #1" });
const dataHandler = new DataHandler({ cube: device });

loadGLTFModel(scene, "/models/assembleStation.glb", { label: "\u7ec4\u88c5\u5de5\u4f4d" })
  .then((model) => {
    scene.remove(device);
    dataHandler.objects.cube = model;
    console.log("3D model loaded: assembleStation.glb");
  })
  .catch((e) => console.warn("Model load failed, keeping cube:", e));

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

window.addEventListener("resize", () => {
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
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
