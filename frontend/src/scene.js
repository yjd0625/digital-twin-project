import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";
/**
 * 创建 Three.js 场景、相机、灯光、控制器
 * @param {HTMLElement} container - 挂载容器的 DOM 元素
 */
export function createScene(container) {
  // --- 场景 ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111122);  // 深蓝色背景

  // --- 透视相机 ---
  // 用 window.inner 兜底，避免 body 高度为 0 时摄像机比率出错
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100000);
  camera.position.set(5, 5, 5);
  // --- WebGL 渲染器 ---
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;  // 柔和阴影
  container.appendChild(renderer.domElement);

  // --- CSS2D 渲染器（浮动标签） ---
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(w, h);
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.top = "0";
  labelRenderer.domElement.style.left = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  container.appendChild(labelRenderer.domElement);

  // --- 轨道控制器（鼠标拖拽旋转/缩放） ---
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;  // 惯性效果
  controls.dampingFactor = 0.3;  // 惯性阻尼系数

  // --- 灯光 ---
  const ambient = new THREE.AmbientLight(0x404060);  // 环境光，物体暗部
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);  // 主光源
  dirLight.position.set(15, 5, 3);
  dirLight.target.position.set(16, 0, 0);
  dirLight.castShadow = true;
  // 阴影相机配置（覆盖场景范围）
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 10;
  dirLight.shadow.camera.left = -15;
  dirLight.shadow.camera.right = 15; 
  dirLight.shadow.camera.top = 10;
  dirLight.shadow.camera.bottom = -5;
  dirLight.shadow.bias = -0.03;  // 减少阴影瑕疵
  scene.add(dirLight);
  scene.add(dirLight.target);

  const backLight = new THREE.DirectionalLight(0x4466ff, 0.5);  // 背光补光
  backLight.position.set(16, 5, -3);
  backLight.target.position.set(15, 0, 0);
  scene.add(backLight);
  scene.add(backLight.target);

  // 光源调试
  // const gui = new GUI();
  // const shadowFolder = gui.addFolder("Light Settings");
  // shadowFolder.add(dirLight.shadow.camera, 'left').min(-30).max(30).step(0.1).onChange(() => {
  //   dirLight.shadow.camera.updateProjectionMatrix(); // 必须更新！
  //   shadowHelper.update(); // 必须更新辅助线！
  // });
  // shadowFolder.add(dirLight.shadow.camera, 'right').min(-30).max(30).step(0.1).onChange(() => {
  //   dirLight.shadow.camera.updateProjectionMatrix();
  //   shadowHelper.update();
  // });
  // shadowFolder.add(dirLight.shadow.camera, 'top').min(-30).max(30).step(0.1).onChange(() => {
  //   dirLight.shadow.camera.updateProjectionMatrix();
  //   shadowHelper.update();
  // });
  // shadowFolder.add(dirLight.shadow.camera, 'bottom').min(-30).max(30).step(0.1).onChange(() => {
  //   dirLight.shadow.camera.updateProjectionMatrix();
  //   shadowHelper.update();
  // });
  // shadowFolder.add(dirLight.shadow, 'bias').min(-0.1).max(0.1).step(0.01).onChange(() => {
  // });
  // shadowFolder.add(backLight, 'intensity').min(0.1).max(1).step(0.05).onChange(() => {
  // });
  // const shadowHelper = new THREE.CameraHelper(dirLight.shadow.camera);
  // scene.add(shadowHelper);
  
  // --- 地面网格（帮助判断空间位置） ---
  const grid = new THREE.GridHelper(70, 30, 0x88aaff, 0x335588);
  grid.position.y = 0;
  scene.add(grid);

  return { scene, camera, renderer, labelRenderer, controls };
}
