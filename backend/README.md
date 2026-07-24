# 数字孪生后端服务

Python 后端，负责：
1. 通过 TCP Socket 接收 PlantSimulation 的实时数据
2. 通过 WebSocket 向前端推送数据
3. 接收前端指令并转发给 PlantSimulation

## 目录说明

| 路径 | 说明 |
|------|------|
| src/config.py | 全局配置（主机、端口、日志级别） |
| src/plant_connector.py | PlantSimulation TCP Socket 通信 |
| src/websocket_handler.py | WebSocket 连接管理与广播 |
| src/data_processor.py | 数据解析与格式化 |
| src/main.py | 程序入口 |
| 	ests/ | 单元测试 |
| logs/ | 运行时日志（可选） |

## 启动

`ash
cd backend
pip install -r requirements.txt
python -m src.main
`

环境变量可覆盖配置（如 PLANT_PORT=30001 python -m src.main）。
