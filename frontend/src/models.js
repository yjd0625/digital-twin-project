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

  // 标签
  const div = document.createElement('div');
  div.textContent = label;
  div.style.color = 'white';
  div.style.fontFamily = 'Arial, sans-serif';
  div.style.fontSize = '16px';
  div.style.fontWeight = 'bold';
  div.style.textShadow = '1px 1px 3px rgba(0,0,0,0.8)';
  div.style.background = 'rgba(0,0,0,0.5)';
  div.style.padding = '4px 12px';
  div.style.borderRadius = '12px';
  div.style.border = '1px solid #00aaff';
  const labelObj = new CSS2DObject(div);
  labelObj.position.set(0, 0.8, 0);
  mesh.add(labelObj);

  return mesh;
}

/**
 * 通过 GLTF/GLB 文件加载模型（占位，需要时取消注释）
 */
// export async function loadGLTFModel(scene, url, position = [0, 0, 0]) {
//   const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
//   const loader = new GLTFLoader();
//   const gltf = await loader.loadAsync(url);
//   const model = gltf.scene;
//   model.position.set(...position);
//   scene.add(model);
//   return model;
// }
