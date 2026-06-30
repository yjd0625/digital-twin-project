import * as THREE from "three";
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// ======================== 位置 / 标签 / 阴影通用逻辑 ========================

/**
 * 对已加载的模型对象应用位置、旋转、标签、阴影等实例级参数
 * @param {THREE.Group} model - 已加载的 GLTF 场景根节点
 * @param {object} options  - position/rotateX/label/labelOffset/scale/autoAlignGround
 * @returns {THREE.Group}
 */
function setupModelInstance(model, options) {
  // 1. 缩放
  const scale = options.scale ?? 1;
  if (scale !== 1) model.scale.set(scale, scale, scale);

  // 2. 旋转（支持更多轴向）
  if (options.rotateX) model.rotation.x = options.rotateX;

  model.updateMatrixWorld(true);

  // 3. 计算局部包围盒，用于位置对齐（居中、落地的核心计算）
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const minY = box.min.y;
  const pos = options.position ?? [0, 0, 0];
  const autoAlignGround = options.autoAlignGround !== undefined ? options.autoAlignGround : true;
  const yOffset = autoAlignGround ? pos[1] - minY : pos[1] - center.y;
  model.position.set(pos[0] - center.x, yOffset, pos[2] - center.z);

  // 位置变更后再次更新矩阵，使世界包围盒准确
  model.updateMatrixWorld(true);

  // 4. 添加标签（CSS2DObject）
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
    const labelOffset = options.labelOffset ?? 0.5;

    // 获取模型在世界空间中的包围盒
    const worldBox = new THREE.Box3().setFromObject(model);
    const worldTopCenter = new THREE.Vector3(
      (worldBox.min.x + worldBox.max.x) / 2,
      worldBox.max.y,               // 世界坐标系下的最高点
      (worldBox.min.z + worldBox.max.z) / 2
    );
    worldTopCenter.y += 0.5;
    model.worldToLocal(worldTopCenter);
    labelObj.position.copy(worldTopCenter);

    model.add(labelObj);
  }

  // 5. 启用阴影
  model.traverse(function(child) {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return model;
}

/** GLTF 加载器工厂（动态 import 避免主包体积膨胀） */
async function createGLTFLoader() {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
  const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('/draco/');
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setDRACOLoader(dracoLoader);

  return loader;
}

/**
 * 加载 GLTF/GLB 文件并返回原始场景根节点（不带实例级设置），
 * 适合需要多次 .clone() 的批量实例化场景
 * @param {string} url  模型 URL
 * @returns {Promise<THREE.Group>} 原始 GLTF scene，可多次 .clone()
 */
export async function loadGLTFTemplate(url) {
  const loader = await createGLTFLoader();
  const gltf = await loader.loadAsync(url);
  return gltf.scene;
}

/**
 * 从模板克隆并创建模型实例，应用位置/旋转/标签/阴影等实例级参数
 * @param {THREE.Group} template   - loadGLTFTemplate 返回的原始模型
 * @param {object}      options    - position/rotateX/label/labelOffset/scale
 * @returns {THREE.Group} 已设置好的新实例（未加入 scene，需调用者 add）
 */
export function createInstanceFromTemplate(template, options) {
  const model = template.clone();             // 深度克隆，共享 geometry/material
  setupModelInstance(model, options);         // 应用实例级参数
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
