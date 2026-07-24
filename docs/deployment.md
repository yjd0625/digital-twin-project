# 部署指南

> 本地一键启动见根目录 `README.md` 的「方式一：Docker Compose 一键启动」；本文件补充端口说明与原生逐步部署细节。

## 端口占用总览

| 组件 | 方式一 Docker 宿主端口 | 方式二 原生命令行端口 | 说明 |
|------|----------------------|----------------------|------|
| 前端 (Vite) | **8080**（容器 5173） | 5173 | Docker 用 8080 避开 Windows 保留段 |
| 后端 (FastAPI) | 8300 | 8300 | HTTP + WebSocket 共用 |
| InfluxDB 3 Core | 18080 | 18080 | 时序数据库（可选） |
| InfluxDB3 Explorer | 8888 | 8888 | 映射 8888→容器 8080（可选） |
| Redis | 6379 | 6379 | 消息总线（**必选**） |
| 数据源 Simulator | — | 30000 | 实时数据源 TCP 端口（可选，默认 Python 仿真器） |

> Redis 为必选消息总线；InfluxDB / Explorer 为可选增强；默认数据源是随仓库的 Python 实时仿真器（无需安装），PlantSimulation 为可选分析外挂。
> 若 Windows 上报 `access forbidden`，说明该宿主端口被 Windows 划为排除端口范围，见 README「Windows 端口保留排错」一节。

## 本地开发

### 方式一：Docker Compose 一键启动（推荐）

```bash
cp .env.example .env   # 必须填入 INFLUXDB3_AUTH_TOKEN（自己生成或启动后从日志复制，见 README「方式一」第 2 步）；EXPLORER_SESSION_SECRET_KEY 建议填
docker compose up -d
```

启动后前端访问 http://localhost:8080 ，其余地址见 README 端口总览。停止：`docker compose down`（加 `-v` 删 redis 数据卷）。

> 只需 Docker（含 Compose 插件），无需在本机装 Python / Node.js——后端与前端均在各自容器内构建运行。

### 方式二：原生命令行逐步启动

> 以下命令不依赖任何启动脚本，手动逐条执行即可。

#### 1. Redis（消息总线，必选）

```bash
docker run -d --name redis-twin --restart unless-stopped -p 6379:6379 redis:7-alpine
```

`6379` 端口需可用。验证：`docker exec redis-twin redis-cli ping` → `PONG`。
本机已原生安装 Redis 并设为自启动的，可跳过这一步。

#### 2. InfluxDB 3 Core（时序库，可选）

下载二进制并解压到本机，首次启动生成管理员令牌（控制台打印 `apiv3_...`，请保存备用）：

```bash
"<InfluxDB3 安装路径>/influxdb3.exe" serve --node-id=<节点名> --object-store=file --data-dir=<数据目录> --http-bind=0.0.0.0:18080 --admin-token-recovery-http-bind=127.0.0.1:18081
```

- 必须绑定 `0.0.0.0`（非 `127.0.0.1`），否则 Docker 内 Explorer 连不上。
- 端口避开 Docker/Hyper-V 预留段（旧值 `8181/8182` 落在 `8103-8202` 会失败，用 `18080/18081`）。
- 验证：`curl http://localhost:18080/health` → `401`（需鉴权，属正常）。

#### 3. InfluxDB3 Explorer（Web 界面，可选，Docker）

```bash
docker run -d --name influxdb3-explorer -p 127.0.0.1:8888:8080 -v <配置目录>:/app-root/config:ro -v <会话库目录>:/db:rw -e SESSION_SECRET_KEY=<随机32字节hex> -e DEFAULT_API_TOKEN=<你的 apiv3_ 令牌> -e DEFAULT_INFLUX_SERVER=http://host.docker.internal:18080 -e "DEFAULT_SERVER_NAME=Local InfluxDB 3" -e DEFAULT_INFLUX_DATABASE= influxdata/influxdb3-ui:1.9.0 --mode=admin
```

关键点：

- Server URL 用 `host.docker.internal`（容器内 `localhost` 指向自己）；
- 必须挂载可写 `db` 卷 + 设 `SESSION_SECRET_KEY`，否则报 `Error while getting session data`；
- Windows Docker Desktop 不支持 `--network host`，采用此标准做法；
- 浏览器开 http://localhost:8888，自动连 "Local InfluxDB 3"；也可在界面手动 Add Server（URL 同上）。

#### 4. 后端（FastAPI，必选）

```bash
cd backend
pip install -r requirements.txt
python -m src.main
# 默认监听 0.0.0.0:8300（HTTP 与 WebSocket 共用）
```

Redis 未运行时后端仍可启动（启动期容错），但数据无法经总线流转；请保证 Redis 已就绪。

#### 5. 前端（Vite 开发模式，必选）

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 http://localhost:5173 。若本机 5173 被占用（Windows + WSL2 常见），改 `frontend/vite.config.js` 的 `server.port`，或改用方式一的 Docker 前端（默认 8080）。

#### 6. 启动数据源（实时仿真器，可选）

默认数据源是随仓库的 Python 实时仿真器，无需安装商业软件：

```bash
python -m connectors.sources.python_realtime
```

它作为 TCP 服务端监听 `0.0.0.0:30000`，后端（Docker 内 TCP 客户端）经 `host.docker.internal:30000` 自动连上，断线每 3s 重连。若要用 PlantSimulation 做离线推演，将其作为只读分析外挂订阅 `source/state`（`.spp` 模型不随仓库提供）。

#### 7. 访问前端

- 方式一（Docker）：http://localhost:8080
- 方式二（原生）：http://localhost:5173

## 生产部署

- 后端：使用 systemd / supervisor / Windows 服务 管理 `python -m src.main` 进程
- 消息总线：独立 Redis 服务（**必选**），确保 `6379` 可达；生产建议设密码并在 `config.py` 配 `REDIS_PASSWORD`
- 时序库：InfluxDB 3 Core（可容器化或原生），端口 18080，生产建议挂载持久卷并设置访问令牌
- 前端：`npm run build` 后，将 `dist/` 部署到 Nginx / IIS
- Explorer：生产可独立部署 InfluxDB3 Explorer 容器，或用其它 InfluxDB 客户端
- 一键编排：生产也可用 `docker compose up -d` 起全部组件，建议配合 `.env` 中设置强令牌与 `EXPLORER_SESSION_SECRET_KEY`
