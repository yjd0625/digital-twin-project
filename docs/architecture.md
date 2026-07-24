# 系统架构

## 整体架构

   PlantSimulation                Python 后端 (FastAPI, :8300)             前端浏览器
  (仿真引擎, :30000)        采集端 / 分发端 (同一进程)              (Three.js 3D)
 ┌──────────────┐           ┌──────────────────────┐              ┌──────────────────┐
 │              │ TCP:30000 │ publish plant/state   │  WebSocket  │                  │
 │  PlantSim    │──────────>│ subscribe plant/cmd   │  :8300/ws   │  前端            │
 │              │<──────────│                       │────────────>│                  │
 └──────────────┘  command  └──────────┬───────────┘              └──────────────────┘
                                        │ publish/subscribe
                                        ▼
                               ┌──────────────────────┐
                               │  Redis Pub/Sub       │
                               │  本地原生 :6379       │
                               │  (或 redis-twin)      │
                               │  plant/state         │
                               │  plant/command       │
                               └──────────────────────┘

   InfluxDB 3 Core (原生 :18080)  ──时序数据──▶  InfluxDB3 Explorer (Docker :8888)
   （注：Explorer 后端在容器内，经 host.docker.internal:18080 访问宿主机 InfluxDB）

## 数据流

1. PlantSimulation 通过 TCP Socket (port 30000) 向 Python 后端发送实时仿真数据
2. 后端采集端解析数据后，publish 到 Redis 主题 `plant/state`
3. 后端分发端订阅 `plant/state`，通过 WebSocket (ws://localhost:8300/ws) 广播给所有已连接的前端
4. 前端 Three.js 场景根据接收到的数据驱动 3D 对象状态
5. 用户通过前端按钮 / POST /command 发送指令 → publish 到 `plant/command` → 后端订阅后通过 TCP Socket 下发 PlantSimulation

## 技术栈

| 层 | 技术 |
|-----|------|
| 仿真 | PlantSimulation (SimTalk) |
| 后端 | Python + FastAPI + redis + websockets |
| 前端 | Three.js + Vite |
| 通信 | TCP Socket (仿真<->后端), WebSocket (后端<->前端), Redis Pub/Sub (后端<->后端, 解耦) |
| 消息总线 | Redis Pub/Sub（Docker 容器 `redis-twin:6379`，或本机原生 `E:\Redis\redis-server.exe:6379`；主题 plant/state、plant/command） |
