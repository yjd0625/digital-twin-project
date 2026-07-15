# 数字孪生后端服务

Python 后端，基于 **FastAPI** 实现，负责：
1. 通过 TCP Socket 接收 PlantSimulation 的实时数据
2. 通过 **Redis Pub/Sub 消息总线**解耦「Plant 采集」与「前端分发」
3. 通过 WebSocket（路径 `/ws`）向前端推送数据
4. 接收前端指令并（经总线）转发给 PlantSimulation
5. 通过 REST 接口提供健康检查、状态查询与指令转发
6. 自带 **Swagger 交互式文档**（见 `/docs`）

## 架构：Redis 消息总线解耦

Plant 与前端不再直连，中间经 Redis Pub/Sub 中转，为将来平滑过渡到 **MQTT** 铺路：

```
Plant(socket) → plant_read_loop → publish "plant/state" ┐
                                                          ├─ Redis ─┐
前端 WS / POST /command → publish "plant/command" ────────┘         │
                                                                     ├─ subscribe "plant/state"   → handler.broadcast → 前端 WS
                                                                     └─ subscribe "plant/command" → plant.send → Plant
```

- 传输层抽象为 `src/bus.py` 的 `MessageBus` 接口，现有实现 `RedisBus`；将来新增 `MqttBus` 并把 `BUS_TYPE` 改为 `mqtt` 即可，业务代码不动。
- 主题用 MQTT 风格斜杠层级（`plant/state`、`plant/command`），切 MQTT 时主题名直接复用。
- **注意**：Redis Pub/Sub 无持久化，订阅者离线期间的消息会丢（实时流可接受）；需要「重连补发」时再上 MQTT 的 QoS。

## 目录说明

| 路径 | 说明 |
|------|------|
| src/config.py | 全局配置（主机、端口、Redis、topic、日志级别） |
| src/bus.py | 消息总线抽象 + RedisBus 实现（为将来 MQTT 预留） |
| src/plant_connector.py | PlantSimulation TCP Socket 通信 |
| src/websocket_handler.py | WebSocket 连接管理与广播（指令经总线发布） |
| src/data_processor.py | 数据解析与格式化 |
| src/main.py | FastAPI 应用入口（含路由、lifespan、采集/分发任务） |
| tests/ | 单元测试 |
| logs/ | 运行时日志（可选） |

## 启动

前置：需先启动 **Redis 服务端**（默认 `127.0.0.1:6379`）。

```bash
cd backend
pip install -r requirements.txt
python -m src.main
```

服务默认监听 `0.0.0.0:8300`，HTTP 与 WebSocket 共用该端口。

> 说明：默认避开 Windows（Docker/WSL 引入）保留的 `7903–8202` 端口区间，改用 8300。

环境变量可覆盖配置，例如：

```bash
PLANT_PORT=30001 HTTP_PORT=8300 REDIS_HOST=127.0.0.1 REDIS_PORT=6379 python -m src.main
```

### Redis 相关配置

| 变量 | 默认 | 说明 |
|------|------|------|
| `BUS_TYPE` | `redis` | 消息总线类型，预留 `mqtt` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | `127.0.0.1` / `6379` / `0` | Redis 连接 |
| `REDIS_PROTOCOL` | `2` | RESP 协议版本。**老版 Redis（如 Windows 3.x 移植版）不支持 RESP3 的 `HELLO`，必须用 2**；Redis≥6 可设 `3` |
| `TOPIC_PLANT_STATE` | `plant/state` | Plant→前端 状态主题 |
| `TOPIC_PLANT_COMMAND` | `plant/command` | 前端/REST→Plant 指令主题 |

> **端口提示**：Docker/WSL 会在 Windows 上保留一批端口区间（`netsh interface ipv4 show excludedportrange protocol=tcp` 查看，本机为 `7903–8202`、`50000–50059` 等），落在其中的端口 bind 会报 WinError 10013。默认已选用区间外的 `8300`；若想用其他端口，请先确认不在排除区间内。

## 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| WS | `/ws` | 前端实时通道：接收前端指令转发给 PlantSimulation，并接收 Plant 广播 |
| GET | `/health` | 健康检查：`{"status":"ok","plant_connected":bool}` |
| GET | `/status` | 运行状态：前端连接数 + Plant 连接状态 + 总线连接状态 |
| POST | `/command` | 发布指令到 `plant/command` 主题，body：`{"command":"xxx"}`。返回 200 仅表示已发布到总线，是否送达 Plant 看 `/status` |

## Swagger 文档

启动后访问：

- 交互式文档（Swagger UI）：`http://localhost:8300/docs`
- OpenAPI JSON：`http://localhost:8300/openapi.json`

> 注：WebSocket 接口 `/ws` 不会出现在 Swagger 中（Swagger 仅描述 HTTP 路由）；
> 其连接串为 `ws://localhost:8300/ws`，前端 `main.js` 已据此配置。

## 前端对接

前端通过 `ws://localhost:8300/ws` 建立实时连接（见 `frontend/src/main.js`）。
若需修改端口，同步调整后端 `HTTP_PORT` 与前端连接串即可。
