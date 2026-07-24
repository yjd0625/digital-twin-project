import * as THREE from 'three';
import { createScene } from './scene.js';
import { loadGLTFModel } from './models.js';
import { DataHandler } from './data_handler.js';
import { setupUI } from './ui.js';

// --- init scene ---
const container = document.body;
const { scene, camera, renderer, labelRenderer, controls } = createScene(container);

// --- load 3D model ---
let device;
try {
  device = await loadGLTFModel(scene, '/models/assembleStation.glb', {
    label: 'assemble station'
  });
  console.log('Model loaded: assembleStation.glb');
} catch (e) {
  console.warn('Failed to load GLTF model, using fallback cube:', e);
  const { createDefaultDevice } = await import('./models.js');
  device = createDefaultDevice(scene, { label: 'Device #1' });
}

// --- data handler ---
const dataHandler = new DataHandler({ cube: device });

// --- WebSocket ---
let ws;
function connectWebSocket() {
  ws = new WebSocket('ws://localhost:8765');

  ws.onopen = () => {
    console.log('WebSocket connected');
    ui.updateInfo('connected to data source', 'rgba(0,200,0,0.7)');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      dataHandler.process(data);
      const raw = data.value || data.raw || JSON.stringify(data);
      ui.updateInfo('latest: ' + raw);
    } catch (e) {
      console.error('Parse error:', e);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected, reconnecting...');
    ui.updateInfo('disconnected, reconnecting...', 'rgba(200,0,0,0.7)');
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
    alert('WebSocket not connected');
  }
}

const ui = setupUI(controls, sendCommand);

connectWebSocket();

window.addEventListener('resize', () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
