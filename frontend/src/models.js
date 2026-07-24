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

  // 修正朝向（例如 Z-up 旋转到 Y-up）
  if (options.rotateX) model.rotation.x = options.rotateX;
  // 如有需要可添加 rotateY, rotateZ
  model.updateMatrixWorld(true);

  // 计算变换后的包围盒
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const minY = box.min.y;

  // 用户传入的位置（默认 [0,0,0]）
  const pos = options.position ?? [0, 0, 0];
  // 是否自动对齐地面（默认 true）
  const autoAlignGround = options.autoAlignGround !== undefined ? options.autoAlignGround : true;

  let yOffset;
  if (autoAlignGround) {
    // 底座对齐到 pos[1] 高度（通常为0）
    yOffset = pos[1] - minY;
  } else {
    // 原居中逻辑：模型中心对齐到 pos[1]
    yOffset = pos[1] - center.y;
  }
  // 设置位置（x, z 保持中心对齐，y 取决于对齐模式）
  model.position.set(pos[0] - center.x, yOffset, pos[2] - center.z);

  // 添加标签（CSS2DObject）
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
    // 标签偏移：默认在模型顶部上方 0.5 单位，可由 labelOffset 覆盖
    const labelOffset = options.labelOffset ?? (size.y / 2 + 0.5);
    labelObj.position.set(0, 0, labelOffset);
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

/**
 * 从 URL 加载 DXF 图纸，解析为合并的 LineSegments + 透明点击面
 * @param {THREE.Scene} scene
 * @param {string} url    图纸 URL（如 /models/layout.dxf）
 * @param {object} options  { label, position, rotateX }
 * @returns {Promise<THREE.Group>}
 */
export async function loadDXFModel(scene, url, options = {}) {
  var resp = await fetch(url);
  var text = await resp.text();
  var { default: DxfParser } = await import("dxf-parser");
  var drawing = new DxfParser().parseSync(text);
  if (!drawing.entities || !drawing.entities.length) { console.warn("DXF empty:", url); return null; }

  // 合并所有实体为单个 LineSegments（极致的性能优化）
  var verts = [];
  var mx = -Infinity, nx = Infinity, my = -Infinity, ny = Infinity;
  function addSeg(x1, y1, x2, y2) { verts.push(x1, y1, 0, x2, y2, 0); if (x1 > mx) mx = x1; if (x1 < nx) nx = x1; if (x2 > mx) mx = x2; if (x2 < nx) nx = x2; if (y1 > my) my = y1; if (y1 < ny) ny = y1; if (y2 > my) my = y2; if (y2 < ny) ny = y2; }
  drawing.entities.forEach(function(ent) {
    try {
      if (ent.type === "LINE" && ent.vertices && ent.vertices.length >= 2) { addSeg(ent.vertices[0].x, ent.vertices[0].y, ent.vertices[1].x, ent.vertices[1].y); }
      else if ((ent.type === "LWPOLYLINE" || ent.type === "POLYLINE") && ent.vertices && ent.vertices.length >= 2) {
        for (var vi = 1; vi < ent.vertices.length; vi++) addSeg(ent.vertices[vi-1].x, ent.vertices[vi-1].y, ent.vertices[vi].x, ent.vertices[vi].y);
        if (ent.closed) { var v = ent.vertices; addSeg(v[v.length-1].x, v[v.length-1].y, v[0].x, v[0].y); }
      } else if (ent.type === "CIRCLE" && ent.center && ent.radius) {
        for (var a = 0; a < 16; a++) { var a1 = (a/64)*Math.PI*2, a2 = ((a+1)/64)*Math.PI*2; addSeg(ent.center.x+Math.cos(a1)*ent.radius, ent.center.y+Math.sin(a1)*ent.radius, ent.center.x+Math.cos(a2)*ent.radius, ent.center.y+Math.sin(a2)*ent.radius); }
      } else if (ent.type === "ARC" && ent.center && ent.radius) {
        var sa = (ent.startAngle||0)*Math.PI/180, ea = (ent.endAngle||360)*Math.PI/180;
        for (var i=0;i<12;i++) { var a1=sa+(ea-sa)*(i/32), a2=sa+(ea-sa)*((i+1)/32); addSeg(ent.center.x+Math.cos(a1)*ent.radius, ent.center.y+Math.sin(a1)*ent.radius, ent.center.x+Math.cos(a2)*ent.radius, ent.center.y+Math.sin(a2)*ent.radius); }
      }
    } catch(e2) {}
  });
  if (!verts.length) { console.warn("DXF no vertices:", url); return null; }

  var group = new THREE.Group();
  var geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x33ff99 })));

  // 透明点击面（方便选中）
  var pw = Math.max(mx - nx || 1, 1), ph = Math.max(my - ny || 1, 1);
  var pgeo = new THREE.PlaneGeometry(pw , ph);
  var pmat = new THREE.MeshBasicMaterial({ transparent:true, opacity:0.005, side:THREE.DoubleSide });
  var cp = new THREE.Mesh(pgeo, pmat); cp.position.set((mx+nx)/2, (my+ny)/2, 0); group.add(cp);

  // 居中，按 scale 缩放（无参数默认 1，保留原始尺寸）
  var sc = options.scale ?? 1;
  if (sc !== 1) group.scale.set(sc, sc, sc);
  var box = new THREE.Box3().setFromObject(group);
  var center = box.getCenter(new THREE.Vector3());
  var size = box.getSize(new THREE.Vector3());
  var pos = options.position || [0, 0, 0];
  group.position.set(pos[0] - center.x, pos[1] - box.min.y, pos[2] - center.z);
  console.log("DXF bounding box:", size.x.toFixed(1), size.y.toFixed(1), size.z.toFixed(1), "scale:", sc);

  // 图纸旋转：DXF 是 XY 平面，平铺到 XZ 地面
  group.rotation.x = -(options.rotateX || Math.PI / 2);

  // 标签
  if (options.label) {
    var div = document.createElement("div"); div.textContent = options.label;
    div.style.cssText = "color:white;font:bold 13px Arial;text-shadow:1px 1px 3px rgba(0,0,0,0.8);background:rgba(0,0,0,0.5);padding:2px 8px;border-radius:10px;border:1px solid #00aaff";
    var lbl = new CSS2DObject(div); lbl.position.set(0, size.y / 2 + 0.5, 0); group.add(lbl);
  }

  scene.add(group);
  return group;
}