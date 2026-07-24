import * as THREE from "three";
import { USE_OUTLINE } from "./scene.js";
/**
 * 交互模块 — 模型选择、拖拽移动、键盘快捷键（旋转/缩放/删除）
 */

export function initInteraction(ctx, importer, outlinePass) {
  const { scene, camera, controls, renderer, allModelInstances, dataHandler } = ctx;

  // ======================== 选择状态 ========================
  const _raycaster = new THREE.Raycaster();
  const _mouse = new THREE.Vector2();
  let selectedObject = null;
  let selectionBox = null;
  let isDragging = false;
  let _ptrDown = { x: 0, y: 0 };
  const MOVE_STEP = 0.1;
  const ROT_STEP = Math.PI / 12;
  const _dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let _ctrlDown = false;

  const selectedObjects = [];
  let selectionBoxes = {};

  // Ctrl 键释放时清除状态
  document.addEventListener("keyup", function _keyup(e) {
    if (e.key === "Control") _ctrlDown = false;
  });

  // ======================== 选择操作 ========================
  function selectObject(obj, multi) {
    if (multi) {
      const idx = selectedObjects.indexOf(obj);
      if (idx >= 0) {
        const box = selectionBoxes[obj.id];
        if (box) { scene.remove(box); delete selectionBoxes[obj.id]; }
        // 根据配置移除高亮轮廓
        if (USE_OUTLINE && outlinePass) {
          const idx2 = outlinePass.selectedObjects.indexOf(obj);
          if (idx2 >= 0) outlinePass.selectedObjects.splice(idx2, 1);
        }
        selectedObjects.splice(idx, 1);
        return;
      }
      selectedObjects.push(obj);
    } else {
      deselectAll();
      selectedObjects.push(obj);
    }
    if (USE_OUTLINE && outlinePass) {
      if (!outlinePass.selectedObjects.includes(obj)) outlinePass.selectedObjects.push(obj);
    }else {let bx = new THREE.BoxHelper(obj, 0x00ff00);
          bx.update();
          scene.add(bx);
          selectionBoxes[obj.id] = bx;
    }
  }
  function deselectAll() {
    for (let k in selectionBoxes) { scene.remove(selectionBoxes[k]); }
    selectionBoxes = {};
    if (USE_OUTLINE && outlinePass) outlinePass.selectedObjects = [];
    selectedObjects.length = 0;
  }

  function updateSelectionBoxes() {
    for (let k in selectionBoxes) selectionBoxes[k].update();
  }

  // ======================== 点击检测（选中/取消选中）=======================
  renderer.domElement.addEventListener("pointerdown", function _pd1(e) {
    _ptrDown.x = e.clientX; _ptrDown.y = e.clientY;
    importer.cancelViewTransition(); // 用户操作打断视角动画
  });

  renderer.domElement.addEventListener("pointerup", function _pu1(e) {
    let dx = e.clientX - _ptrDown.x, dy = e.clientY - _ptrDown.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) return; // 是拖拽，不是点击
    if (!allModelInstances.length) return;

    let rect = renderer.domElement.getBoundingClientRect();
    _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_mouse, camera);

    let hit = false;
    for (let i = 0; i < allModelInstances.length; i++) {
      if (_raycaster.intersectObject(allModelInstances[i], true).length > 0) {
        selectObject(allModelInstances[i], _ctrlDown);
        hit = true; break;
      }
    }
    if (!hit) deselectAll();
  });

  // ======================== 键盘快捷键 ========================
  // 按键 → 动作映射表（比 switch 更简洁）
  const KEY_ACTIONS = {};
  KEY_ACTIONS["ArrowUp"]    = function(o) { o.position.x += MOVE_STEP; };
  KEY_ACTIONS["ArrowDown"]  = function(o) { o.position.x -= MOVE_STEP; };
  KEY_ACTIONS["ArrowLeft"]  = function(o) { o.position.z -= MOVE_STEP; };
  KEY_ACTIONS["ArrowRight"] = function(o) { o.position.z += MOVE_STEP; };
  KEY_ACTIONS["q"] = KEY_ACTIONS["Q"] = function(o) { o.rotation.y -= ROT_STEP; };
  KEY_ACTIONS["e"] = KEY_ACTIONS["E"] = function(o) { o.rotation.y += ROT_STEP; };
  KEY_ACTIONS["a"] = KEY_ACTIONS["A"] = function(o) { o.rotation.x -= ROT_STEP; };
  KEY_ACTIONS["d"] = KEY_ACTIONS["D"] = function(o) { o.rotation.x += ROT_STEP; };
  KEY_ACTIONS["z"] = KEY_ACTIONS["Z"] = function(o) { o.rotation.z -= ROT_STEP; };
  KEY_ACTIONS["c"] = KEY_ACTIONS["C"] = function(o) { o.rotation.z += ROT_STEP; };
  KEY_ACTIONS["["] = function(o) { let s = o.scale.x * 0.9; o.scale.set(s, s, s); };
  KEY_ACTIONS["]"] = function(o) { let s = o.scale.x * 1.1; o.scale.set(s, s, s); };

  document.addEventListener("keydown", function _kd(e) {
    if (e.key === "Control") { _ctrlDown = true; return; }
    if (e.shiftKey) return; // Shift 按住时屏蔽快捷键，避免干扰拖拽

    // Delete：删除选中对象
    if (e.key === "Delete" && selectedObjects.length) {
      for (let i = selectedObjects.length - 1; i >= 0; i--) {
        const obj = selectedObjects[i];
        // 清理 CSS2DObject 的 DOM 元素
        obj.traverse(function(ch) { if (ch.isCSS2DObject && ch.element) ch.element.remove(); });
        // 从 allModelInstances 中移除
        const idx = allModelInstances.indexOf(obj);
        if (idx >= 0) allModelInstances.splice(idx, 1);
        // 从场景中移除
        scene.remove(obj);
      }
      deselectAll();
      return;
    }

    if (!selectedObjects.length) return;
    let action = KEY_ACTIONS[e.key];
    if (action) {
      selectedObjects.forEach(action);
      updateSelectionBoxes();
      // 变换实时作用于对象本身；复位由 importer.resetPositions() 统一回退到默认基线，无需在此保存
    }
  });

  // ======================== Shift + 左键拖拽移动 ========================
  renderer.domElement.addEventListener("pointerdown", function _pd2(e) {
    if (e.shiftKey) {
      if (!selectedObjects.length) {
        // 自动选中光标下的模型
        const r = renderer.domElement.getBoundingClientRect();
        _mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        _mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
        _raycaster.setFromCamera(_mouse, camera);
        for (let mi = 0; mi < allModelInstances.length; mi++) {
          if (_raycaster.intersectObject(allModelInstances[mi], true).length > 0) {
            selectObject(allModelInstances[mi], _ctrlDown);
            break;
          }
        }
      }
      if (selectedObjects.length) {
        isDragging = true;
        controls.update(); // 吸收 OrbitControls 的阻尼惯性
        controls.enabled = false;
      }
    }
  });

  renderer.domElement.addEventListener("pointermove", function _pm(e) {
    if (!isDragging || !selectedObjects.length) return;
    let rect = renderer.domElement.getBoundingClientRect();
    _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_mouse, camera);
    let pt = _raycaster.ray.intersectPlane(_dragPlane, new THREE.Vector3());
    if (pt) {
      let dx = pt.x - selectedObjects[0].position.x;
      let dz = pt.z - selectedObjects[0].position.z;
      selectedObjects.forEach(function(o) { o.position.x += dx; o.position.z += dz; });
      updateSelectionBoxes();
      // 拖动中只更新显示；复位由 importer.resetPositions() 统一回退到默认基线，无需保存
    }
  });

  document.addEventListener("pointerup", function _pu2() {
    if (isDragging) {
      isDragging = false;
      controls.enabled = true;
      // 变换实时作用于对象本身；复位由 importer.resetPositions() 统一回退到默认基线，无需在此保存
    }
  });

  // ======================== 返回公共接口 ========================
  return { selectObject, deselectAll, updateSelectionBoxes };
}
