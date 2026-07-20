# 部署指南

## 端口占用总览

| 组件 | 端口 | 说明 |
|------|------|------|
| Redis | 6379 | 消息总线（**必选**） |
| InfluxDB 3 Core | 18080 | 时序数据库（可选） |
| InfluxDB3 Explorer | 8888 | InfluxDB Web 界面（映射 8888→容器 8080，可选） |
| 后端 (FastAPI) | 8300 | HTTP + WebSocket 共用 |
| 前端 (Vite) | 5173 | 3D 可视化 |
| PlantSimulation Socket | 30000 | 仿真数据 TCP 端口（可选） |

> Redis 为必选消息总线；InfluxDB / Explorer / PlantSimulation 为可选增强或数据源。

## 本地开发

> 建议按下列命令手动启动。也可参考根目录 `README.md` 的「手动启动」一节。

### 1. Redis（消息总线，必选）

```bash
docker run -d --name redis-twin --restart unless-stopped -p 6379:6379 redis:7-alpine
```

`6379` 端口需可用。验证：`docker exec redis-twin redis-cli ping` → `PONG`。
本机已原生安装 Redis 并设为自启动的，可跳过这一步。

### 2. InfluxDB 3 Core（时序库，可选）

下载二进制并解压到本机，首次启动生成管理员令牌（控制台打印 `apiv3_...`，请保存备用）：

```bash
"<InfluxDB3 安装路径>/influxdb3.exe" serve --node-id=<节点名> --object-store=file --data-dir=<数据目录> --http-bind=0.0.0.0:18080 --admin-token-recovery-http-bind=127.0.0.1:18081
```

- 必须绑定 `0.0.0.0`（非 `127.0.0.1`），否则 Docker 内 Explorer 连不上。
- 端口避开 Docker/Hyper-V 预留段（旧值 `8181/8182` 落在 `8103-8202` 会失败，用 `18080/18081`）。
- 验证：`curl http://localhost:18080/health` → `401`（需鉴权，属正常）。

### 3. InfluxDB3 Explorer（Web 界面，可选，Docker）

```bash
docker run -d --name influxdb3-explorer -p 127.0.0.1:8888:8080 -v <配置目录>:/app-root/config:ro -v <会话库目录>:/db:rw -e SESSION_SECRET_KEY=<随机32字节hex> -e DEFAULT_API_TOKEN=<你的 apiv3_ 令牌> -e DEFAULT_INFLUX_SERVER=http://host.docker.internal:18080 -e "DEFAULT_SERVER_NAME=Local InfluxDB 3" -e DEFAULT_INFLUX_DATABASE= influxdata/influxdb3-ui:1.9.0 --mode=admin
```

关键点：

- Server URL 用 `host.docker.internal`（容器内 `localhost` 指向自己）；
- 必须挂载可写 `db` 卷 + 设 `SESSION_SECRET_KEY`，否则报 `Error while getting session data`；
- Windows Docker Desktop 不支持 `--network host`，采用此标准做法；
- 浏览器开 http://localhost:8888，自动连 "Local InfluxDB 3"；也可在界面手动 Add Server（URL 同上）。

### 4. 后端（FastAPI，必选）

```bash
cd backend
pip install -r requirements.txt
python -m src.main
# 默认监听 0.0.0.0:8300（HTTP 与 WebSocket 共用）
```

Redis 未运行时后端仍可启动（启动期容错），但数据无法经总线流转；请保证 Redis 已就绪。

### 5. 前端（Vite 开发模式，必选）

```bash
cd frontend
npm install
npm run dev
```

### 6. 启动 PlantSimulation（可选）

1. 准备仿真模型（`.spp` 不随仓库提供）
2. 运行仿真（F5）
3. 确保 Socket 服务器已启动，监听 `30000` 端口

### 7. 访问前端

浏览器打开 http://localhost:5173

## 生产部署

- 后端：使用 systemd / supervisor / Windows 服务 管理 `python -m src.main` 进程
- 消息总线：独立 Redis 服务（**必选**），确保 `6379` 可达；生产建议设密码并在 `config.py` 配 `REDIS_PASSWORD`
- 时序库：InfluxDB 3 Core（可容器化或原生），端口 18080，生产建议挂载持久卷并设置访问令牌
- 前端：`npm run build` 后，将 `dist/` 部署到 Nginx / IIS
- Explorer：生产可独立部署 InfluxDB3 Explorer 容器，或用其它 InfluxDB 客户端
