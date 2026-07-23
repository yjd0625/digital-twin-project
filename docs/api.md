
## WebSocket 接口

**地址**: ws://localhost:8300/ws

### 后端 -> 前端（数据推送）

数据用顶层 `type` 信封分流，常见两种（来自数据源，默认 Python 实时仿真器，经 Redis 总线转发）：

- `type=state`：瞬间同步各设备/零件姿态（每帧）

```json
{
  "type": "state",
  "simulationTime": 0,
  "simulateSpeed": 2,
  "stations": [
    { "id": "组装工位 #1", "temp": 30,
      "parts": { "Bracket": { "position": {"x":164.87,"y":-15.28,"z":0},
                              "rotation": {"x":0,"y":0,"z":-1},
                              "scale": {"x":1.2,"y":1.2,"z":1.1} } } }
  ]
}
```

- `type=action`：动作指令（入队插值动画，事件触发）

```json
{
  "type": "action",
  "timestamp": 1700000000,
  "simulateSpeed": 2,
  "commands": [
    { "id": "焊接悬挂机器人 #1", "temp": 30,
      "parts": { "Z1": {"rotation": {"z": 1.5708, "speed": 10}},
                 "Y1": {"rotation": {"y": 1.5708, "speed": 20}} } }
  ]
}
```

> 缺失的通道/轴表示"保持不变"（前端只对传入的轴做插值）。`state` 用 `simulationTime`、`action` 兼容 `timestamp` 作为仿真时刻。

### 前端 -> 后端（指令发送）

> 控制通道已随架构解耦**移除**：实时环为单向（数据源 → 后端 → 前端），前端不再向后端发送 START/STOP/SPEED 等控制指令，后端也不再向数据源回写指令。PlantSimulation 作为只读分析外挂订阅 `source/state` 做预测/推演。

## HTTP API（FastAPI）

**地址**: http://localhost:8300

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /health | 健康检查：`{"status":"ok","source_connected":bool}` |
| GET | /status | 运行状态：前端连接数 + 数据源(source) / 总线连接状态 + InfluxDB 写入统计（enabled/connected/write_count/last_error） |
| WS | /ws | 前端实时通道（见上方 WebSocket 接口） |

## TCP Socket（数据源通信）

后端作为 **TCP 客户端**连接数据源；数据源（默认 Python 实时仿真器）作为 **TCP 服务端**监听 `host:30000`（后端经 `host.docker.internal:30000` 访问宿主上的数据源，断线每 3s 自动重连）。

数据格式：多个 JSON 信封**直接拼接发送、不带换行/分隔符**，UTF-8 编码；信封 `type ∈ {create, state, action, reset, attach, detach}`。完整帧编码与信封 schema 见 `docs/CONNECTOR.md`。

## 时序数据库写入（InfluxDB 3 Core）

后端可把数据源的 `state` / `action` **旁路写入** InfluxDB 3（best-effort，失败仅记日志，不影响实时孪生流）。

- **启用**：设环境变量 `INFLUXDB_ENABLED=true`（默认 false）。鉴权时设 `INFLUXDB_TOKEN`。其余见 `backend/src/config.py`（`INFLUXDB_*` 项）。
- **建库**：`influxdb3 create database digital_twin`（measurement 首写自动创建，无需预建表）。
- **两张表（measurement）**：
  - `station_state`（`type=state`，每帧 30Hz）：tag `station_id` + `part_name`；field `pos_x/y/z`、`rot_x/y/z`、`scale_x/y/z`、`temp`、`simulationTime`、`received_at`、`simulate_speed`。
  - `station_action`（`type=action`，事件）：tag 同上；field 同上 + `rot_speed`/`pos_speed`/`scale_speed`（通道速度）。
- **两个时刻**：Point 的 `time` = 实际接收时刻（保证时序正确）；`simulationTime` 作为 field 记录仿真内部时钟（action 兼容旧字段名 `timestamp`）。
- **部分写入**：只写数据中出现的维度/轴，缺失的不写（InfluxDB field 不可为 null）。
- **验证**：
  - 独立验证（无需仿真）：参考 `backend/src/influx_writer.py` 自写一小段写入代码，或用 `influxdb3` CLI 手动写入后在 Explorer 查看（best-effort，非必需）。
  - 在线验证：`GET /status` 看 `influxdb.write_count` 增长、`last_error=null`。
  - 浏览器查看：Explorer `http://localhost:8888` → `SELECT * FROM station_state ORDER BY time DESC LIMIT 50`。
