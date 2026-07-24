import * as THREE from 'three';
import { createScene } from './scene.js';
import { createDefaultDevice, loadGLTFModel } from './models.js';
import { DataHandler } from './data_handler.js';
import { setupUI } from './ui.js';

// --- init scene ---
const container = document.body;
const { scene, camera, renderer, labelRenderer, controls } = createScene(container);

// --- start animation loop immediately, so scene is never blank ---
(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
})();

// --- temporary cube as placeholder ---
let device = createDefaultDevice(scene, { label: '设备 #1' });
const dataHandler = new DataHandler({ cube: device });

// --- load real model in background ---
loadGLTFModel(scene, '/models/assembleStation.glb', { label: '组装工位' })
  .then((model) => {
    scene.remove(device);
    device = model;
    dataHandler.objects.cube = model;
    console.log('3D model loaded: assembleStation.glb');
  })
  .catch((e) => {
    console.warn('Model load failed, showing fallback cube:', e);
  });

// --- WebSocket ---
let ws;
function connectWebSocket() {
  ws = new WebSocket('ws://localhost:8765');

  ws.onopen = () => {
    console.log('WebSocket connected');
    ui.updateInfo('✓ 已连接到数据源', 'rgba(0,200,0,0.7)');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      dataHandler.process(data);
      const raw = data.value || data.raw || JSON.stringify(data);
      ui.updateInfo('最新数据: ' + raw);
    } catch (e) {
      console.error('Parse error:', e);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected, reconnecting...');
    ui.updateInfo('⛔ 连接断开，正在重连...', 'rgba(200,0,0,0.7)');
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

function sendCommand(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(msg);
  } else {
    alert('WebSocket 未连接');
  }
}

const ui = setupUI(controls, sendCommand);
connectWebSocket();

// --- resize ---
window.addEventListener('resize', () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
});
