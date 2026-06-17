"""全局配置项：端口、IP、日志级别等"""
import os

# === PlantSimulation TCP 连接 ===
PLANT_HOST = os.getenv("PLANT_HOST", "127.0.0.1")
PLANT_PORT = int(os.getenv("PLANT_PORT", "30000"))
PLANT_BUFFER_SIZE = 1024

# === WebSocket 服务器 ===
WS_HOST = os.getenv("WS_HOST", "localhost")
WS_PORT = int(os.getenv("WS_PORT", "8765"))

# === FastAPI HTTP 服务（可选）===
HTTP_HOST = os.getenv("HTTP_HOST", "0.0.0.0")
HTTP_PORT = int(os.getenv("HTTP_PORT", "8000"))

# === 日志 ===
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FILE = os.getenv("LOG_FILE", "logs/backend.log")

# === 数据格式 ===
DATA_ENCODING = "utf-8"
