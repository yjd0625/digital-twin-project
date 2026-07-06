/**
 * data_handler.js — 数据驱动模型的核心映射器
 *
 * 【数据格式约定】
 * PlantSimulation 通过 Socket 发来的 JSON 格式：
 * {
 *   "stations": [                          // 设备列表
 *     { "id": "assembleStation_1", "status": "running", "parts": 42, "temp": 65.3 },
 *     { "id": "assembleStation_2", "status": "idle",    "parts": 12, "temp": 30.1 },
 *     { "id": "telescopicFork",    "status": "moving",  "x": 1.5, "y": 0, "z": 2.0 },
 *     { "id": "weldRobot_1",       "status": "welding", "cycle": 0.47 },
 *     { "id": "weldRobot_2",       "status": "stopped", "cycle": 0.0 }
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
    this.objects = ctx.objects || {};                      // 向后兼容，预留直接注册接口
    this.updateInfo = ctx.updateInfo || (() => {});
    this.latestData = null;
  }


  // ======================== 入口：收到后端数据 ========================
  process(data) {
    const self = this;  // 保留引用，防止嵌套回调中 this 丢失
    self.latestData = data;
    console.log("data_handler 收到:", data);

    // 【第一步】整体产线参数（如线速度）
    if (data.lineSpeed !== undefined) {
      self.updateInfo("线速度: " + data.lineSpeed.toFixed(1) + " m/s");
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

        // --- 位置更新（如伸缩臂的 x/z 坐标）---
        if (station.x !== undefined || station.z !== undefined) {
          self.applyPosition(model, station);
        }

        // --- 标签文本更新（如产量数字）---
        if (station.parts !== undefined) {
          self.updateLabel(model, "产量: " + station.parts);
        }

        // --- 温度 → 颜色渐变（可选）---
        if (station.temp !== undefined) {
          self.applyTemperature(model, station.temp);
        }
      }
    }

    return data;
  }

  // ======================== 具体驱动函数 ========================

  /** 按设备 id 查找 Three.js 模型对象（匹配 userData.id） */
  findModelById(id) {
    for (const m of this.allModelInstances) {
      if (m.userData.id === id) return m;
    }
    return null;
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

  /** 更新模型位置（x-z 平面） */
  applyPosition(model, pos) {
    if (pos.x !== undefined) model.position.x = pos.x;
    if (pos.z !== undefined) model.position.z = pos.z;
  }

  /** 更新模型的 CSS2D 标签文字 */
  updateLabel(model, text) {
    model.traverse(function(ch) {
      if (ch.isCSS2DObject && ch.element) {
        ch.element.textContent = text;
      }
    });
  }

  /** 温度映射为颜色渐变：低温蓝 → 中温绿 → 高温红 */
  applyTemperature(model, temp) {
    const t = Math.min(Math.max((temp - 20) / 80, 0), 1);  // 20~100°C 映射到 0~1
    const r = Math.min(t * 2, 1);
    const g = Math.min((1 - t) * 2, 1);
    const b = Math.max(1 - t * 2, 0);
    model.traverse(function(ch) {
      if (ch.isMesh && ch.material && !ch.material.isLineBasicMaterial) {
        ch.material.color.setRGB(r, g, b);
      }
    });
  }
}