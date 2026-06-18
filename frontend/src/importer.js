import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

/**
 * 导入与持久化模块 — 模型导入（DXF/GLTF）、视角切换、位置持久化（localStorage + IndexedDB）
 */

export function initImporter(ctx, sel) {
  const { scene, camera, controls, allModelInstances, dataHandler, labelRenderer } = ctx;

  // ======================== IndexedDB（导入文件持久化）===============
  // 通用 IDB 操作：mode = "rw"|"ro", op = "put"|"getAll"|"delete", data = 可选
  function idb(mode, op, data) {
    return new Promise(function(resolve, reject) {
      var r = indexedDB.open("DT_ModelStore", 1);
      r.onupgradeneeded = function() { r.result.createObjectStore("models", { keyPath: "id" }); };
      r.onsuccess = function() {
        var db = r.result;
        var tx = db.transaction("models", mode === "rw" ? "readwrite" : "readonly");
        var store = tx.objectStore("models");
        var req;
        if (op === "put") req = store.put(data);
        else if (op === "getAll") req = store.getAll();
        else if (op === "delete") req = store.delete(data);
        if (req) {
          req.onsuccess = function() { tx.oncomplete = function() { resolve(req.result); db.close(); }; };
          req.onerror = function() { reject(req.error); };
        } else {
          tx.oncomplete = function() { resolve(); db.close(); };
        }
      };
      r.onerror = function() { reject(r.error); };
    });
  }

  function deleteModel(id) { return idb("rw", "delete", id); }

  // ======================== 视角切换 ========================
  var VIEW_PRESETS = {
    top:     { pos: [0, 15, 0.01], target: [0, 0, 0] },
    front:   { pos: [0, 0, 15],    target: [0, 0, 0] },
    side:    { pos: [15, 0, 0],    target: [0, 0, 0] },
    default: { pos: null,          target: [0, 0, 0] },
  };
  var _targetCamPos = null;
  var _targetCtrlTarget = new THREE.Vector3(0, 0, 0);

  function setView(name) {
    var cfg = VIEW_PRESETS[name]; if (!cfg) return;
    if (name === "default") {
      var b = new THREE.Box3().setFromObject(scene);
      var s = b.getSize(new THREE.Vector3());
      var d = Math.max(Math.max(s.x, s.y, s.z) * 1.5, 5);
      _targetCamPos = new THREE.Vector3(d * 0.6, d * 0.6, d);
    } else {
      _targetCamPos = new THREE.Vector3(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    }
    _targetCtrlTarget.set(cfg.target[0], cfg.target[1], cfg.target[2]);
  }

  /** 在动画循环中被调用，平滑过渡到目标视角 */
  function updateViewTransition() {
    if (_targetCamPos) {
      camera.position.lerp(_targetCamPos, 0.12);
      controls.target.lerp(_targetCtrlTarget, 0.12);
      if (camera.position.distanceTo(_targetCamPos) < 0.05) _targetCamPos = null;
    }
  }

  /** 用户操作时取消正在播放的视角动画 */
  function cancelViewTransition() {
    _targetCamPos = null;
  }

  // ======================== 导入模型文件 ========================
  /** 将 DXF 解析为单个 LineSegments + 透明点击平面 */
  function dxfToLineGroup(drawing) {
    if (!drawing.entities || !drawing.entities.length) return null;
    var verts = [];
    var mx = -Infinity, nx = Infinity, my = -Infinity, ny = Infinity;
    function addSeg(x1, y1, x2, y2) {
      verts.push(x1, y1, 0, x2, y2, 0);
      if (x1 > mx) mx = x1; if (x1 < nx) nx = x1;
      if (x2 > mx) mx = x2; if (x2 < nx) nx = x2;
      if (y1 > my) my = y1; if (y1 < ny) ny = y1;
      if (y2 > my) my = y2; if (y2 < ny) ny = y2;
    }
    drawing.entities.forEach(function(ent) {
      try {
        if (ent.type === "LINE" && ent.vertices && ent.vertices.length >= 2) {
          addSeg(ent.vertices[0].x, ent.vertices[0].y, ent.vertices[1].x, ent.vertices[1].y);
        } else if ((ent.type === "LWPOLYLINE" || ent.type === "POLYLINE") && ent.vertices && ent.vertices.length >= 2) {
          for (var vi = 1; vi < ent.vertices.length; vi++) addSeg(ent.vertices[vi-1].x, ent.vertices[vi-1].y, ent.vertices[vi].x, ent.vertices[vi].y);
          if (ent.closed) { var v = ent.vertices; addSeg(v[v.length-1].x, v[v.length-1].y, v[0].x, v[0].y); }
        } else if (ent.type === "CIRCLE" && ent.center && ent.radius) {
          for (var a = 0; a < 64; a++) { var a1 = (a/64)*Math.PI*2, a2 = ((a+1)/64)*Math.PI*2; addSeg(ent.center.x+Math.cos(a1)*ent.radius, ent.center.y+Math.sin(a1)*ent.radius, ent.center.x+Math.cos(a2)*ent.radius, ent.center.y+Math.sin(a2)*ent.radius); }
        } else if (ent.type === "ARC" && ent.center && ent.radius) {
          var sa = (ent.startAngle||0)*Math.PI/180, ea = (ent.endAngle||360)*Math.PI/180;
          for (var i = 0; i < 32; i++) { var a1 = sa+(ea-sa)*(i/32), a2 = sa+(ea-sa)*((i+1)/32); addSeg(ent.center.x+Math.cos(a1)*ent.radius, ent.center.y+Math.sin(a1)*ent.radius, ent.center.x+Math.cos(a2)*ent.radius, ent.center.y+Math.sin(a2)*ent.radius); }
        }
      } catch(e2) {}
    });
    if (!verts.length) return null;
    var group = new THREE.Group();
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x00aaff })));
    // 透明点击面
    var pw = Math.max(mx - nx || 1, 1), ph = Math.max(my - ny || 1, 1);
    var pgeo = new THREE.PlaneGeometry(pw * 1.2, ph * 1.2);
    var pmat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.02, side: THREE.DoubleSide, depthWrite: false });
    var clickPlane = new THREE.Mesh(pgeo, pmat);
    clickPlane.position.set((mx + nx) / 2, (my + ny) / 2, 0);
    group.add(clickPlane);
    return group;
  }

  /** 给模型添加 CSS2D 标签并加入场景 */
  function addToScene(obj, sizeY, label) {
    if (window._nextModelId) { obj.userData.modelId = window._nextModelId; window._nextModelId = null; }
    if (label) {
      var div = document.createElement("div");
      div.textContent = label;
      div.style.cssText = "color:white;font:bold 13px Arial;text-shadow:1px 1px 3px rgba(0,0,0,0.8);background:rgba(0,0,0,0.5);padding:2px 8px;border-radius:10px;border:1px solid #00aaff";
      var lbl = new CSS2DObject(div);
      lbl.position.set(0, sizeY / 2 + 0.5, 0);
      obj.add(lbl);
    }
    scene.add(obj);
    allModelInstances.push(obj);
    if (sel.selectObject) sel.selectObject(obj);
  }

  /** 居中 + 地面对齐 + 自适应缩放 */
  function autoSize(obj) {
    var box = new THREE.Box3().setFromObject(obj);
    var center = box.getCenter(new THREE.Vector3());
    var size = box.getSize(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z);
    var sc = maxDim > 0 ? 3 / maxDim : 1;
    obj.scale.set(sc, sc, sc);
    obj.position.set(-center.x * sc, -box.min.y * sc, -center.z * sc);
    return size.y * sc;
  }

  function importModelFile(file) {
    var name = file.name;
    var ext = name.split(".").pop().toLowerCase();
    var label = name.replace(/\.[^.]+$/, "");

    // DXF / DWG 图纸
    if (ext === "dxf" || ext === "dwg") {
      var reader = new FileReader();
      reader.onload = function(e) {
        var _buf = e.target.result;
        var _txt = new TextDecoder("utf-8").decode(_buf);
        window._nextModelId = "imp_" + Date.now() + "_" + Math.random().toString(36).substr(2,5);
        idb("rw", "put", { id: window._nextModelId, name: name, type: ext, data: _buf });
        import("dxf-parser").then(function(mod) {
          try {
            var drawing = new mod.default().parseSync(_txt);
            var group = dxfToLineGroup(drawing);
            if (!group) { console.warn("DXF has no entities"); return; }
            group.rotation.x = -Math.PI / 2;
            var sizeY = autoSize(group);
            addToScene(group, sizeY, label);
          } catch(e3) { console.error("DXF error:", e3); }
        });
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    // GLTF / GLB 模型
    var reader = new FileReader();
    reader.onload = async function() {
      var _buf = e.target.result;
      var _blob = new Blob([_buf]);
      window._nextModelId = "imp_" + Date.now() + "_" + Math.random().toString(36).substr(2,5);
      idb("rw", "put", { id: window._nextModelId, name: name, type: ext, data: _buf });
      try {
        var { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
        var gltf = await (new GLTFLoader()).loadAsync(URL.createObjectURL(_blob));
        var mdl = gltf.scene;
        mdl.traverse(function(ch) { if (ch.isMesh) { ch.castShadow = true; ch.receiveShadow = true; } });
        var sizeY = autoSize(mdl);
        addToScene(mdl, sizeY, label);
      } catch(e) { console.error("Import error:", e); }
    };
    reader.readAsArrayBuffer(file);
  }

  // ======================== 持久化（变换状态）=======================
  function savePositions() {
    var data = allModelInstances.map(function(m) {
      return {
        pos: { x: m.position.x, y: m.position.y, z: m.position.z },
        rot: { x: m.rotation.x, y: m.rotation.y, z: m.rotation.z },
        scl: { x: m.scale.x, y: m.scale.y, z: m.scale.z },
      };
    });
    localStorage.setItem("dt_model_transforms", JSON.stringify(data));
  }

  function loadPositions() {
    var raw = localStorage.getItem("dt_model_transforms") || localStorage.getItem("dt_model_positions");
    if (!raw) return;
    try {
      var data = JSON.parse(raw);
      allModelInstances.forEach(function(m, i) {
        if (i < data.length) {
          if (data[i].pos) {
            m.position.set(data[i].pos.x, data[i].pos.y, data[i].pos.z);
            if (data[i].rot) m.rotation.set(data[i].rot.x, data[i].rot.y, data[i].rot.z);
            if (data[i].scl) m.scale.set(data[i].scl.x, data[i].scl.y, data[i].scl.z);
          } else {
            m.position.set(data[i].x, data[i].y, data[i].z);
          }
        }
      });
    } catch(e) { console.warn(e); }
  }

  // ======================== 从 IndexedDB 恢复已导入的模型 ========================
  async function loadStoredModels() {
    var entries = await idb("rw", "getAll");
    for (var entry of entries) {
      if (!entry.data) continue;
      try {
        var blob = new Blob([entry.data]);
        var url = URL.createObjectURL(blob);
        if (entry.type === "dxf" || entry.type === "dwg") {
          var text = await new Response(blob).text();
          var mod = await import("dxf-parser");
          var drawing = new mod.default().parseSync(text);
          var group = dxfToLineGroup(drawing);
          if (!group) continue;
          group.userData.modelId = entry.id;
          group.rotation.x = -Math.PI / 2;
          autoSize(group);
          if (sel.deselectAll) { /* just add to scene */ }
          var div = document.createElement("div"); div.textContent = entry.name || "restored DXF";
          div.style.cssText = "color:white;font:bold 13px Arial;text-shadow:1px 1px 3px rgba(0,0,0,0.8);background:rgba(0,0,0,0.5);padding:2px 8px;border-radius:10px;border:1px solid #00aaff";
          group.add(new CSS2DObject(div));
          scene.add(group); allModelInstances.push(group);
        } else {
          var { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
          var gltf = await (new GLTFLoader()).loadAsync(url);
          var mdl = gltf.scene;
          mdl.userData.modelId = entry.id;
          mdl.traverse(function(ch) { if (ch.isMesh) { ch.castShadow = true; ch.receiveShadow = true; } });
          if (entry.transform) {
            var t = entry.transform;
            mdl.position.set(t.pos.x||0, t.pos.y||0, t.pos.z||0);
            mdl.rotation.set(t.rot.x||0, t.rot.y||0, t.rot.z||0);
            mdl.scale.set(t.scl.x||1, t.scl.y||1, t.scl.z||1);
          } else {
            autoSize(mdl);
          }
          var div2 = document.createElement("div"); div2.textContent = entry.name || "restored model";
          div2.style.cssText = "color:white;font:bold 13px Arial;text-shadow:1px 1px 3px rgba(0,0,0,0.8);background:rgba(0,0,0,0.5);padding:2px 8px;border-radius:10px;border:1px solid #00aaff";
          mdl.add(new CSS2DObject(div2));
          scene.add(mdl); allModelInstances.push(mdl);
        }
      } catch(e) { console.warn("Restore failed:", entry.name, e); }
      URL.revokeObjectURL(url);
    }
    loadPositions();
  }

  // ======================== 返回公共接口 ========================
  return {
    setView, updateViewTransition, cancelViewTransition,
    importModelFile, savePositions, loadPositions, loadStoredModels, deleteModel,
  };
}
