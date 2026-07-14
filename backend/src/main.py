"""主入口：FastAPI 应用，承载 WebSocket(/ws) + REST，并驱动 PlantSimulation TCP 数据"""
import asyncio
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


async def plant_read_loop() -> None:
    """后台任务：持续从 PlantSimulation 读取并广播给前端（断线自动重连）"""
    loop = asyncio.get_running_loop()
    while True:
        try:
            if not plant.is_connected:
                try:
                    plant.connect()
                except OSError:
                    logger.warning("PlantSimulation 未连接，3s 后重试...")
                    await asyncio.sleep(3)
                    continue
            raw = await loop.run_in_executor(None, plant.recv, PLANT_BUFFER_SIZE)
            text = raw.decode(DATA_ENCODING).strip()
            if not text:
                continue
            logger.info("Received from Plant: %s", text)
            parsed = processor.parse(text)
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
