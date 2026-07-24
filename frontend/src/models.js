import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/**
 * 创建或加载 3D 设备对象
 */

// 创建一个默认的立方体设备（无 GLTF 模型时的回退）
export function createDefaultDevice(scene, options = {}) {
  const {
    color = 0x00aaff,
    emissive = 0x004466,
    position = [0, 0, 0],
    label = 'Device #1',
  } = options;

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive,
    roughness: 0.3,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.position.set(...position);
  scene.add(mesh);

  // 标签（label 为空或未传则不创建）
  if (label) {
    const div = document.createElement("div");
    div.textContent = label;
    div.style.color = "white";
    div.style.fontFamily = "Arial, sans-serif";
    div.style.fontSize = "16px";
    div.style.fontWeight = "bold";
    div.style.textShadow = "1px 1px 3px rgba(0,0,0,0.8)";
    div.style.background = "rgba(0,0,0,0.5)";
    div.style.padding = "4px 12px";
    div.style.borderRadius = "12px";
    div.style.border = "1px solid #00aaff";
    const labelObj = new CSS2DObject(div);
    labelObj.position.set(0, 0.8, 0);
    mesh.add(labelObj);
  }

  return mesh;
}

/**
 * 通过 GLTF/GLB 文件加载模型，自动缩放并居中
 * @param {THREE.Scene} scene
 * @param {string} url   模型 URL（如 /models/assembleStation.glb）
 * @param {object} options
 * @param {number[]} options.position  平移位置
 * @param {number}  options.scale      缩放倍率（默认自适应）
 * @param {string}  options.label      设备标签
 * @returns {Promise<THREE.Group>}
 */
export async function loadGLTFModel(scene, url, options = {}) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;

  // 缩放
  const scale = options.scale ?? 1;
  if (scale !== 1) model.scale.set(scale, scale, scale);

  // 修正朝向：某些 CAD 导出的模型是 Z-up，需要旋转到 Y-up
  if (options.rotateX) model.rotation.x = options.rotateX;
  model.updateMatrixWorld(true);

  // 计算边界框（缩放+旋转后）并居中
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  const pos = options.position ?? [0, 0, 0];
  model.position.set(pos[0] - center.x, pos[1] - center.y, pos[2] - center.z);

  // 添加标签
  if (options.label) {
    const div = document.createElement("div");
    div.textContent = options.label;
    div.style.color = "white";
    div.style.fontFamily = "Arial, sans-serif";
    div.style.fontSize = "16px";
    div.style.fontWeight = "bold";
    div.style.textShadow = "1px 1px 3px rgba(0,0,0,0.8)";
    div.style.background = "rgba(0,0,0,0.5)";
    div.style.padding = "4px 12px";
    div.style.borderRadius = "12px";
    div.style.border = "1px solid #00aaff";
    const labelObj = new CSS2DObject(div);
    labelObj.position.set(0, options.labelOffset ?? size.y / 2 + 0.5, 0);
    model.add(labelObj);
  }

  // 启用阴影
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  scene.add(model);
  return model;
}
