"""主入口：FastAPI 应用，承载 WebSocket(/ws) + REST，并驱动数据源(Source) TCP 数据"""
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from .config import (WS_PATH, HTTP_HOST, HTTP_PORT, SOURCE_BUFFER_SIZE,
                     DATA_ENCODING, LOG_LEVEL, LOG_FILE,
                     TOPIC_SOURCE_STATE,
                     INFLUXDB_ENABLED, INFLUXDB_URL, INFLUXDB_TOKEN,
                     INFLUXDB_DATABASE, INFLUXDB_MEASUREMENT_STATE,
                     INFLUXDB_MEASUREMENT_ACTION)
from .source_connector import SourceClient
from .websocket_handler import WebSocketHandler
from .data_processor import DataProcessor
from .bus import create_bus
from .influx_writer import InfluxWriter

logger = logging.getLogger(__name__)


# ---- 共享模块（模块级单例，lifespan 与路由共用）----
# 数据经消息总线（Redis Pub/Sub）解耦，为将来切 MQTT 铺路：
#   采集端 source_read_loop --publish source/state-->  Redis --subscribe--> processor.process --> handler.broadcast --> 前端
# 实时环为单向（数据源 -> 后端），不回写控制指令；Plant Simulation 已作为分析外挂断开，
# 仅订阅 source/state 只读消费，未来预测/推演回写走独立通道 source/prediction（待开发）。
source = SourceClient()
bus = create_bus()
handler = WebSocketHandler(bus)
processor = DataProcessor()
influx_writer = InfluxWriter()


# 复用解码器：从字符串头部解析"第一个完整的 JSON 值"，并返回其结束位置
# 这样即使一条 JSON 跨多个 TCP 包到达、或被拆成多段，也能正确重组
_json_decoder = json.JSONDecoder()


async def source_read_loop() -> None:
    """采集端后台任务：持续从数据源(Source)读取并发布到总线（断线自动重连）"""
    loop = asyncio.get_running_loop()
    byte_buffer = b""
    while True:
        try:
            if not source.is_connected:
                try:
                    source.connect()
                    byte_buffer = b""   # 重连后清空，避免旧数据混入新会话
                except OSError:
                    logger.warning("数据源未连接，3s 后重试...")
                    await asyncio.sleep(3)
                    continue
            raw = await loop.run_in_executor(None, source.recv, SOURCE_BUFFER_SIZE)
            if not raw:
                # recv 返回空 bytes = 对端已关闭连接
                logger.warning("数据源连接已关闭，尝试重连...")
                source.close()
                byte_buffer = b""
                continue
            byte_buffer += raw
            # 从缓冲字节中尽可能多地解析出完整 JSON 对象
            while True:
                try:
                    text = byte_buffer.decode(DATA_ENCODING)
                except UnicodeDecodeError:
                    break  # 多字节字符被截断，等更多数据再试
                if not text.strip():
                    byte_buffer = b""
                    break
                try:
                    obj, end = _json_decoder.raw_decode(text)
                except ValueError:
                    break  # 片段不完整，等待更多数据
                # 按字节对齐消费已解析的前缀（raw_decode 返回的 end 是字符索引）
                consumed = text[:end].encode(DATA_ENCODING)
                byte_buffer = byte_buffer[len(consumed):]
                logger.info("Received from source: %s", text[:end])
                parsed = processor.parse(text[:end])
                # 旁路写入时序数据库（best-effort，不阻塞主流程）
                if influx_writer.enabled:
                    msg_type = parsed.get("type")
                    if msg_type == "state":
                        asyncio.create_task(influx_writer.write_state(parsed))
                    elif msg_type == "action":
                        asyncio.create_task(influx_writer.write_action(parsed))
                # 解耦点①：不再直接 broadcast，而是发布到 source/state 主题
                try:
                    await bus.publish(TOPIC_SOURCE_STATE, json.dumps(parsed, ensure_ascii=False))
                except Exception as exc:  # noqa: BLE001 总线暂不可用不应中断采集
                    logger.warning("Publish source/state failed (dropped 1 msg): %s", exc)
        except asyncio.CancelledError:
            logger.info("Source read loop cancelled.")
            break
        except Exception as exc:
            logger.error("Loop error: %s", exc, exc_info=True)
            await asyncio.sleep(1)
            continue


async def on_state_message(payload: str) -> None:
    """分发端：收到 source/state 消息 → 解析为 dict → 数据处理 → 广播给所有前端 WS"""
    try:
        data = json.loads(payload)
    except ValueError:
        logger.warning("Discard non-JSON on source/state: %s", payload[:120])
        return
    # 解耦点②：解析后、广播前插入数据处理（占位函数，后续在此编辑业务逻辑）
    data = processor.process(data)
    await handler.broadcast(data)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 日志配置（追加写入文件）
    log_dir = os.path.dirname(LOG_FILE)
    if log_dir and not os.path.exists(log_dir):
        os.makedirs(log_dir, exist_ok=True)
    logging.basicConfig(
        level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        filename=LOG_FILE,
        filemode="a",
    )
    logger.info("Backend starting: HTTP/WS on http://%s:%s", HTTP_HOST, HTTP_PORT)
    # 1) 连接消息总线（Redis 暂不可用也不致命，publish 会按需自动重连）
    await bus.connect()
    # 1.5) 连接时序数据库（可选；未启用或连接失败均不致命）
    if INFLUXDB_ENABLED:
        influx_writer.connect()
    # 2) 订阅：source/state → 广播前端（单向；无 command 订阅）
    await bus.subscribe(TOPIC_SOURCE_STATE, on_state_message)
    # 3) 采集端：读数据源 → 发布 source/state
    task = asyncio.create_task(source_read_loop())
    yield
    # 关闭阶段
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    influx_writer.close()
    await bus.close()
    source.close()
    logger.info("Server shut down.")


app = FastAPI(
    title="数字孪生后端服务",
    description="数据源(Source) ↔ 前端 实时数据桥接（FastAPI 版，已与 Plant Simulation 解耦）。"
                "WebSocket 实时推送，REST 提供健康检查，交互式文档见 /docs。",
    version="1.0.0",
    lifespan=lifespan,
)

# 允许前端（如 Vite 开发服务器）跨域调用 REST / 建立 WebSocket
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket(WS_PATH)
async def ws_endpoint(websocket: WebSocket):
    """前端实时通道：把 source/state 经总线收到的消息广播给前端（实时环单向，无控制指令回写）"""
    await handler.handle_client(websocket)


@app.get("/health", tags=["运维"], summary="健康检查")
async def health():
    """返回服务是否存活，以及到数据源(Source)的连接状态"""
    return {"status": "ok", "source_connected": source.is_connected}


@app.get("/status", tags=["运维"], summary="运行状态")
async def status():
    """返回当前前端连接数、数据源(Source)与消息总线连接状态"""
    return {
        "source_connected": source.is_connected,
        "bus_connected": bus.is_connected,
        "frontend_connections": handler.connection_count,
        "influxdb": {
            "enabled": influx_writer.enabled,
            "connected": influx_writer.client is not None,
            "database": influx_writer.database,
            "write_count": influx_writer.write_count,
            "last_error": influx_writer.last_error,
        },
    }


if __name__ == "__main__":
    uvicorn.run(app, host=HTTP_HOST, port=HTTP_PORT)
