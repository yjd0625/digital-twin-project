# 部署指南

## 本地开发

### 1. 启动后端

```bash
cd backend
pip install -r requirements.txt
python -m src.main
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
- 前端：npm run build 后，将 dist/ 部署到 Nginx / IIS
