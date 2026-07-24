/**
 * data_handler.js — 数据驱动模型的核心映射器
 *
 * 【数据格式约定】
 * PlantSimulation 通过 Socket 发来的 JSON 格式：
 * {
 *   "stations": [                          // 设备列表
 *     { "id": "assembleStation_1",
 *     "status": "running",
 *     "parts": {        // 零件
 *       "arm": { "x": 0.5, "y": 0.2, "z": 0.0 }
 *     },
 *     "temp": 65.3 },
 * 
 *     { "id": "assembleStation_2", "status": "idle",    "parts": 12, "temp": 30.1 },
 *   ],
 *   "lineSpeed": 12.5,                     // 产线整体参数
 *   "timestamp": 1700000000
 * }
 */

// ---------- 状态 → 颜色映射表 ----------
const STATUS_COLORS = {
  running: 0x00ff88,   // 运行中 → 绿色
  idle:    0x4488ff,   // 空闲   → 蓝色
  stopped: 0xff4444,   // 停止   → 红色
  error:   0xff8800,   // 故障   → 橙色
  welding: 0xffaa00,   // 焊接中 → 金色
  moving:  0x00ccff,   // 移动中 → 青色
};

/**
 * DataHandler — 管理所有模型的状态更新
 *
 * @param {Object} ctx - 上下文，含 allModelInstances（模型数组）
 * @param {Function} ctx.updateInfo - 页面 info 栏更新函数
 */
export class DataHandler {
  constructor(ctx = {}) {
    this.allModelInstances = ctx.allModelInstances || [];  // 持有模型数组引用，用于 findModelById
    this.modelMap = new Map();  // id → 模型对象映射，避免每次都遍历 allModelInstances
    for (const m of this.allModelInstances) {
      if (m.userData && m.userData.id) {
        this.modelMap.set(m.userData.id, m);
      }
    }
    this.objects = ctx.objects || {};                      // 向后兼容，预留直接注册接口
    this.updateInfo = ctx.updateInfo || (() => {});
    this.latestData = null;
  }


  // ======================== 入口：收到后端数据 ========================
  process(data) {
    const self = this;  // 保留引用，防止嵌套回调中 this 丢失
    console.log("data_handler 收到 PlantSimulation 数据");
    self.latestData = data;
    // 【第一步】整体产线参数（如线速度）
    if (data.simulateSpeed !== undefined) {
      self.updateInfo("线速度: " + data.simulateSpeed.toFixed(1) + " m/s");
    }

    // 【第二步】逐个设备驱动
    if (data.stations && Array.isArray(data.stations)) {
      for (const station of data.stations) {
        // 按 id 匹配对应模型
        const model = self.findModelById(station.id);
        if (!model) {
          console.warn("data_handler: 未找到模型 id=", station.id);
          continue;  // 跳过当前 station，继续处理下一个
        }

        // --- 状态 → 颜色 ---
        if (station.status) {
          self.applyStatus(model, station.status);
        }

        // --- 设备状态控制（位置、旋转）---
        if (station.x !== undefined || station.y !== undefined || station.z !== undefined) {
          self.applyPosition(model, station);
        }
        if (station.rotationX !== undefined) model.rotation.x = station.rotationX;
        if (station.rotationY !== undefined) model.rotation.y = station.rotationY;
        if (station.rotationZ !== undefined) model.rotation.z = station.rotationZ;
        
        // --- 零件状态控制（如机械臂位置）---
        if (station.parts && typeof station.parts === 'object' && Object.keys(station.parts).length > 0) {
          self.applyParts(model, station.parts);
        }

      }
    }

    return data;
  }

  // ======================== 具体驱动函数 ========================

  /** 按设备 id 查找 Three.js 模型对象（匹配 userData.id） */
  findModelById(id) {
    return this.modelMap.get(id) || null;
  }

  /** 根据运行状态修改模型颜色 */
  applyStatus(model, status) {
    const color = STATUS_COLORS[status] || 0x888888;
    model.traverse(function(ch) {
      if (ch.isMesh && ch.material && !ch.material.isLineBasicMaterial) {
        ch.material.color.setHex(color);
      }
    });
  }

  /** 更新模型位置（x-y-z 三维） */
  applyPosition(model, pos) {
    if (pos.x !== undefined) model.position.x = pos.x;
    if (pos.y !== undefined) model.position.y = pos.y;
    if (pos.z !== undefined) model.position.z = pos.z;
  }

  /** 根据零件数据更新模型的子部件位置或状态 */
  applyParts(model, partsData) {
    for (const [partName, transforms] of Object.entries(partsData)) {
    const part = model.userData.parts?.[partName];
    if (!part) {
      console.warn(`零件 "${partName}" 在模型 "${model.userData.id}" 中未找到`);
      continue;
    }

    // 应用位置
    if (transforms.position) {
      const p = transforms.position;
      if (p.x !== undefined) part.position.x = p.x;
      if (p.y !== undefined) part.position.y = p.y;
      if (p.z !== undefined) part.position.z = p.z;
    }

    // 应用旋转（欧拉角，弧度）
    if (transforms.rotation) {
      const r = transforms.rotation;
      if (r.x !== undefined) part.rotation.x = r.x;
      if (r.y !== undefined) part.rotation.y = r.y;
      if (r.z !== undefined) part.rotation.z = r.z;
    }

    // 应用缩放
    if (transforms.scale) {
      const s = transforms.scale;
      if (s.x !== undefined) part.scale.x = s.x;
      if (s.y !== undefined) part.scale.y = s.y;
      if (s.z !== undefined) part.scale.z = s.z;
    }}
  }
}