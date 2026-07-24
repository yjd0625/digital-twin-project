"""全局配置项：端口、IP、日志级别等"""
import os

# === PlantSimulation TCP 连接 ===
PLANT_HOST = os.getenv("PLANT_HOST", "127.0.0.1")
PLANT_PORT = int(os.getenv("PLANT_PORT", "30000"))
PLANT_BUFFER_SIZE = 1024

# === HTTP / WebSocket（FastAPI 统一托管，共用同一端口）===
HTTP_HOST = os.getenv("HTTP_HOST", "0.0.0.0")
# 注意：Docker/WSL 会预留 7903-8202 等端口区间（WinError 10013），
# 默认避开这些区间选用 8300；如想换回 8000 需先从排除区间释放端口。
HTTP_PORT = int(os.getenv("HTTP_PORT", "8300"))
# 前端 WebSocket 路由路径；浏览器连接串为 ws://<HTTP_HOST>:<HTTP_PORT><WS_PATH>
WS_PATH = os.getenv("WS_PATH", "/ws")

# === 消息总线（Redis Pub/Sub，解耦 Plant 与前端，为将来切 MQTT 铺路）===
# BUS_TYPE 预留切换位：现在用 "redis"，将来实现 MqttBus 后改成 "mqtt" 即可，
# 业务代码（main.py / plant_read_loop / WebSocketHandler）无需改动。
BUS_TYPE = os.getenv("BUS_TYPE", "redis")
REDIS_HOST = os.getenv("REDIS_HOST", "127.0.0.1")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
# 老版 Redis（如 Windows 移植版 3.x）不支持 RESP3 的 HELLO 命令，
# 而 redis-py>=5 默认协商 RESP3，会因 "unknown command 'HELLO'" 报错，
# 故强制使用 RESP2。若你的 Redis>=6 且想用 RESP3，可设 REDIS_PROTOCOL=3。
REDIS_PROTOCOL = int(os.getenv("REDIS_PROTOCOL", "2"))

# === 消息主题（MQTT 风格斜杠层级；Redis 视为普通 channel 名，切 MQTT 时主题名可直接复用）===
TOPIC_PLANT_STATE = os.getenv("TOPIC_PLANT_STATE", "plant/state")      # Plant → 前端：实时状态
TOPIC_PLANT_COMMAND = os.getenv("TOPIC_PLANT_COMMAND", "plant/command")  # 前端/REST → Plant：控制指令

# === 日志 ===
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FILE = os.getenv("LOG_FILE", "logs/backend.log")

# === 数据格式 ===
DATA_ENCODING = "utf-8"

# === 时序数据库（InfluxDB 3 Core，可选，best-effort 旁路写入）===
# 启用后，后端在 plant_read_loop 解析到 state/action 时，旁路写入 InfluxDB。
# 写入为 best-effort：失败仅记录日志，不中断 WebSocket 广播与采集主流程。
INFLUXDB_ENABLED = os.getenv("INFLUXDB_ENABLED", "false").lower() == "true"
# 后端为 Windows 原生 InfluxDB 3，直连 localhost（不要走 host.docker.internal）
INFLUXDB_URL = os.getenv("INFLUXDB_URL", "http://localhost:18080")
# Token 务必走环境变量，切勿硬编码进仓库
INFLUXDB_TOKEN = os.getenv("INFLUXDB_TOKEN", "")
INFLUXDB_DATABASE = os.getenv("INFLUXDB_DATABASE", "digital_twin")
INFLUXDB_MEASUREMENT_STATE = os.getenv("INFLUXDB_MEASUREMENT_STATE", "station_state")
INFLUXDB_MEASUREMENT_ACTION = os.getenv("INFLUXDB_MEASUREMENT_ACTION", "station_action")
