import * as THREE from 'three';
import { createScene } from './scene.js';
import { createDefaultDevice } from './models.js';
import { DataHandler } from './data_handler.js';
import { setupUI } from './ui.js';

// --- 初始化场景 ---
const container = document.body;
const { scene, camera, renderer, labelRenderer, controls } = createScene(container);

// --- 默认设备 ---
const cube = createDefaultDevice(scene, { label: '设备 #1' });

// --- 数据处理器 ---
const dataHandler = new DataHandler({ cube });

// --- WebSocket 连接 ---
let ws;
function connectWebSocket() {
  ws = new WebSocket('ws://localhost:8765');

  ws.onopen = () => {
    console.log('✅ WebSocket 连接成功');
    ui.updateInfo('✅ 已连接到数据源', 'rgba(0,200,0,0.7)');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      dataHandler.process(data);
      const raw = data.value || data.raw || JSON.stringify(data);
      ui.updateInfo('📊 最新数据:' );
    } catch (e) {
      console.error('解析数据出错:', e);
    }
  };

  ws.onclose = () => {
    console.log('❌ WebSocket 断开，尝试重连...');
    ui.updateInfo('⛔ 连接断开，正在重连...', 'rgba(200,0,0,0.7)');
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket 错误:', error);
  };
}

function sendCommand(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(msg);
  } else {
    alert('WebSocket 未连接');
  }
}

// --- UI 控制 ---
const ui = setupUI(controls, sendCommand);

// --- 启动 WebSocket ---
connectWebSocket();

// --- 窗口自适应 ---
window.addEventListener('resize', () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
});

// --- 动画循环 ---
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
