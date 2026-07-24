import * as THREE from "three";

/**
 * importer 模块 — 视角切换、位置/旋转/缩放复位（内存基线，无持久化）
 *
 * 设计：数字孪生前端是后端的实时镜像，设备/零件状态由后端下发，
 * 前端不持久化任何变换状态。复位（reset）只需把每个节点恢复到
 * 加载时的默认局部变换（来自 GLB 自身），基线存于内存 userData._default。
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

  // ======================== 默认变换管理（内存基线 + 复位）=======================
  /**
   * 捕获每个实例（含所有子 mesh/group/Object3D）的默认局部变换到 userData._default。
   * 必须在模型刚加载、尚未被后端/用户改动时调用一次。
   */
  function saveDefaultTransforms() {
    allModelInstances.forEach(function(root) {
      root.traverse(function(node) {
        node.userData._default = {
          pos: { x: node.position.x, y: node.position.y, z: node.position.z },
          rot: { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z },
          scl: { x: node.scale.x, y: node.scale.y, z: node.scale.z },
        };
      });
    });
  }

  /**
   * 复位：把所有实例（含子节点）的局部变换恢复到加载时的默认状态。
   * 不依赖任何持久化数据——默认姿态来自 GLB 自身，重置即「回到出厂」。
   */
  function resetPositions() {
    allModelInstances.forEach(function(root) {
      root.traverse(function(node) {
        const d = node.userData._default;
        if (!d) return;
        node.position.set(d.pos.x, d.pos.y, d.pos.z);
        node.rotation.set(d.rot.x, d.rot.y, d.rot.z);
        node.scale.set(d.scl.x, d.scl.y, d.scl.z);
      });
    });
  }

  /**
   * 为单个（运行时新建的）模型实例捕获其默认局部变换基线到 userData._default。
   * 与 saveDefaultTransforms 的区别：只处理传入的 root 子树，不影响其他已加载模型，
   * 因此可在运行时安全地为 "create" 出来的新模型建立复位基线（回到创建时的位置）。
   */
  function captureDefault(root) {
    if (!root) return;
    root.traverse(function(node) {
      node.userData._default = {
        pos: { x: node.position.x, y: node.position.y, z: node.position.z },
        rot: { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z },
        scl: { x: node.scale.x, y: node.scale.y, z: node.scale.z },
      };
    });
  }

  // ======================== 公开接口 ========================
  return {
    setView,
    updateViewTransition,
    cancelViewTransition,
    saveDefaultTransforms,
    resetPositions,
    captureDefault,
  };
}
