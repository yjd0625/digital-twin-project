import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

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
  const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
  camera.position.set(5, 5, 10);
  camera.lookAt(0, 0, 0);

  // --- WebGL 渲染器 ---
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
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

  // --- 灯光 ---
  const ambient = new THREE.AmbientLight(0x404060);  // 环境光，物体暗部
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);  // 主光源
  dirLight.position.set(2, 5, 3);
  dirLight.castShadow = true;
  scene.add(dirLight);

  const backLight = new THREE.DirectionalLight(0x4466ff, 0.5);  // 背光补光
  backLight.position.set(-2, 1, -3);
  scene.add(backLight);

  // --- 地面网格（帮助判断空间位置） ---
  const grid = new THREE.GridHelper(10, 20, 0x88aaff, 0x335588);
  grid.position.y = -0.5;
  scene.add(grid);

  return { scene, camera, renderer, labelRenderer, controls };
}
