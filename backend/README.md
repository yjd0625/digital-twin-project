# 数字孪生后端服务

Python 后端，基于 **FastAPI** 实现，负责：
1. 通过 TCP Socket 接收**数据源(Source)**的实时数据（默认是 `connectors/sources/python_realtime.py` 的 Python 演示仿真器，也可接入任意实现了连接器协议的服务）
2. 通过 **Redis Pub/Sub 消息总线**解耦「数据源采集」与「前端分发」
3. 通过 WebSocket（路径 `/ws`）向前端推送数据
4. 通过 REST 接口提供健康检查、状态查询（控制指令上行通道已移除，见下）
5. 自带 **Swagger 交互式文档**（见 `/docs`）

> **架构定位（2026-07 解耦）**：实时环为**单向**——`数据源 → 后端 → 前端`。
> 原 `plant/command`（前端/REST → PlantSimulation 的实时控制回写）已随「断开
> Plant Simulation 实时架构」一并移除。Plant Simulation 现作为**分析外挂**，
> 仅订阅 `source/state` 只读消费，用于重型仿真引擎做**预测/推演（what-if，异步、非实时）**。
> 后续若需把推演场景参数发回数据源，走独立异步通道 `source/prediction`（待开发）。

## 架构：Redis 消息总线解耦

数据源与前端不再直连，中间经 Redis Pub/Sub 中转，为将来平滑过渡到 **MQTT** 铺路：

```
数据源(Source, socket) → source_read_loop → publish "source/state" ┐
                                                                     ├─ Redis ─┐
                                                                     │         │
                                                                     └─ subscribe "source/state" → handler.broadcast → 前端 WS
```

- 传输层抽象为 `src/bus.py` 的 `MessageBus` 接口，现有实现 `RedisBus`；将来新增 `MqttBus` 并把 `BUS_TYPE` 改为 `mqtt` 即可，业务代码不动。
- 主题用 MQTT 风格斜杠层级（`source/state`）；切 MQTT 时主题名直接复用。
- **注意**：Redis Pub/Sub 无持久化，订阅者离线期间的消息会丢（实时流可接受）；需要「重连补发」时再上 MQTT 的 QoS。

## 目录说明

| 路径 | 说明 |
|------|------|
| src/config.py | 全局配置（数据源主机/端口、Redis、topic、日志级别） |
| src/bus.py | 消息总线抽象 + RedisBus 实现（为将来 MQTT 预留） |
| src/source_connector.py | 到数据源的 TCP Socket 通信（后端为客户端，单向读取） |
| src/websocket_handler.py | WebSocket 连接管理与广播（实时环单向，无控制指令回写） |
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
SOURCE_PORT=30001 HTTP_PORT=8300 REDIS_HOST=127.0.0.1 REDIS_PORT=6379 python -m src.main
```

### 数据源 / Redis 相关配置

| 变量 | 默认 | 说明 |
|------|------|------|
| `SOURCE_HOST` / `SOURCE_PORT` | `127.0.0.1` / `30000` | 数据源（TCP 服务端）地址；后端作为客户端连接 |
| `BUS_TYPE` | `redis` | 消息总线类型，预留 `mqtt` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | `127.0.0.1` / `6379` / `0` | Redis 连接 |
| `REDIS_PROTOCOL` | `2` | RESP 协议版本。**老版 Redis（如 Windows 3.x 移植版）不支持 RESP3 的 `HELLO`，必须用 2**；Redis≥6 可设 `3` |
| `TOPIC_SOURCE_STATE` | `source/state` | 数据源→前端 状态主题 |
| ~~`TOPIC_PLANT_COMMAND`~~ | — | 已移除：原前端/REST→Plant 指令主题（实时控制回写通道已断开） |

> **端口提示**：Docker/WSL 会在 Windows 上保留一批端口区间（`netsh interface ipv4 show excludedportrange protocol=tcp` 查看，本机为 `7903–8202`、`50000–50059` 等），落在其中的端口 bind 会报 WinError 10013。默认已选用区间外的 `8300`；若想用其他端口，请先确认不在排除区间内。

## 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| WS | `/ws` | 前端实时通道：把 `source/state` 经总线收到的消息广播给前端（实时环单向，无控制指令回写） |
| GET | `/health` | 健康检查：`{"status":"ok","source_connected":bool}` |
| GET | `/status` | 运行状态：前端连接数 + 数据源连接状态 + 总线连接状态 + InfluxDB 状态 |
| ~~POST `/command`~~ | — | 已移除：实时控制指令上行通道（与 Plant 实时架构一并断开） |

## Swagger 文档

启动后访问：

- 交互式文档（Swagger UI）：`http://localhost:8300/docs`
- OpenAPI JSON：`http://localhost:8300/openapi.json`

> 注：WebSocket 接口 `/ws` 不会出现在 Swagger 中（Swagger 仅描述 HTTP 路由）；
> 其连接串为 `ws://localhost:8300/ws`，前端 `main.js` 已据此配置。

## 前端对接

前端通过 `ws://localhost:8300/ws` 建立实时连接（见 `frontend/src/main.js`）。
若需修改端口，同步调整后端 `HTTP_PORT` 与前端连接串即可。

## 数据源连接器（如何接入新源）

后端是**数据源中立**的：只要某服务在 `SOURCE_HOST:SOURCE_PORT` 上作为 TCP
服务端，按协议推送 JSON 信封（多个帧直接拼接、无换行；UTF-8；type ∈
{create,state,action,reset,attach,detach}），后端零改动即可接入。详情见
仓库根目录 `docs/CONNECTOR.md` 与 `connectors/` 包（含 `python_realtime.py` 示例）。
