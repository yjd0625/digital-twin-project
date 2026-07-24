# 数据源连接器协议（CONNECTOR）

> 适用版本：2026-07 解耦后。后端现在是**数据源中立（source-agnostic）**的：
> 只要某服务按本协议在 `SOURCE_HOST:SOURCE_PORT` 上作为 **TCP 服务端**推送数据，
> 后端零改动即可接入。Plant Simulation 已作为**分析外挂**（订阅 `source/state` 只读）
> 退出实时控制环。

---

## 1. 角色与传输

```
┌──────────────┐   TCP 30000 (后端是客户端)   ┌──────────────────┐
│  后端 FastAPI │ <──────────────────────────  │  数据源连接器     │
│ source_read_  │   连接器 = TCP 服务端          │ (TCP 服务端,     │
│ loop          │   后端 = TCP 客户端           │  push 帧)        │
└──────┬───────┘                               └──────────────────┘
       │ publish source/state
       ▼
   Redis Pub/Sub ──subscribe──▶ WebSocketHandler ──▶ 前端
       │ (旁路)
       ▼
   InfluxDB 3 (state/action 快照, best-effort)
```

- **连接器 = TCP 服务端**，监听 `SOURCE_HOST:SOURCE_PORT`（默认 `127.0.0.1:30000`）。
- **后端 = TCP 客户端**，启动时连接，断线每 3s 自动重连。
- 实时环是**单向**：连接器 → 后端 → 前端。后端不向连接器下发任何指令
  （原 `plant/command` 回写已移除）。

---

## 2. 帧编码铁律（务必遵守）

后端用 `json.JSONDecoder().raw_decode` **顺序**解析字节流，逐条取出完整 JSON。
因此连接器必须遵守：

1. **多个 JSON 信封直接拼接发送，中间不带任何换行 / 空格 / 分隔符。**
2. **不要在前导加空白**（raw_decode 默认不跳前导空白，前导空白会导致解析卡死）。
3. **UTF-8 编码**（`ensure_ascii=False`），中文 `id` 直接写。
4. 每条信封是**一个完整 JSON 对象**，以 `}` 结束，紧接着下一条 `{...}`。

正确示例（两帧连发，无任何分隔）：

```
{"type":"state","stations":[{"id":"搬运机器人 #1","status":"moving"}]}{"type":"action","commands":[{"id":"组装工位 #1","parts":{"LeftSlide":{"position":{"x":1}}}}]}
```

错误示例（带换行 / 逗号分隔 / 数组包裹）：

```
{"type":"state",...}
{"type":"action",...}        ← 换行会破坏解析
[{"type":"state",...},{"type":"action",...}]   ← 数组 + 逗号兜底已被后端移除
```

> 基类 `connectors/base.py` 的 `build_frame()` 已用 `json.dumps(envelope, ensure_ascii=False)`
> 编码且**不带尾随分隔符**，直接 `conn.sendall(...)` 即可。

---

## 3. 信封总览

顶层必须有 `"type"` 字段分流。支持类型：

| type | 语义 | 后端处理 |
|------|------|----------|
| `state` | 瞬态同步：直接应用各设备/零件的位姿与状态 | 解析 → 旁路写 InfluxDB → 广播前端（瞬间应用） |
| `action` | 动画指令：入队按 `duration` 插值执行 | 拆 parts 成子任务入队 → 前端逐帧插值 |
| `reset` | 清空动画队列 + 复位所有模型到基线 | 前端 `resetAll()` |
| `create` | 运行时动态建模（前端按需生成网格） | 前端 `createModel()` |
| `attach` / `detach` | 父子绑定 / 卸绑 | 前端 `attach`/`detach` |

---

## 4. `state` 信封

```json
{
  "type": "state",
  "timestamp": 1752547200,
  "simulationTime": 12.345,
  "simulateSpeed": 1,
  "stations": [ { ... }, { ... } ]
}
```

`stations[]` 每项字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 设备 id，需与前端模型 id 对齐（默认场景用 `"标签 #序号"`，如 `"组装工位 #1"`） |
| `status` | string | ⬜ | 业务状态，前端据此改色（见 §6 状态码） |
| `temp` | number | ⬜ | 温度等遥测，旁路写入 InfluxDB |
| `position` | {x,y,z} | ⬜ | 设备自身世界坐标偏移 |
| `rotation` | {x,y,z} | ⬜ | 设备自身欧拉角（弧度） |
| `scale` | {x,y,z} | ⬜ | 缩放 |
| `parts` | object | ⬜ | 子零件变换，key=零件名，value 同上述 `position/rotation/scale`（可内嵌 `duration`） |

**整体变换用设备自身 id 作 `parts` 的 key**（父节点视作零件）。前端 `_findPart` 特判返回根节点。
`position` 等字段缺省则保持当前值（部分覆盖）。

`python_realtime.py` 实际生成示例：

```json
{"id":"搬运机器人 #1","status":"moving","temp":29.4,"position":{"x":15.8}}
{"id":"组装工位 #1","status":"running","temp":33.1,
 "parts":{"Clamp":{"position":{"y":1.6}},"Bracket":{"rotation":{"y":0.21}}}}
{"id":"焊接悬挂机器人 #1","status":"welding","temp":49.2,"rotation":{"z":0.37}}
```

---

## 5. `action` 信封

结构与 `state` 类似，但 `stations[]`（此处称 `commands[]`）的变换**入队插值执行**，而非瞬间应用。

```json
{
  "type": "action",
  "simulationTime": 12.345,
  "commands": [
    {
      "id": "组装工位 #1",
      "duration": 1.5,
      "parts": {
        "LeftSlide": { "position": { "x": 1.0, "duration": 1.5 } }
      }
    }
  ]
}
```

- 队列按**零件并发**（同零件顺序执行）。
- 每零件可独立带 `duration`（秒）；未写则回退 command 级 `duration`，再回退默认 `1.0`。
- `state` 到达时，会取消同 id 设备正在进行的动画（状态优先）。

---

## 6. 状态码（status 取值约定）

`status` 是字符串，前端 `applyStatus` 据此把网格 `material.color` 改成预设色（复位时还原到基线）。
本仓库 `python_realtime.py` 使用的值（仅作约定，连接器可自定义，前端做未知值兜底）：

| status | 含义 | 典型视觉 |
|--------|------|----------|
| `running` | 正常运行 | 绿色 |
| `moving` | 搬运/移动中 | 绿色（动态） |
| `welding` | 焊接中 | 橙色/红色高亮 |
| `idle` | 空闲 | 灰色 |
| `error` / `fault` | 故障 | 红色 |
| `warning` | 预警 | 黄色 |

> 颜色是前端表现层关注点。连接器只需保证 `status` 字符串语义稳定，便于前端做颜色映射。

---

## 7. `reset` / `create` / `attach` / `detach`

- **`reset`**：`{"type":"reset"}` —— 清空动画队列、复位所有模型到基线（含颜色）。
- **`create`**：运行时动态建模，前端按指令生成网格（便于"刻意简单的盒子场景"）。
  ```json
  {"type":"create","id":"box1","geometry":"box","size":[1,1,1],"position":{"x":0,"y":0.5,"z":0}}
  ```
- **`attach`** / **`detach`**：父子绑定/卸绑（用于复合设备层级）。
  ```json
  {"type":"attach","parent":"组装工位 #1","child":"Clamp"}
  {"type":"detach","parent":"组装工位 #1","child":"Clamp"}
  ```

---

## 8. 主题约定（Redis Pub/Sub / MQTT 风格）

| 主题 | 方向 | 说明 |
|------|------|------|
| `source/state` | 数据源 → 前端 | 实时状态/动作 JSON（后端 `source_read_loop` 发布，前端订阅广播） |
| ~~`plant/command`~~ | — | **已移除**：原实时控制回写主题 |
| `source/prediction` | （规划中）| 异步推演结果回写通道（Plant Simulation 做 what-if 后回灌，待开发） |

> 分析外挂（如 Plant Simulation）接入方式：**订阅 `source/state` 只读消费**，
> 拿到实时状态后离线做预测/推演；结果将来走 `source/prediction` 回写，不进实时控制环。

---

## 9. 如何写一个新的数据源

两种方式，任选其一：

### A. 用本仓库 `connectors` 包（推荐，Python）

继承 `connectors.base.SourceConnector`，实现 `generate_frame()` 返回信封 dict：

```python
from connectors.base import SourceConnector, build_frame

class MySource(SourceConnector):
    def __init__(self, host="0.0.0.0", port=30000, hz=20):
        super().__init__(host, port)
        self.hz = hz
    def tick(self):
        return 1.0 / self.hz
    def generate_frame(self):
        # 返回 None 表示本周期不发；否则返回一个 §3~§7 的合法信封 dict
        return {"type": "state", "stations": [{"id": "搬运机器人 #1", "status": "moving"}]}

if __name__ == "__main__":
    MySource().serve()   # 起 TCP 服务端，阻塞等待后端连接
```

运行（后端作为客户端连上来）：

```bash
python -m connectors.sources.python_realtime --port 30000 --hz 20
# 或仅自检（不联网）：
python -m connectors.sources.python_realtime --dry-run
```

### B. 任意语言 / 系统

只要满足 §2 帧铁律、在 `SOURCE_HOST:SOURCE_PORT` 上起 TCP 服务端并推送合法信封即可。后端零改动。

---

## 10. 配置与验证

后端配置（`backend/src/config.py`，可用环境变量覆盖）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `SOURCE_HOST` | `127.0.0.1` | 数据源地址（Docker 内连宿主用 `host.docker.internal`） |
| `SOURCE_PORT` | `30000` | 数据源 TCP 端口 |
| `SOURCE_BUFFER_SIZE` | `1024` | 单次 recv 字节上限 |

验证端到端：

1. 启动后端（见 `backend/README.md`）。
2. 另开终端跑数据源：`python -m connectors.sources.python_realtime`
3. `curl http://localhost:8300/status` 应见 `source_connected: true`；
   若启用 InfluxDB，`influxdb.write_count` 随仿真增长。
4. 浏览器开前端（`http://localhost:8080` 或 dev server），应见默认场景模型运动 + 状态变色。
