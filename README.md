# Digital Twin - PlantSimulation 数字孪生系统

基于 PlantSimulation 的 3D 数字孪生可视化系统。

## 项目结构

| 目录 | 说明 |
|------|------|
| backend/ | Python 后端（WebSocket + TCP 通信） |
| frontend/ | Three.js 3D 可视化前端 |
| simulation/ | PlantSimulation 仿真模型 |
| scripts/ | 启动/测试辅助脚本 |
| docs/ | 文档 |

## 快速开始

### 1. 后端

```bash
cd backend
pip install -r requirements.txt
python -m src.main
```

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

### 3. PlantSimulation
打开 simulation/models/main_model.spp，运行仿真。

### 4. 访问
浏览器打开 http://localhost:5173

## 数据流

PlantSimulation -> (TCP:30000) -> Python 后端 -> (WebSocket:8765) -> 前端浏览器

## 技术栈

- 仿真: PlantSimulation (SimTalk)
- 后端: Python + asyncio + websockets
- 前端: Three.js + Vite
