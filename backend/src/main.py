\"\"\"主入口：启动 WebSocket 服务器并持续接收 PlantSimulation 数据\"\"\"
import asyncio
import logging

import websockets

from .config import WS_HOST, WS_PORT, PLANT_BUFFER_SIZE, DATA_ENCODING, LOG_LEVEL
from .plant_connector import PlantConnector
from .websocket_handler import WebSocketHandler
from .data_processor import DataProcessor

logger = logging.getLogger(__name__)


async def main():
    # 日志配置
    logging.basicConfig(
        level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # 初始化各模块
    plant = PlantConnector()
    handler = WebSocketHandler(plant)
    processor = DataProcessor()

    # 启动 WebSocket 服务器
    ws_server = await websockets.serve(
        handler.handle_client, WS_HOST, WS_PORT
    )
    logger.info("WebSocket server started on ws://%s:%s", WS_HOST, WS_PORT)

    # 连接到 PlantSimulation
    plant.connect()
    loop = asyncio.get_running_loop()

    try:
        while True:
            try:
                raw = await loop.run_in_executor(None, plant.recv, PLANT_BUFFER_SIZE)
                text = raw.decode(DATA_ENCODING).strip()
                if not text:
                    continue
                logger.info("Received from Plant: %s", text)

                # 解析并广播
                parsed = processor.parse(text)
                await handler.broadcast(parsed)
            except Exception as exc:
                logger.error("Loop error: %s", exc)
                break
    finally:
        plant.close()
        ws_server.close()
        logger.info("Server shut down.")


if __name__ == "__main__":
    asyncio.run(main())
