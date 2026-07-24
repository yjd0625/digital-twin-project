/**
 * data_handler.js — 数据驱动模型的核心映射器
 *
 * 【数据格式约定】后端通过 WebSocket 发来的 JSON，用顶层 "type" 区分两类消息：
 *
 * 1) 状态同步（瞬间应用）：
 * {
 *   "type": "state",
 *   "timestamp": 1700000000,
 *   "simulateSpeed": 2,
 *   "stations": [
 *     { "id": "组装工位 #1", "status": "running", "temp": 30,
 *       "parts": { "Bracket": { "position": {"x":5}, "rotation": {"x":0.8}, "scale": {"z":1.2} } } }
 *   ]
 * }
 *
 * 2) 动作指令（入队，在 animate() 中插值执行）：
 * {
 *   "type": "action",
 *   "commands": [
 *     { "id": "组装工位 #1",
 *       "parts": {
 *         "Bracket":     { "position": {"x":5,   "duration":2.0}, "rotation": {"x":0.8, "duration":1.5} },
 *         "PositionPin": { "scale":    {"z":1.2, "duration":1.0} },
 *         "Clamp":       { "position": {"x":3,   "speed":1.5} }    // 按速度：时长=位移/速度（匀速）
 *       } },
 *     { "id": "搬运机器人 #1",
 *       "parts": { "RobotBase": { "rotation": {"x":0.8, "z":0.8, "duration":1.5} } } },
 *     // 用设备自身 id 作 key 可整体变换设备根节点（父节点视作零件）
 *     { "id": "搬运机器人 #1", "parts": { "TransferRobot": { "position": {"x":3, "duration":2.0} } } }
 *   ]
 * }
 *
 * 3) 复位（后端触发，清空动作队列并复位到默认姿态）：
 * { "type": "reset" }
 *
 * 4) 创建模型（后端触发，实例化一个新模型并加入场景）：
 * { "type": "create", "object": "RobotArm", "position": [0,0,0], "id": "搬运机器人 #1" }
 *
 * 【约定】
 * - state 为"部分覆盖"：只改给定的轴，未给的轴保持现状。
 * - 队列按零件并发：同一零件（含整体根节点）的下一条指令顺序执行，不同零件并发。
 * - 动作通道时长优先级：通道 duration > 通道 speed（位移/速度，匀速）> command 级 duration（缺省 1.0s 并打印提示）。
 * - speed 单位：位置/缩放 = 场景单位/秒（米/秒）；旋转 = 度/秒（内部换算为弧度/秒后参与计算）。
 * - simulateSpeed 作为动画播放倍率（elapsed += delta * simulateSpeed）。
 * - 状态优先：state 命中正在动画的零件时，瞬间赋值并取消其动画。
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

// 两个 Euler 角之间的"距离"：各轴差向量模长（用于按 speed 推导时长）
function eulerDist(e1, e2) {
  const dx = e2.x - e1.x, dy = e2.y - e1.y, dz = e2.z - e1.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// 解析单通道时长（优先级：通道 duration > 通道 speed（位移/速度，匀速）> command 级 duration）
// 单位约定：位置/缩放 speed = 场景单位/秒（米/秒）；旋转 speed = 度/秒（内部转弧度/秒）
function resolveChannelDur(def, dist, fallback, name, isRotation) {
  if (def.duration !== undefined) return def.duration;
  if (def.speed !== undefined) {
    let v = def.speed;
    if (isRotation) v = v * Math.PI / 180;   // 旋转 speed：度/秒 → 弧度/秒
    if (dist <= 1e-9) return 0;              // 无实际位移 → 不产生动画
    return dist / v;                         // 匀速：时长 = 位移 / 速度
  }
  console.info(`[DataHandler] 通道 "${name}" 未传入 duration/speed，回退 command 级 duration=${fallback}s`);
  return fallback;
}


/**
 * DataHandler — 管理所有模型的状态更新与动作动画
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
    this.updateSpeed = ctx.updateSpeed || (() => {});   // 线速度独立标签（不覆盖连接状态）
    this.latestData = null;

    // ======================== 动作队列 / 动画状态 ========================
    this.actionQueue = [];                 // 待执行指令 [{id, part, target, duration}]
    this.activeAnimations = new Map();     // key=id::part → {part, from, to, elapsed, duration}
    this.simulateSpeed = 1;                // 动画播放倍率（来自 state.simulateSpeed）
    this.onResetRequested = null;          // 后端 "reset" 时回调（由 main.js 注入 resetAll）
    this.onCreateModel = ctx.onCreateModel || null;  // 后端 "create" 时回调（main.js 注入实际建模逻辑）
    this.scene = ctx.scene || null;        // 场景根，用于 attach/detach 时 reparent（保留世界变换）
  }

  // ======================== 入口：收到后端数据 ========================
  process(data) {
    if (!data || typeof data !== "object") return data;
    const type = data.type || "state";     // 无 type 时默认按 state 处理（兼容旧格式）
    // 接收后端消息日志
    const summary = type === "state"
      ? `stations=${data.stations ? data.stations.length : 0}, simulateSpeed=${data.simulateSpeed}`
      : type === "action"
        ? `commands=${data.commands ? data.commands.length : 0}`
        : type === "create"
          ? `object=${data.object}, position=${JSON.stringify(data.position)}`
          : type === "attach"
            ? `child=${data.child} → parent=${data.parent}${data.parentPart ? "::" + data.parentPart : ""}`
            : type === "detach"
              ? `child=${data.child}`
              : "";
    console.log(`[DataHandler] 收到后端消息 type="${type}"${summary ? " | " + summary : ""}${data.timestamp ? " | ts=" + data.timestamp : ""}`);
    this.latestData = data;

    // 线速度 / 播放倍率：所有消息类型共享（action 动画也需据此加速）
    if (data.simulateSpeed !== undefined) {
      this.simulateSpeed = data.simulateSpeed;
      this.updateSpeed("仿真倍速: " + data.simulateSpeed.toFixed(1));
    }

    if (type === "action") {
      this.enqueueActions(data.commands || []);
    } else if (type === "reset") {
      this.clearActions();
      if (this.onResetRequested) this.onResetRequested();  // 触发前端复位（含清选择框）
    } else if (type === "create") {
      this.createModel(data);
    } else if (type === "attach") {
      this.attachModel(data);
    } else if (type === "detach") {
      this.detachModel(data);
    } else {
      // "state" 及未知类型均按状态同步处理
      this.applyState(data);
    }
    return data;
  }

  // ======================== 动态创建模型（后端 create 指令）========================
  /**
   * 处理后端 "create" 指令：实例化一个新模型并加入场景。
   * 真实建模逻辑（加载 GLB / 克隆模板 / 加入场景 / 登记查找表）由 main.js 通过
   * ctx.onCreateModel 注入，这里只做字段校验与分发，保持 DataHandler 与 Three.js 解耦。
   */
  createModel(msg) {
    if (!msg || !msg.object) {
      console.warn("[DataHandler] create 指令缺少 object 字段，已跳过:", msg);
      return;
    }
    const position = (msg.position && Array.isArray(msg.position)) ? msg.position : [0, 0, 0];
    const opts = {
      id: msg.id,                      // 实例 id（缺省用 object）
      parts: msg.parts,                // 可选：零件白名单，用于预填 userData.parts 缓存
      scale: msg.scale,                // 可选：整体缩放
      rotateX: msg.rotateX,            // 可选：整体绕 X 旋转（弧度）
      autoAlignGround: msg.autoAlignGround,  // 可选：是否贴地居中（默认 true）
    };
    if (typeof this.onCreateModel === "function") {
      const p = this.onCreateModel(msg.object, position, opts);
      if (p && typeof p.catch === "function") {
        p.catch((e) => console.error("[DataHandler] create 建模失败:", e));
      }
    } else {
      console.warn("[DataHandler] 未配置 onCreateModel 回调，无法创建模型:", msg.object);
    }
  }

  /** 由 main.js 在创建完成后调用，把新实例登记进 id→模型 查找表 */
  registerModel(id, model) {
    if (!id || !model) return;
    this.modelMap.set(id, model);
  }

  // ======================== 父子绑定（attach / detach）========================
  /**
   * 处理后端 "attach" 指令：把 child 模型挂到 parent 设备的某个挂点（parentPart）下，
   * 使 child 随 parent 的运动自动跟随（场景图父子关系）。
   * 用 THREE.Object3D.attach() 完成 reparent，自动保留世界变换，不会发生瞬移。
   * @param {object} msg { child, parent, parentPart? }
   */
  attachModel(msg) {
    if (!msg || !msg.child || !msg.parent) {
      console.warn("[DataHandler] attach 指令缺少 child/parent，已跳过:", msg);
      return;
    }
    const child = this.findModelById(msg.child);
    if (!child) { console.warn(`[DataHandler] attach: 未找到子模型 id="${msg.child}"`); return; }
    const parentModel = this.findModelById(msg.parent);
    if (!parentModel) { console.warn(`[DataHandler] attach: 未找到父模型 id="${msg.parent}"`); return; }
    // 定位挂点：parentPart 缺省为父设备自身 id → _findPart 特判返回根节点（整体绑定）
    const anchor = this._findPart(parentModel, msg.parentPart || msg.parent);
    if (!anchor) { console.warn(`[DataHandler] attach: 挂点 "${msg.parentPart}" 在 "${msg.parent}" 中未找到`); return; }
    // 若已挂在其他节点，先卸下再挂新节点
    if (child.userData.attachedTo) this._detachOne(child);
    anchor.attach(child);   // 保留世界变换的 reparent
    child.userData.attachedTo = { parent: msg.parent, parentPart: msg.parentPart || null };
    console.log(`[DataHandler] attach: "${msg.child}" → "${msg.parent}"${msg.parentPart ? "::" + msg.parentPart : ""}`);
  }

  /**
   * 处理后端 "detach" 指令：把 child 从当前父节点卸回场景根（保留世界变换）。
   * @param {object} msg { child }
   */
  detachModel(msg) {
    if (!msg || !msg.child) {
      console.warn("[DataHandler] detach 指令缺少 child，已跳过:", msg);
      return;
    }
    const child = this.findModelById(msg.child);
    if (!child) { console.warn(`[DataHandler] detach: 未找到子模型 id="${msg.child}"`); return; }
    this._detachOne(child);
  }

  /** 内部：把单个 child 卸回场景根（保留世界变换），并清除 attachedTo 标记 */
  _detachOne(child) {
    if (this.scene) this.scene.attach(child);     // 保留世界变换地 reparent 回场景根
    else if (child.parent) child.parent.add(child);
    child.userData.attachedTo = null;
  }

  /** 复位前调用：把所有已绑定模型卸回场景根，使 resetPositions 能按独立世界姿态回写基线 */
  detachAll() {
    for (const m of this.allModelInstances) {
      if (m.userData && m.userData.attachedTo) this._detachOne(m);
    }
  }

  // ======================== 状态同步（瞬间应用）========================
  applyState(data) {
    // 逐个设备驱动
    if (data.stations && Array.isArray(data.stations)) {
      for (const station of data.stations) {
        const model = this.findModelById(station.id);
        if (!model) {
          console.warn("applyState: 未找到模型 id=", station.id);
          continue;
        }

        // 状态 → 颜色
        if (station.status) this.applyStatus(model, station.status);

        // 站级整体变换（兼容旧格式，真实数据一般放 parts 里）
        if (station.position.x !== undefined || station.position.y !== undefined || station.position.z !== undefined) {
          this.applyPosition(model, station);
        }
        if (station.rotation.x !== undefined || station.rotation.y !== undefined || station.rotation.z !== undefined) {
          this.applyRotation(model, station);
        }

        // 零件变换（瞬间生效，并取消该零件可能正在进行的动画）
        if (station.parts && typeof station.parts === "object" && Object.keys(station.parts).length > 0) {
          this.applyParts(model, station.parts);
        }
      }
    }
  }

  // ======================== 动作指令（入队 + 动画）========================
  enqueueActions(commands) {
    for (const cmd of commands) {
      if (!cmd || !cmd.id || !cmd.parts) {
        console.warn("action 指令缺少 id/parts，已跳过:", cmd);
        continue;
      }
      // 一条「设备级」指令拆分为多个「零件级」子任务入队：
      // 同一指令内的多零件并发执行；同一零件的下一条指令顺序执行。
      for (const [partName, transforms] of Object.entries(cmd.parts)) {
        if (!transforms || typeof transforms !== "object") continue;
        this.actionQueue.push({
          id: cmd.id,
          part: partName,
          target: transforms,
          duration: cmd.duration !== undefined ? cmd.duration : 1.0,  // command 级 duration，仅作各通道的回退默认值
        });
      }
    }
    this._pump();
  }

  /** 启动队列中「对应零件未在动画中」的指令；同零件指令自动排队等待 */
  _pump() {
    for (let i = this.actionQueue.length - 1; i >= 0; i--) {
      const cmd = this.actionQueue[i];
      const key = cmd.id + "::" + cmd.part;
      if (!this.activeAnimations.has(key)) {
        this._start(cmd);
        this.actionQueue.splice(i, 1);
      }
    }
  }

  /** 把一条指令转为活动动画：记录 from/to（未给定的轴保持现状 → 不动）*/
  _start(cmd) {
    const model = this.findModelById(cmd.id);
    if (!model) { console.warn("action: 未找到模型 id=", cmd.id); return; }
    const part = this._findPart(model, cmd.part);
    if (!part) { console.warn(`action: 零件 "${cmd.part}" 在 "${cmd.id}" 中未找到`); return; }

    const from = {
      pos: part.position.clone(),
      rot: part.rotation.clone(),
      scl: part.scale.clone(),
    };
    const to = {
      pos: part.position.clone(),
      rot: part.rotation.clone(),
      scl: part.scale.clone(),
    };
    // 各通道独立时长：仅当 target 中出现该通道才设置 dur（否则 0 = 不动画）
    // 优先级：通道 duration > 通道 speed（位移/速度，匀速）> command 级 duration（缺省 1.0s 并提示）
    const dur = { pos: 0, rot: 0, scl: 0 };
    const fallback = (cmd.duration !== undefined) ? cmd.duration : 1.0;
    const t = cmd.target || {};
    if (t.position) {
      if (t.position.x !== undefined) to.pos.x = t.position.x;
      if (t.position.y !== undefined) to.pos.y = t.position.y;
      if (t.position.z !== undefined) to.pos.z = t.position.z;
      dur.pos = resolveChannelDur(t.position, from.pos.distanceTo(to.pos), fallback, "position");
    }
    if (t.rotation) {
      if (t.rotation.x !== undefined) to.rot.x = t.rotation.x;
      if (t.rotation.y !== undefined) to.rot.y = t.rotation.y;
      if (t.rotation.z !== undefined) to.rot.z = t.rotation.z;
      dur.rot = resolveChannelDur(t.rotation, eulerDist(from.rot, to.rot), fallback, "rotation", true);
    }
    if (t.scale) {
      if (t.scale.x !== undefined) to.scl.x = t.scale.x;
      if (t.scale.y !== undefined) to.scl.y = t.scale.y;
      if (t.scale.z !== undefined) to.scl.z = t.scale.z;
      dur.scl = resolveChannelDur(t.scale, from.scl.distanceTo(to.scl), fallback, "scale");
    }
    const key = cmd.id + "::" + cmd.part;
    this.activeAnimations.set(key, {
      part, from, to,
      elapsed: { pos: 0, rot: 0, scl: 0 },
      dur,
    });
  }

  /** 每帧由 main.js 的 animate() 调用：推进所有活动动画（各通道独立时长）*/
  updateAnimations(delta) {
    const speed = this.simulateSpeed || 1;
    for (const [key, a] of this.activeAnimations) {
      let allDone = true;
      const channels = [
        { name: "pos", apply: (t) => a.part.position.lerpVectors(a.from.pos, a.to.pos, t) },
        { name: "rot", apply: (t) => {
            a.part.rotation.x = a.from.rot.x + (a.to.rot.x - a.from.rot.x) * t;
            a.part.rotation.y = a.from.rot.y + (a.to.rot.y - a.from.rot.y) * t;
            a.part.rotation.z = a.from.rot.z + (a.to.rot.z - a.from.rot.z) * t;
          } },
        { name: "scl", apply: (t) => a.part.scale.lerpVectors(a.from.scl, a.to.scl, t) },
      ];
      for (const ch of channels) {
        if (a.dur[ch.name] <= 0) continue;   // 该通道无动画
        a.elapsed[ch.name] += delta * speed;
        const t = a.dur[ch.name] > 0 ? Math.min(a.elapsed[ch.name] / a.dur[ch.name], 1) : 1;
        ch.apply(t);
        if (t < 1) allDone = false;
      }
      if (allDone) this.activeAnimations.delete(key);
    }
    // 本轮完成的零件，启动其下一条排队指令
    this._pump();
  }

  /** 清空动作队列与所有活动动画（复位时调用）*/
  clearActions() {
    this.actionQueue.length = 0;
    this.activeAnimations.clear();
  }

  /** 取消某零件的活动动画与排队指令（状态优先于动画）*/
  _cancel(key) {
    this.activeAnimations.delete(key);
    for (let i = this.actionQueue.length - 1; i >= 0; i--) {
      const c = this.actionQueue[i];
      if (c.id + "::" + c.part === key) this.actionQueue.splice(i, 1);
    }
  }

  // ======================== 具体驱动函数 ========================

  /** 按设备 id 查找 Three.js 模型对象（匹配 userData.id） */
  findModelById(id) {
    return this.modelMap.get(id) || null;
  }

  /** 查找零件：先查 userData.parts 缓存（最快），未命中打印提示并回退 getObjectByName 全局查找 */
  _findPart(model, partName) {
    // 约定：partName 等于设备自身 id 时，返回根节点（父节点可作为零件整体变换）
    if (partName === model.userData.id) return model;
    let part = model.userData.parts ? model.userData.parts[partName] : undefined;
    if (!part) {
      console.info(`零件 "${partName}" 不在 userData.parts 缓存，回退 getObjectByName 全局查找`);
      part = model.getObjectByName(partName);
    }
    return part;
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

  /** 更新模型旋转（x-y-z 三维） */
  applyRotation(model, rot) {
    if (rot.x !== undefined) model.rotation.x = rot.x;
    if (rot.y !== undefined) model.rotation.y = rot.y;
    if (rot.z !== undefined) model.rotation.z = rot.z;
  }

  /** 根据零件数据更新模型的子部件位置/旋转/缩放（瞬间）*/
  applyParts(model, partsData) {
    for (const [partName, transforms] of Object.entries(partsData)) {
      // 先查 userData.parts 缓存，未命中打印提示并回退 getObjectByName 全局查找
      const part = this._findPart(model, partName);
      if (!part) {
        console.warn(`零件 "${partName}" 在模型 "${model.userData.id}" 中未找到`);
        continue;
      }
      // 状态优先：瞬间赋值前取消该零件可能正在进行的动画
      this._cancel(model.userData.id + "::" + partName);

      if (transforms.position) {
        const p = transforms.position;
        if (p.x !== undefined) part.position.x = p.x;
        if (p.y !== undefined) part.position.y = p.y;
        if (p.z !== undefined) part.position.z = p.z;
      }
      if (transforms.rotation) {
        const r = transforms.rotation;
        if (r.x !== undefined) part.rotation.x = r.x;
        if (r.y !== undefined) part.rotation.y = r.y;
        if (r.z !== undefined) part.rotation.z = r.z;
      }
      if (transforms.scale) {
        const s = transforms.scale;
        if (s.x !== undefined) part.scale.x = s.x;
        if (s.y !== undefined) part.scale.y = s.y;
        if (s.z !== undefined) part.scale.z = s.z;
      }
    }
  }
}
