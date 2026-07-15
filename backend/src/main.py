"""主入口：FastAPI 应用，承载 WebSocket(/ws) + REST，并驱动 PlantSimulation TCP 数据"""
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from .config import (WS_PATH, HTTP_HOST, HTTP_PORT, PLANT_BUFFER_SIZE,
                     DATA_ENCODING, LOG_LEVEL, LOG_FILE,
                     TOPIC_PLANT_STATE, TOPIC_PLANT_COMMAND)
from .plant_connector import PlantConnector
from .websocket_handler import WebSocketHandler
from .data_processor import DataProcessor
from .bus import create_bus

logger = logging.getLogger(__name__)


class CommandRequest(BaseModel):
    """通过 HTTP 发送给 PlantSimulation 的指令"""
    command: str


# ---- 共享模块（模块级单例，lifespan 与路由共用）----
# 数据经消息总线（Redis Pub/Sub）解耦，为将来切 MQTT 铺路：
#   采集端 plant_read_loop --publish plant/state-->  Redis --subscribe--> handler.broadcast --> 前端
#   前端/REST --publish plant/command--> Redis --subscribe--> plant.send --> Plant
plant = PlantConnector()
bus = create_bus()
handler = WebSocketHandler(bus, TOPIC_PLANT_COMMAND)
processor = DataProcessor()


# 复用解码器：从字符串头部解析"第一个完整的 JSON 值"，并返回其结束位置
# 这样即使一条 JSON 跨多个 TCP 包到达、或被拆成多段，也能正确重组
_json_decoder = json.JSONDecoder()


async def plant_read_loop() -> None:
    """采集端后台任务：持续从 PlantSimulation 读取并发布到总线（断线自动重连）

    TCP 是字节流协议，PlantSimulation 发来的 JSON 可能跨多个 recv 分包到达。
    这里把接收到的字节累积进 byte_buffer，再用 raw_decode 从头部逐条提取
    完整的 JSON 对象（无论中间是否含换行、跨几个包），提取到就 publish 到
    plant/state 主题（不再直接 broadcast），剩下的字节继续等待后续数据，
    从而彻底解决"分段导致 JSON 被截断"的问题。
    """
    loop = asyncio.get_running_loop()
    byte_buffer = b""
    while True:
        try:
            if not plant.is_connected:
                try:
                    plant.connect()
                    byte_buffer = b""   # 重连后清空，避免旧数据混入新会话
                except OSError:
                    logger.warning("PlantSimulation 未连接，3s 后重试...")
                    await asyncio.sleep(3)
                    continue
            raw = await loop.run_in_executor(None, plant.recv, PLANT_BUFFER_SIZE)
            if not raw:
                # recv 返回空 bytes = 对端已关闭连接
                logger.warning("PlantSimulation 连接已关闭，尝试重连...")
                plant.close()
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
                logger.info("Received from Plant: %s", text[:end])
                parsed = processor.parse(text[:end])
                # 解耦点①：不再直接 broadcast，而是发布到 plant/state 主题
                try:
                    await bus.publish(TOPIC_PLANT_STATE, json.dumps(parsed, ensure_ascii=False))
                except Exception as exc:  # noqa: BLE001 总线暂不可用不应中断采集
                    logger.warning("Publish plant/state failed (dropped 1 msg): %s", exc)
        except asyncio.CancelledError:
            logger.info("Plant read loop cancelled.")
            break
        except Exception as exc:
            logger.error("Loop error: %s", exc, exc_info=True)
            await asyncio.sleep(1)
            continue


async def on_state_message(payload: str) -> None:
    """分发端：收到 plant/state 消息 → 解析为 dict → 广播给所有前端 WS"""
    try:
        data = json.loads(payload)
    except ValueError:
        logger.warning("Discard non-JSON on plant/state: %s", payload[:120])
        return
    await handler.broadcast(data)


async def on_command_message(payload: str) -> None:
    """采集端：收到 plant/command 消息 → 下发给 PlantSimulation"""
    try:
        plant.send(payload)
    except ConnectionError as exc:
        logger.warning("Command dropped, Plant not connected: %s", exc)


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
    # 2) 订阅：plant/state → 广播前端；plant/command → 下发 Plant
    await bus.subscribe(TOPIC_PLANT_STATE, on_state_message)
    await bus.subscribe(TOPIC_PLANT_COMMAND, on_command_message)
    # 3) 采集端：读 Plant → 发布 plant/state
    task = asyncio.create_task(plant_read_loop())
    yield
    # 关闭阶段
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    await bus.close()
    plant.close()
    logger.info("Server shut down.")


app = FastAPI(
    title="数字孪生后端服务",
    description="PlantSimulation ↔ 前端 实时数据桥接（FastAPI 版）。"
                "WebSocket 实时推送，REST 提供健康检查与指令转发，交互式文档见 /docs。",
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
    """前端实时通道：接收前端指令转发给 PlantSimulation，并接收 Plant 广播"""
    await handler.handle_client(websocket)


@app.get("/health", tags=["运维"], summary="健康检查")
async def health():
    """返回服务是否存活，以及到 PlantSimulation 的连接状态"""
    return {"status": "ok", "plant_connected": plant.is_connected}


@app.get("/status", tags=["运维"], summary="运行状态")
async def status():
    """返回当前前端连接数、PlantSimulation 与消息总线连接状态"""
    return {
        "plant_connected": plant.is_connected,
        "bus_connected": bus.is_connected,
        "frontend_connections": handler.connection_count,
    }


@app.post("/command", tags=["控制"], summary="发送指令给 PlantSimulation")
async def send_command(req: CommandRequest):
    """通过消息总线把指令发布到 plant/command 主题，由采集端订阅后下发给 Plant。

    注意：解耦后本接口只保证「指令已发布到总线」（返回 200），指令能否真正
    送达 Plant 取决于采集端与 Plant 的连接状态，可通过 /status 查看。
    """
    try:
        await bus.publish(TOPIC_PLANT_COMMAND, req.command)
    except Exception as exc:  # noqa: BLE001 总线不可用时返回 503
        raise HTTPException(status_code=503, detail=f"消息总线不可用: {exc}")
    return {"published": req.command, "topic": TOPIC_PLANT_COMMAND}


if __name__ == "__main__":
    uvicorn.run(app, host=HTTP_HOST, port=HTTP_PORT)
