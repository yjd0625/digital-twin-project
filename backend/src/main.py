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
                     DATA_ENCODING, LOG_LEVEL, LOG_FILE)
from .plant_connector import PlantConnector
from .websocket_handler import WebSocketHandler
from .data_processor import DataProcessor

logger = logging.getLogger(__name__)


class CommandRequest(BaseModel):
    """通过 HTTP 发送给 PlantSimulation 的指令"""
    command: str


# ---- 共享模块（模块级单例，lifespan 与路由共用）----
plant = PlantConnector()
handler = WebSocketHandler(plant)
processor = DataProcessor()


# 复用解码器：从字符串头部解析"第一个完整的 JSON 值"，并返回其结束位置
# 这样即使一条 JSON 跨多个 TCP 包到达、或被拆成多段，也能正确重组
_json_decoder = json.JSONDecoder()


async def plant_read_loop() -> None:
    """后台任务：持续从 PlantSimulation 读取并广播给前端（断线自动重连）

    TCP 是字节流协议，PlantSimulation 发来的 JSON 可能跨多个 recv 分包到达。
    这里把接收到的字节累积进 byte_buffer，再用 raw_decode 从头部逐条提取
    完整的 JSON 对象（无论中间是否含换行、跨几个包），提取到就广播，
    剩下的字节继续等待后续数据，从而彻底解决"分段导致 JSON 被截断"的问题。
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
                await handler.broadcast(parsed)
        except asyncio.CancelledError:
            logger.info("Plant read loop cancelled.")
            break
        except Exception as exc:
            logger.error("Loop error: %s", exc, exc_info=True)
            await asyncio.sleep(1)
            continue


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
    task = asyncio.create_task(plant_read_loop())
    yield
    # 关闭阶段
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
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
    """返回当前前端连接数与 PlantSimulation 连接状态"""
    return {
        "plant_connected": plant.is_connected,
        "frontend_connections": handler.connection_count,
    }


@app.post("/command", tags=["控制"], summary="发送指令给 PlantSimulation")
async def send_command(req: CommandRequest):
    """直接通过 HTTP 给 PlantSimulation 发送指令（无需经过前端 WebSocket）"""
    try:
        plant.send(req.command)
    except ConnectionError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return {"sent": req.command}


if __name__ == "__main__":
    uvicorn.run(app, host=HTTP_HOST, port=HTTP_PORT)
