# Digital Twin - PlantSimulation 数字孪生系统

基于 PlantSimulation 的 3D 数字孪生可视化系统。



## 仿真说明

本仓库**不包含** PlantSimulation 模型文件（\.spp\），原因：

- PlantSimulation 是 Siemens 的商业闭源软件，其模型文件（\.spp\）属于用户的专有资产
- 本仓库仅开源 Python 后端和前端可视化代码

如需运行完整系统，请在 PlantSimulation 中：

1. 任意创建一个仿真模型
2. 在模型中启动 **Socket 服务器**（监听端口 30000）
3. 使用 Socket 发送数据（格式参考 \simulation/scripts/\ 目录下的 SimTalk 脚本）
4. 后端会自动接收并转发至前端

也可以参考 \simulation/scripts/\ 中的示例，在自己的 PlantSimulation 模型中实现 Socket 通信。
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
