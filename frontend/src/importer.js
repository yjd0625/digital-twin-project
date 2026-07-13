import * as THREE from "three";

/**
 * 持久化模块 — 视角切换、位置/旋转/缩放变换持久化（localStorage）
 */

export function initImporter(ctx) {
  const { scene, camera, controls, allModelInstances } = ctx;

  // ======================== 视角切换 ========================
  const VIEW_PRESETS = {
    top:     { pos: [0, 15, 0.01], target: [0, 0, 0] },
    front:   { pos: [0, 0, 15],    target: [0, 0, 0] },
    side:    { pos: [15, 0, 0],    target: [0, 0, 0] },
    default: { pos: null,          target: [0, 0, 0] },
  };
  let _targetCamPos = null;
  const _targetCtrlTarget = new THREE.Vector3(0, 0, 0);

  function setView(name) {
    const cfg = VIEW_PRESETS[name]; if (!cfg) return;
    if (name === "default") {
      const b = new THREE.Box3().setFromObject(scene);
      const s = b.getSize(new THREE.Vector3());
      const d = Math.max(Math.max(s.x, s.y, s.z) * 1.5, 5);
      _targetCamPos = new THREE.Vector3(d * 0.6, d * 0.6, d);
    } else {
      _targetCamPos = new THREE.Vector3(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    }
    _targetCtrlTarget.set(cfg.target[0], cfg.target[1], cfg.target[2]);
  }

  function updateViewTransition() {
    if (_targetCamPos) {
      camera.position.lerp(_targetCamPos, 0.12);
      controls.target.lerp(_targetCtrlTarget, 0.12);
      if (camera.position.distanceTo(_targetCamPos) < 0.05) _targetCamPos = null;
    }
  }

  function cancelViewTransition() {
    _targetCamPos = null;
  }

  // ======================== 变换状态持久化（localStorage）=======================
  /** 保存所有模型的位置/旋转/缩放到 localStorage（按 userData.id 存储） */
  function savePositions() {
    const data = {};
    allModelInstances.forEach(function(m) {
      const id = m.userData.id || "unknown";
      data[id] = {
        pos: { x: m.position.x, y: m.position.y, z: m.position.z },
        rot: { x: m.rotation.x, y: m.rotation.y, z: m.rotation.z },
        scl: { x: m.scale.x, y: m.scale.y, z: m.scale.z },
      };
    });
    localStorage.setItem("dt_model_transforms", JSON.stringify(data));
  }

  /** 从 localStorage 恢复变换状态（按 userData.id 匹配，兼容旧版数组格式） */
  function loadPositions() {
    const raw = localStorage.getItem("dt_model_transforms");
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      // 兼容旧版数组格式
      if (Array.isArray(data)) {
        console.warn("loadPositions: 检测到旧版数组格式，按数组下标恢复");
        allModelInstances.forEach(function(m, i) {
          if (i < data.length && data[i].pos) {
            m.position.set(data[i].pos.x, data[i].pos.y, data[i].pos.z);
            if (data[i].rot) m.rotation.set(data[i].rot.x, data[i].rot.y, data[i].rot.z);
            if (data[i].scl) m.scale.set(data[i].scl.x, data[i].scl.y, data[i].scl.z);
          }
        });
        return;
      }
      // 新版对象格式：按 userData.id 匹配
      allModelInstances.forEach(function(m) {
        const id = m.userData.id || "unknown";
        const entry = data[id];
        if (!entry) return;
        if (entry.pos) {
          m.position.set(entry.pos.x, entry.pos.y, entry.pos.z);
          if (entry.rot) m.rotation.set(entry.rot.x, entry.rot.y, entry.rot.z);
          if (entry.scl) m.scale.set(entry.scl.x, entry.scl.y, entry.scl.z);
        }
      });
    } catch(e) { console.warn("loadPositions error:", e); }
  }

  // ======================== 默认变换管理（复位用）=======================
  let _defaultTransforms = null;

  /** 保存当前所有模型的位置/旋转/缩放作为默认值（复位目标）— 按 userData.id 存储 */
  function saveDefaultTransforms() {
    _defaultTransforms = {};
    allModelInstances.forEach(function(m) {
      const id = m.userData.id || "unknown";
      _defaultTransforms[id] = {
        pos: { x: m.position.x, y: m.position.y, z: m.position.z },
        rot: { x: m.rotation.x, y: m.rotation.y, z: m.rotation.z },
        scl: { x: m.scale.x, y: m.scale.y, z: m.scale.z },
      };
    });
  }

  /** 恢复所有模型到保存的默认变换并持久化 — 按 userData.id 匹配 */
  function resetPositions() {
    if (!_defaultTransforms) return;
    allModelInstances.forEach(function(m) {
      const id = m.userData.id || "unknown";
      const d = _defaultTransforms[id];
      if (!d) return;
      m.position.set(d.pos.x, d.pos.y, d.pos.z);
      m.rotation.set(d.rot.x, d.rot.y, d.rot.z);
      m.scale.set(d.scl.x, d.scl.y, d.scl.z);
    });
    savePositions();
  }

  // ======================== 公开接口 ========================
  return {
    setView,
    updateViewTransition,
    cancelViewTransition,
    savePositions,
    loadPositions,
    saveDefaultTransforms,
    resetPositions,
  };
}
