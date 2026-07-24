# 系统架构

## 整体架构

   数据源 (Simulator)              Python 后端 (FastAPI, :8300)             前端浏览器
  (仿真引擎, :30000)        采集端 / 分发端 (同一进程)              (Three.js 3D)
 ┌──────────────┐           ┌──────────────────────┐              ┌──────────────────┐
 │              │ TCP:30000 │ publish source/state  │  WebSocket  │                  │
 │  数据源       │──────────>│ (单向读取，无 command) │  :8300/ws   │  前端            │
 │              │  状态      │                       │────────────>│                  │
 └──────────────┘           └──────────┬───────────┘              └──────────────────┘
                                        │ publish/subscribe
                                        ▼
                               ┌──────────────────────┐
                               │  Redis Pub/Sub       │
                               │  本地原生 :6379       │
                               │  (或 redis-twin)      │
                               │  source/state        │
                               └──────────────────────┘

   InfluxDB 3 Core (原生 :18080)  ──时序数据──▶  InfluxDB3 Explorer (Docker :8888)
   （注：Explorer 后端在容器内，经 host.docker.internal:18080 访问宿主机 InfluxDB）

> 实时环为**单向**：数据源 → 后端 → 前端。原「指令上行 / POST /command」控制通道已随架构解耦移除；后端作为 TCP 客户端连接数据源（默认 Python 实时仿真器，TCP 服务端监听 30000），断线每 3s 自动重连。PlantSimulation 已降级为只读分析外挂：订阅 `source/state` 做预测/推演，不参与实时控制环。

## 数据流

1. 数据源（默认 Python 实时仿真器 `connectors/sources/python_realtime.py`）作为 TCP 服务端监听 `:30000`，向后端推送实时仿真数据
2. 后端采集端（TCP 客户端）解析数据后，publish 到 Redis 主题 `source/state`
3. 后端分发端订阅 `source/state`，通过 WebSocket (ws://localhost:8300/ws) 广播给所有已连接的前端
4. 前端 Three.js 场景根据接收到的数据驱动 3D 对象状态
5. （可选）后端采集端解析到 `type=state` / `type=action` 时，旁路写入 InfluxDB 3：`station_state`（每帧快照）、`station_action`（动作事件），best-effort，不阻塞实时流。字段映射见 `docs/api.md`「时序数据库写入」一节。

## 技术栈

| 层 | 技术 |
|-----|------|
| 仿真 | 数据源中立（默认 Python 实时仿真器；PlantSimulation 可作为分析外挂订阅 source/state） |
| 后端 | Python + FastAPI + redis + websockets + influxdb3-python（InfluxDB 3 旁路写入） |
| 前端 | Three.js + Vite |
| 通信 | TCP Socket (数据源<->后端), WebSocket (后端<->前端), Redis Pub/Sub (后端内部解耦) |
| 消息总线 | Redis Pub/Sub（推荐用 Docker Compose 编排的 `dt-redis:6379`，或手动 `docker run redis-twin:6379`；Windows 原生 Redis 支持差，不推荐；主题 source/state） |
