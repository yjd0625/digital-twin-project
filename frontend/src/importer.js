/**
 * 持久化模块 — 视角切换、位置/旋转/缩放变换持久化（localStorage）
 */

export function initImporter(ctx) {
  const { scene, camera, controls, allModelInstances } = ctx;

  // ======================== 视角切换 ========================
  var VIEW_PRESETS = {
    top:     { pos: [0, 15, 0.01], target: [0, 0, 0] },
    front:   { pos: [0, 0, 15],    target: [0, 0, 0] },
    side:    { pos: [15, 0, 0],    target: [0, 0, 0] },
    default: { pos: null,          target: [0, 0, 0] },
  };
  var _targetCamPos = null;
  var _targetCtrlTarget = new THREE.Vector3(0, 0, 0);

  /** 切换到预设视角 */
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

  /** 在动画循环中调用，平滑过渡到目标视角 */
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

  // ======================== 变换状态持久化（localStorage）=======================
  /** 保存所有模型的位置/旋转/缩放到 localStorage */
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

  /** 从 localStorage 恢复，兼容旧版 dt_model_positions 格式 */
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

  return { setView, updateViewTransition, cancelViewTransition, savePositions, loadPositions };
}
