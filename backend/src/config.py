"""全局配置项：端口、IP、日志级别等"""
import os

# === PlantSimulation TCP 连接 ===
PLANT_HOST = os.getenv("PLANT_HOST", "127.0.0.1")
PLANT_PORT = int(os.getenv("PLANT_PORT", "30000"))
PLANT_BUFFER_SIZE = 1024

# === HTTP / WebSocket（FastAPI 统一托管，共用同一端口）===
HTTP_HOST = os.getenv("HTTP_HOST", "0.0.0.0")
HTTP_PORT = int(os.getenv("HTTP_PORT", "8000"))
# 前端 WebSocket 路由路径；浏览器连接串为 ws://<HTTP_HOST>:<HTTP_PORT><WS_PATH>
WS_PATH = os.getenv("WS_PATH", "/ws")

# === 日志 ===
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FILE = os.getenv("LOG_FILE", "logs/backend.log")

# === 数据格式 ===
DATA_ENCODING = "utf-8"
