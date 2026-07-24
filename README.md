# Digital Twin - PlantSimulation 数字孪生系统

基于 PlantSimulation 的 3D 数字孪生可视化系统：后端通过 TCP 接入 PlantSimulation 仿真，经 Redis 消息总线转发，前端用 Three.js 实时渲染；时序数据可存入 InfluxDB 3，通过 InfluxDB3 Explorer 查看。

> 本仓库是**源码仓库**（前端 + 后端 + 文档）。运行所需的若干组件需你在本机自行安装或准备——详见下方「仓库内含 / 需自准备」对照表。

## 仓库内含 / 需自准备

### ✅ 随仓库发布（`git clone` 即得）

| 路径 | 说明 |
|------|------|
| `backend/` | Python 后端：FastAPI + Redis 消息总线 + TCP 通信 |
| `frontend/` | Three.js 3D 可视化前端（Vite） |
| `simulation/` | PlantSimulation 仿真相关（含示例 SimTalk 脚本） |
| `docs/` | 接口、架构、部署文档 |
| `docker-compose.yml` | 一键编排全部组件（Redis / InfluxDB 3 / Explorer / 后端 / 前端） |
| `.env.example` | Docker Compose 环境变量模板（复制为 `.env` 后填写） |
| `requirements.txt` | 后端 Python 依赖清单 |

### 🔧 需你本机自行安装 / 准备（**不在仓库内**）

| 组件 | 用途 | 是否必选 | 怎么准备 |
|------|------|----------|----------|
| **Docker Desktop** | 方式一（推荐）用它一键编排全部组件 | 方式一必选 | 安装并启动 |
| **Python** | 运行后端（方式二） | 方式二必选 | 建议用 conda 建 `DT` 环境并 `pip install -r requirements.txt` |
| **Node.js** | 运行前端（方式二） | 方式二必选 | 安装后 `npm install` |
| **Redis** | 消息总线（必选；`BUS_TYPE` 目前仅支持 `redis`） | 必选 | 方式一由 compose 自动起；方式二用 `docker run redis` 或本机原生 |
| **InfluxDB 3 Core** | 时序数据库（可选增强） | 可选 | 方式一由 compose 起；方式二官网下载原生二进制 |
| **PlantSimulation** | 仿真数据来源 | 可选 | 自行安装（商业软件，不随仓库提供） |

> 必选 = 后端 + 前端 + Redis（方式一由 compose 提供 Redis；方式二需你自备）。InfluxDB / Explorer / PlantSimulation 为可选增强或数据源。

## 快速开始

本项目提供两种**等价**的启动方式，**都不依赖任何启动脚本**（脚本不在仓库内）：

- **方式一：Docker Compose 一键启动（推荐）**——一条命令起全部五个组件。
- **方式二：原生命令行逐步启动**——在本机 Python / Node / Docker 环境里分别敲命令，便于单步调试。

---

### 方式一：Docker Compose 一键启动（推荐）

1. 安装 Docker Desktop 并启动。
2. 复制环境变量模板并**填写令牌**（必填）：

```bash
cp .env.example .env
```

用编辑器打开 `.env`，设置以下两项（其余保持默认即可）：

- **`INFLUXDB3_AUTH_TOKEN`（必填）**：InfluxDB 3 Core 管理员令牌。必须带 `apiv3_` 前缀，例如：
  - 生成：`openssl rand -hex 16`，取输出拼上前缀 `apiv3_`，例如 `apiv3_9f2a7c4e8b1d2c3f`；
  - 该令牌由 `influxdb3/entrypoint.sh` 通过 `--admin-token-file` 预设为 InfluxDB 的**服务端** admin token，并同时经 `DEFAULT_API_TOKEN` 注入 Explorer / 后端，**三方共用同一令牌、无需手动配置 Explorer**。
  - ⚠️ 重要：`INFLUXDB3_AUTH_TOKEN` 环境变量本身**只用于 InfluxDB CLI 客户端认证**，`influxdb3 serve` 不会读取它来预设 token。本项目用 entrypoint 脚本把同一个值写成离线 token 文件来预设，从而服务端 token 与 `.env` 始终一致。
- **`EXPLORER_SESSION_SECRET_KEY`（建议填）**：`openssl rand -hex 32` 取输出填入，用于 Explorer 会话安全。

> 只需安装 Docker（含 Compose 插件）即可，无需在本机装 Python / Node.js——后端与前端都在各自容器内构建运行。

3. 一键启动：

```bash
docker compose up -d
```

启动后访问：

| 组件 | 地址 |
|------|------|
| 前端 | http://localhost:8080 |
| 后端 WebSocket | ws://localhost:8300/ws |
| InfluxDB 3 | http://localhost:18080 |
| Explorer | http://localhost:8888 |
| Redis | 6379（容器内，自动编排，无需单独起） |

常用命令：

```bash
docker compose ps                 # 查看五个容器状态
docker compose logs -f backend    # 跟踪某服务日志（排错用）
docker compose restart frontend   # 单独重启某服务
docker compose down               # 停止全部（加 -v 删除 redis 数据卷）
```

> **令牌说明**：InfluxDB 与 Explorer 与后端共用 `.env` 里的 `INFLUXDB3_AUTH_TOKEN`（见上方第 2 步），由 `influxdb3/entrypoint.sh` 预设为服务端 token。若之后要**更换**令牌：先在 `.env` 改 `INFLUXDB3_AUTH_TOKEN`，再清空 `./.docker/influxdb3-data` 目录内容（保留空文件夹），然后 `docker compose up -d influxdb3 explorer` 重建——InfluxDB 会用新令牌重新初始化，Explorer 同步新值。注意：不重建数据目录直接改 `.env` 会因"已存在 token 与新 token 不符"而报 `INVALID_TOKEN_CORE`。

---

### 方式二：原生命令行逐步启动（不依赖 Docker 编排）

适合想用本机 Python / Node 环境直接调试的场景。每个组件都是独立命令，**无需任何 `.bat` / 脚本**。

#### 1. Redis（消息总线，必选）

```bash
docker run -d --name redis-twin --restart unless-stopped -p 6379:6379 redis:7-alpine
```

`6379` 端口需可用。验证：`docker exec redis-twin redis-cli ping` → `PONG`（本机装了 redis-cli 也可直接 `redis-cli ping`）。
本机已原生安装 Redis 并设为自启动的，可跳过这一步。

#### 2. InfluxDB 3 Core（时序库，可选）

1. 从官网下载 InfluxDB 3 Core 并解压到本机。
2. **首次启动会生成管理员令牌**：在终端运行以下命令，控制台会打印一串 `apiv3_...` 令牌，**请保存备用**（前端 / Explorer 连接需用到）。

```bash
"<InfluxDB3 安装路径>/influxdb3.exe" serve --node-id=<节点名，如 node0> --object-store=file --data-dir=<数据目录> --http-bind=0.0.0.0:18080 --admin-token-recovery-http-bind=127.0.0.1:18081
```

3. **务必绑定 `0.0.0.0`**（不要 `127.0.0.1`）——否则后面的 Explorer（运行在 Docker 容器内）连不上。
4. 验证：`curl http://localhost:18080/health` 返回 `401` 即正常（该端点需鉴权）。

> ⚠️ 端口避坑：HTTP 端口必须避开 Windows 为 Docker / Hyper-V 预留的区段（用 `netsh interface ipv4 show excludedportrange protocol=tcp` 查看）。旧值 `8181/8182` 落在预留段 `8103-8202` 内会绑定失败，故用 `18080/18081`。

#### 3. InfluxDB3 Explorer（Web 查看器，可选）

Explorer 是 Docker 容器，直接执行以下单行命令（`<...>` 处替换为你的实际值；`SESSION_SECRET_KEY` 用 `openssl rand -hex 32` 生成一个随机串）：

```bash
docker run -d --name influxdb3-explorer -p 127.0.0.1:8888:8080 -v <配置目录>:/app-root/config:ro -v <会话库目录>:/db:rw -e SESSION_SECRET_KEY=<随机32字节hex> -e DEFAULT_API_TOKEN=<你的 apiv3_ 令牌> -e DEFAULT_INFLUX_SERVER=http://host.docker.internal:18080 -e "DEFAULT_SERVER_NAME=Local InfluxDB 3" -e DEFAULT_INFLUX_DATABASE= influxdata/influxdb3-ui:1.9.0 --mode=admin
```

要点：

- **`DEFAULT_INFLUX_SERVER` 必须用 `host.docker.internal`**（不要用 `localhost`）——容器内 `localhost` 指向容器自己。
- 必须挂载可写 `db` 卷并设置 `SESSION_SECRET_KEY`，否则报 `Error while getting session data`。
- `DEFAULT_*` 环境变量用于让 Explorer 首次启动时自动预载服务器；若不用，也可在 Web 界面手动填写（Server URL 同样填 `http://host.docker.internal:18080`）。
- 浏览器打开 http://localhost:8888 → 应自动连上 "Local InfluxDB 3"，否则手动 Add Server。

#### 4. 后端（FastAPI，必选）

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

#### 5. 前端（Vite，必选）

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 http://localhost:5173（前端通过 `ws://localhost:8300/ws` 连后端）。

> 若本机 `5173` 被占用（常见于 Windows + WSL2 把该端口划为系统保留），可在 `frontend/vite.config.js` 改 `server.port`，或改用方式一的 Docker 前端（默认 8080，已避开常见保留段）。

#### 6. PlantSimulation（仿真数据源，可选）

1. 准备好仿真模型（`.spp` 不随仓库提供）。
2. 运行仿真，类库中添加 Socket 。
3. 确保 Socket 服务器已启动，监听 `30000` 端口。

#### 7. 访问

浏览器打开对应前端地址即可看到 3D 可视化：
- 方式一（Docker）：http://localhost:8080
- 方式二（原生）：http://localhost:5173

---

## 端口总览

| 组件 | 方式一 Docker 宿主端口 | 方式二 原生命令行端口 | 说明 |
|------|----------------------|----------------------|------|
| 前端 (Vite) | **8080**（容器 5173） | 5173 | Docker 方式用 8080 避开 Windows 保留段 |
| 后端 (FastAPI) | 8300 | 8300 | HTTP 与 WebSocket 共用 |
| InfluxDB 3 Core | 18080 | 18080 | 绑定 `0.0.0.0` |
| InfluxDB3 Explorer | 8888 | 8888 | 映射 8888 → 容器 8080 |
| Redis | 6379 | 6379 | 消息总线（必选） |
| PlantSimulation | — | 30000 | 仿真 TCP 端口（可选） |

> 本机端口：`8080/8300/18080/8888/6379`（Docker）或 `5173/8300/18080/8888/6379`（原生）· `30000`(PlantSimulation)。若被占用，启动前需释放或改用其他端口。

## Windows 端口保留排错

在 **Windows + WSL2 / Docker Desktop** 上，`docker compose up` 偶尔报：

```
ports are not available: exposing port TCP 0.0.0.0:XXXX -> ... listen tcp ...: bind: access forbidden
```

这表示该宿主端口被 Windows 划为**排除端口范围（excluded port range）**——并非被某进程占用，杀进程也解不了。原因：Docker 建容器网络时 Windows 会随机保留一段端口给 NAT 用，段内所有端口对 Docker 和本机应用都暂时不可用（5173 / 3000 / 5000 等开发者常用端口尤其易中招）。该保留段是动态的，重启 Windows / Docker 后可能变化。

排查与解决：

```powershell
# 管理员 PowerShell 查看被保留的端口段
netsh int ipv4 show excludedportrange protocol=tcp
```

- 若项目默认端口（如前端 8080）恰好落在某段内，编辑 `docker-compose.yml` 把对应服务的宿主端口改到空闲段（格式 `"宿主端口:容器端口"`），例如 `"9000:5173"`；
- 本机原生 `npm run dev` 同理：改 `frontend/vite.config.js` 的 `server.port`；
- 想彻底释放保留段可管理员 PowerShell 执行 `net stop winnat` / `net start winnat`，但重启可能复发，故通常改端口更稳。

## Explorer 连接 InfluxDB 的关键点

Explorer 后端运行在 Docker 容器内，通过 `http://host.docker.internal:18080` 访问宿主机 InfluxDB（容器内 `localhost` 指向容器自己）。因此：

- InfluxDB 必须绑定 **`0.0.0.0:18080`**（而非 `127.0.0.1`），容器才能访问；
- Explorer 的 Server URL 须为 `host.docker.internal`（手动填写时同理）；
- Windows Docker Desktop 不支持 `--network host`（Linux 才有），故采用此标准做法；
- 必须挂载可写 `db` 卷并设置 `SESSION_SECRET_KEY`，否则报 `Error while getting session data`。

> 安全提示：`0.0.0.0:18080` 会把 InfluxDB 暴露到本机所在局域网。本机开发通常无碍；若在不可信网络，可改为绑定具体内网 IP。

## InfluxDB 令牌排错（INVALID_TOKEN_CORE）

若 Explorer 日志出现 `INVALID_TOKEN_CORE` / `Invalid API token for Core/Enterprise product`（HTTP 401），说明 Explorer 发去的 token 与 InfluxDB 实际接受的 token 不一致。成因与解决：

- **根因**：`INFLUXDB3_AUTH_TOKEN` 环境变量只供 CLI 客户端认证，`influxdb3 serve` 不会用它预设 token。本项目已用 `influxdb3/entrypoint.sh` 通过 `--admin-token-file` 把 `.env` 的 token 预设为服务端 token；若你跳过 entrypoint、直接在 compose 里只写 `INFLUXDB3_AUTH_TOKEN` 环境变量，InfluxDB 会自己生成随机 token，与 Explorer 的 `.env` token 不符 → 必报此错。
- **旧数据目录残留**：InfluxDB 数据目录（`.docker/influxdb3-data`）里已存有之前自动生成的 token，而你后来改了 `.env` 的 token。解决：清空 `.docker/influxdb3-data` 内容 → `docker compose up -d influxdb3 explorer` 重建。
- **确认一致**：InfluxDB / Explorer / 后端三处的 token 必须完全相同（都来自 `.env` 的 `INFLUXDB3_AUTH_TOKEN`）。改 `.env` 后切记重建 influxdb3（并清空其数据目录）。

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
- 时序存储: InfluxDB 3 Core（端口 18080；Web 界面 InfluxDB3 Explorer 1.9.0 :8888）
- 前端: Three.js + Vite
- 编排（可选）: Docker Compose 一键起全部组件

## 文档

- 接口说明：`docs/api.md`
- 系统架构：`docs/architecture.md`
- 部署指南：`docs/deployment.md`
