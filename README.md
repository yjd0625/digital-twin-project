# Digital Twin - PlantSimulation 数字孪生系统

基于 PlantSimulation 的 3D 数字孪生可视化系统：后端通过 TCP 接入 PlantSimulation 仿真，经 Redis 消息总线转发，前端用 Three.js 实时渲染；时序数据存入 InfluxDB 3，可通过 InfluxDB3 Explorer 查看。

> 本仓库是**源码仓库**（前端 + 后端 + 文档）。运行所需的若干组件需你在本机自行安装或准备——详见下方「仓库内含 / 需自准备」对照表。
> ，所有组件均通过下方的手动命令启动。

## 仓库内含 / 需自准备

### ✅ 随仓库发布（`git clone` 即得）

| 路径 | 说明 |
|------|------|
| `backend/` | Python 后端：FastAPI + Redis 消息总线 + TCP 通信 |
| `frontend/` | Three.js 3D 可视化前端（Vite） |
| `simulation/` | PlantSimulation 仿真相关（含示例 SimTalk 脚本） |
| `docs/` | 接口、架构、部署文档 |
| `requirements.txt` | 后端 Python 依赖清单 |

### 🔧 需你本机自行安装 / 准备（**不在仓库内**）

| 组件 | 用途 | 是否必选 | 怎么准备 |
|------|------|----------|----------|
| **Redis** | 消息总线，解耦 Plant 采集端与前端订阅端（必选；`BUS_TYPE` 目前仅支持 `redis`） | **必选** | Docker 跑 `redis-twin` 容器，或本机原生安装 |
| **Python** | 运行后端 | **必选** | 建议用 conda 建 `DT` 环境并 `pip install -r requirements.txt` |
| **Node.js** | 运行前端 | **必选** | 安装后 `npm install` |
| **InfluxDB 3 Core** | 时序数据库（可选增强） | 可选 | 官网下载，装到本机 |
| **Docker Desktop** | 用于跑 Redis 与 Explorer 容器 | 可选（用原生 Redis 时不需要） | 安装并启动 |
| **PlantSimulation** | 仿真数据来源 | 可选（实时仿真数据来源） | 自行安装（商业软件，不随仓库提供） |


> 必选 = 后端 + 前端 + Redis，三者缺一不可；InfluxDB / Explorer / PlantSimulation 为可选增强或数据源。


## 手动启动（逐步）

### 1. Redis（消息总线，必选）

```bash
docker run -d --name redis-twin --restart unless-stopped -p 6379:6379 redis:7-alpine
```

`6379` 端口需可用。验证：`docker exec redis-twin redis-cli ping` → `PONG`（本机装了 redis-cli 也可直接 `redis-cli ping`）。
本机已原生安装 Redis 并设为自启动的，可跳过这一步。

### 2. InfluxDB 3 Core（时序库，可选）

1. 从官网下载 InfluxDB 3 Core 并解压到本机。
2. **首次启动会生成管理员令牌**：在终端运行以下命令，控制台会打印一串 `apiv3_...` 令牌，**请保存备用**（前端 / Explorer 连接需用到）。

```bash
"<InfluxDB3 安装路径>/influxdb3.exe" serve --node-id=<节点名，如 node0> --object-store=file --data-dir=<数据目录> --http-bind=0.0.0.0:18080 --admin-token-recovery-http-bind=127.0.0.1:18081
```

3. **务必绑定 `0.0.0.0`**（不要 `127.0.0.1`）——否则后面的 Explorer（运行在 Docker 容器内）连不上。
4. 验证：`curl http://localhost:18080/health` 返回 `401` 即正常（该端点需鉴权）。

> ⚠️ 端口避坑：HTTP 端口必须避开 Windows 为 Docker / Hyper-V 预留的区段（用 `netsh interface ipv4 show excludedportrange protocol=tcp` 查看）。旧值 `8181/8182` 落在预留段 `8103-8202` 内会绑定失败，故用 `18080/18081`。

### 3. InfluxDB3 Explorer（Web 查看器，可选）

Explorer 是 Docker 容器，直接执行以下单行命令（`<...>` 处替换为你的实际值；`SESSION_SECRET_KEY` 用 `openssl rand -hex 32` 生成一个随机串）：

```bash
docker run -d --name influxdb3-explorer -p 127.0.0.1:8888:8080 -v <配置目录>:/app-root/config:ro -v <会话库目录>:/db:rw -e SESSION_SECRET_KEY=<随机32字节hex> -e DEFAULT_API_TOKEN=<你的 apiv3_ 令牌> -e DEFAULT_INFLUX_SERVER=http://host.docker.internal:18080 -e "DEFAULT_SERVER_NAME=Local InfluxDB 3" -e DEFAULT_INFLUX_DATABASE= influxdata/influxdb3-ui:1.9.0 --mode=admin
```

要点：

- **`DEFAULT_INFLUX_SERVER` 必须用 `host.docker.internal`**（不要用 `localhost`）——容器内 `localhost` 指向容器自己。
- 必须挂载可写 `db` 卷并设置 `SESSION_SECRET_KEY`，否则报 `Error while getting session data`。
- `DEFAULT_*` 环境变量用于让 Explorer 首次启动时自动预载服务器；若不用，也可在 Web 界面手动填写（Server URL 同样填 `http://host.docker.internal:18080`）。
- 浏览器打开 http://localhost:8888 → 应自动连上 "Local InfluxDB 3"，否则手动 Add Server。

### 4. 后端（FastAPI，必选）

```bash
conda activate DT            # 或你的 Python 环境
cd backend
pip install -r requirements.txt
python -m src.main
```

- 默认监听 `0.0.0.0:8300`（HTTP 与 WebSocket 共用）。
- 依赖：`fastapi` / `uvicorn` / `redis` / `websockets`（见 `requirements.txt`）。
- Redis 未运行时后端仍可启动（启动期容错），但数据无法经总线流转；请保证 Redis 已就绪。

#### 启用 InfluxDB 时序写入（可选）

后端默认**不**写库（`INFLUXDB_ENABLED=false`）。要启用，设置环境变量后启动后端：

```bash
# backend 目录下，启动前设置（Windows cmd）
set INFLUXDB_ENABLED=true
# 若 InfluxDB 3 设了鉴权，提供令牌（建议走环境变量 / .env，勿硬编码进仓库）
set INFLUXDB_TOKEN=apiv3_xxxxxxxx
python -m src.main
```

- 写入为 best-effort：写库失败仅记日志，不影响实时孪生流。
- 建库（首次）：`influxdb3 create database digital_twin`；measurement 首写自动创建，无需预建表。
- 验证：浏览器开 `http://localhost:8300/status`，看 `influxdb.write_count` 是否增长、`last_error` 是否为 null；或直接到 Explorer 查 `SELECT * FROM station_state`。
- 也可不启动后端，单独跑 `python scripts/test_influx_write.py` 验证写入链路（用内置样例数据）。

### 5. 前端（Vite，必选）

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 http://localhost:5173（前端通过 `ws://localhost:8300/ws` 连后端）。

### 6. PlantSimulation（仿真数据源，可选）

1. 准备好仿真模型（`.spp` 不随仓库提供）。
2. 运行仿真，类库中添加 Socket 。
3. 确保 Socket 服务器已启动，监听 `30000` 端口。

### 7. 访问

浏览器打开 http://localhost:5173 即可看到 3D 可视化。

## 最小可跑（后端 + 前端 + Redis，无需 InfluxDB / Explorer / Docker）

必选三件套即可让整套服务跑起来（无实时时序数据落库，但实时孪生流可工作）：确保 Redis 已启动（见步骤 1），然后：

```bash
# 终端 1 - 后端
conda activate DT
cd backend
python -m src.main

# 终端 2 - 前端
cd frontend
npm install
npm run dev
```

浏览器打开 http://localhost:5173。

## 端口总览

| 组件 | 端口 | 说明 |
|------|------|------|
| Redis | 6379 | 消息总线（必选） |
| InfluxDB 3 Core | 18080 | 时序库，绑定 `0.0.0.0`（可选） |
| InfluxDB3 Explorer | 8888 | Web 界面，映射 8888 → 容器 8080（Docker，可选） |
| 后端 (FastAPI) | 8300 | HTTP 与 WebSocket 共用 |
| 前端 (Vite) | 5173 | 3D 可视化 |
| PlantSimulation | 30000 | 仿真 TCP 端口（可选） |

本机端口：`6379`(Redis) · `18080`(InfluxDB) · `8888`(Explorer) · `8300`(后端) · `5173`(前端) · `30000`(PlantSimulation)。若被占用，启动前需释放或改用其他端口。

## Explorer 连接 InfluxDB 的关键点

Explorer 后端运行在 Docker 容器内，通过 `http://host.docker.internal:18080` 访问宿主机 InfluxDB（容器内 `localhost` 指向容器自己）。因此：

- InfluxDB 必须绑定 **`0.0.0.0:18080`**（而非 `127.0.0.1`），容器才能访问；
- Explorer 的 Server URL 须为 `host.docker.internal`（手动填写时同理）；
- Windows Docker Desktop 不支持 `--network host`（Linux 才有），故采用此标准做法；
- 必须挂载可写 `db` 卷并设置 `SESSION_SECRET_KEY`，否则报 `Error while getting session data`。

> 安全提示：`0.0.0.0:18080` 会把 InfluxDB 暴露到本机所在局域网。本机开发通常无碍；若在不可信网络，可改为绑定具体内网 IP。

## 数据流

```
PlantSimulation
  │  (TCP:30000)
  ▼
后端采集端  →  publish "plant/state"  →  【Redis Pub/Sub】
                                          │
                                          ▼  subscribe
                                       后端订阅端  →  (WebSocket:8300)  →  前端浏览器

前端指令 / POST /command  →  publish "plant/command"  →  【Redis Pub/Sub】  →  采集端  →  (TCP:30000)  →  PlantSimulation
```

简化：`PlantSimulation → (TCP:30000) → 后端 →【Redis 总线】→ (WebSocket:8300) → 前端`

后端采集端解析到 `state` / `action` 时，还会**旁路写入 InfluxDB 3**（measurement 分别为 `station_state` / `station_action`，best-effort，不阻塞主流程）：

```
后端采集端  ──parsed state──▶  station_state   ┐
             ──parsed action─▶  station_action  ├─▶ InfluxDB 3 Core (:18080) ─▶ Explorer (:8888)
             （time=接收时刻, simulationTime=仿真时刻, 只写出现的维度）
```

## 技术栈

- 仿真: PlantSimulation (SimTalk)
- 后端: Python + FastAPI + uvicorn + redis (asyncio) + websockets
- 消息总线: Redis Pub/Sub（传输无关抽象，支持后续平滑切换 MQTT；`BUS_TYPE` 目前仅支持 `redis`）
- 时序存储: InfluxDB 3 Core（本机原生二进制，端口 18080；Web 界面 InfluxDB3 Explorer 1.9.0 :8888）
- 前端: Three.js + Vite

## 文档

- 接口说明：`docs/api.md`
- 系统架构：`docs/architecture.md`
- 部署指南：`docs/deployment.md`
