# 部署指南

## 本地开发

### 0. 启动 Redis（消息总线，Docker）

```bash
docker start redis-twin
# 首次创建：docker run -d --name redis-twin --restart unless-stopped -p 6379:6379 redis:7-alpine
# 旧 Windows Redis 服务请保持禁用，避免抢占 6379 导致容器绑定失败
```

### 1. 启动后端

```bash
cd backend
# 使用 DT conda 环境（不要装到 default venv）
E:\Miniconda\miniconda3\envs\DT\python.exe -m src.main
# 依赖：fastapi / uvicorn / redis / websockets（见 requirements.txt）
# 默认监听 0.0.0.0:8300（HTTP 与 WebSocket 共用）
```

### 2. 启动前端（开发模式）

```bash
cd frontend
npm install
npm run dev
```

### 3. 启动 PlantSimulation
1. 打开 simulation/models/main_model.spp
2. 运行仿真（F5）
3. 确保 Socket 服务器已启动（监听 30000 端口）

### 4. 访问前端
浏览器打开 http://localhost:5173

## 生产部署

- 后端：使用 systemd / supervisor 管理进程
- 消息总线：Redis（Docker `redis-twin` 或独立 Redis 服务），确保 6379 可达；生产建议设密码并在 `config.py` 配 `REDIS_PASSWORD`
- 前端：npm run build 后，将 dist/ 部署到 Nginx / IIS
