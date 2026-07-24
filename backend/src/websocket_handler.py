"""WebSocket 连接管理与消息广播"""
import json
import logging

import asyncio
import websockets

from .plant_connector import PlantConnector

logger = logging.getLogger(__name__)


class WebSocketHandler:
    """管理前端 WebSocket 连接的集合，提供注册／注销／广播能力"""

    def __init__(self, plant_connector: PlantConnector):
        self._connections: set[websockets.WebSocketServerProtocol] = set()
        self._plant = plant_connector

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def handle_client(self, websocket: websockets.WebSocketServerProtocol) -> None:
        """处理单个前端的 WebSocket 连接生命周期"""
        self._connections.add(websocket)
        logger.info("Frontend connected! Total: %d", len(self._connections))
        try:
            async for message in websocket:
                logger.info("Frontend says: %s", message)
                self._plant.send(message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self._connections.discard(websocket)
            logger.info("Frontend disconnected! Total: %d", len(self._connections))

    async def broadcast(self, data: dict) -> None:
        """向所有已连接的前端广播 JSON 消息"""
        if not self._connections:
            return
        message = json.dumps(data, ensure_ascii=False)
        tasks = [ws.send(message) for ws in self._connections]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for i, r in enumerate(results):
            if isinstance(r, Exception):
                logger.warning("Send to websocket failed: %s", r)
