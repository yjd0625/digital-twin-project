# 数字孪生后端服务

Python 后端，基于 **FastAPI** 实现，负责：
1. 通过 TCP Socket 接收 PlantSimulation 的实时数据
2. 通过 WebSocket（路径 `/ws`）向前端推送数据
3. 接收前端指令并转发给 PlantSimulation
4. 通过 REST 接口提供健康检查、状态查询与指令转发
5. 自带 **Swagger 交互式文档**（见 `/docs`）

## 目录说明

| 路径 | 说明 |
|------|------|
| src/config.py | 全局配置（主机、端口、日志级别） |
| src/plant_connector.py | PlantSimulation TCP Socket 通信 |
| src/websocket_handler.py | WebSocket 连接管理与广播（FastAPI WebSocket） |
| src/data_processor.py | 数据解析与格式化 |
| src/main.py | FastAPI 应用入口（含路由与 lifespan） |
| tests/ | 单元测试 |
| logs/ | 运行时日志（可选） |

## 启动

```bash
cd backend
pip install -r requirements.txt
python -m src.main
```

服务默认监听 `0.0.0.0:8000`，HTTP 与 WebSocket 共用该端口。

环境变量可覆盖配置，例如：

```bash
PLANT_PORT=30001 HTTP_PORT=8080 python -m src.main
```

## 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| WS | `/ws` | 前端实时通道：接收前端指令转发给 PlantSimulation，并接收 Plant 广播 |
| GET | `/health` | 健康检查：`{"status":"ok","plant_connected":bool}` |
| GET | `/status` | 运行状态：前端连接数 + Plant 连接状态 |
| POST | `/command` | 发送指令给 PlantSimulation，body：`{"command":"xxx"}` |

## Swagger 文档

启动后访问：

- 交互式文档（Swagger UI）：`http://localhost:8000/docs`
- OpenAPI JSON：`http://localhost:8000/openapi.json`

> 注：WebSocket 接口 `/ws` 不会出现在 Swagger 中（Swagger 仅描述 HTTP 路由）；
> 其连接串为 `ws://localhost:8000/ws`，前端 `main.js` 已据此配置。

## 前端对接

前端通过 `ws://localhost:8000/ws` 建立实时连接（见 `frontend/src/main.js`）。
若需修改端口，同步调整后端 `HTTP_PORT` 与前端连接串即可。
