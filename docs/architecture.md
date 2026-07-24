# 系统架构

## 整体架构

┌─────────────────┐     TCP Socket      ┌─────────────────┐
│ PlantSimulation  │ ──────────────────> │  Python 后端     │
│ (仿真引擎)       │ <───────────────── │  (plant_client)  │
└─────────────────┘                     └────────┬────────┘
                                                  │
                                           WebSocket │
                                                  │
                                                  ▼
                                        ┌─────────────────┐
                                        │  前端浏览器      │
                                        │ (Three.js 3D)    │
                                        └─────────────────┘

## 数据流

1. PlantSimulation 通过 TCP Socket (port 30000) 向 Python 后端发送实时仿真数据
2. Python 后端解析数据后，通过 WebSocket (port 8765) 广播给所有已连接的前端
3. 前端 Three.js 场景根据接收到的数据驱动 3D 对象状态
4. 用户通过前端按钮发送指令 → WebSocket → Python 后端 → TCP Socket → PlantSimulation

## 技术栈

| 层 | 技术 |
|-----|------|
| 仿真 | PlantSimulation (SimTalk) |
| 后端 | Python + asyncio + websockets + FastAPI |
| 前端 | Three.js + Vite |
| 通信 | TCP Socket (仿真<->后端), WebSocket (后端<->前端) |
