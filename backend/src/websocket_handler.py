"""WebSocket 连接管理与消息广播（FastAPI 版，经消息总线解耦）"""
import json
import logging

import asyncio
from fastapi import WebSocket, WebSocketDisconnect

from .bus import MessageBus

logger = logging.getLogger(__name__)


class WebSocketHandler:
    """管理前端 WebSocket 连接的集合，提供注册／注销／广播能力。

    与旧版的区别：不再直接持有 PlantConnector。前端发来的指令改为发布到
    消息总线的 command 主题，由采集端订阅后再下发给 PlantSimulation，
    从而把「前端指令」与「Plant 直连」解耦。
    """

    def __init__(self, bus: MessageBus, command_topic: str):
        self._connections: set[WebSocket] = set()
        self._bus = bus
        self._command_topic = command_topic

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def handle_client(self, websocket: WebSocket) -> None:
        """处理单个前端的 WebSocket 连接生命周期（FastAPI WebSocket）"""
        await websocket.accept()
        self._connections.add(websocket)
        logger.info("Frontend connected! Total: %d", len(self._connections))
        try:
            while True:
                message = await websocket.receive_text()
                logger.info("Frontend says: %s", message)
                # 不再直连 Plant：把指令发布到总线，由采集端订阅后下发
                await self._bus.publish(self._command_topic, message)
        except WebSocketDisconnect:
            pass
        finally:
            self._connections.discard(websocket)
            logger.info("Frontend disconnected! Total: %d", len(self._connections))

    async def broadcast(self, data: dict) -> None:
        """向所有已连接的前端广播 JSON 消息"""
        if not self._connections:
            return
        message = json.dumps(data, ensure_ascii=False)
        tasks = [ws.send_text(message) for ws in list(self._connections)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for r in results:
            if isinstance(r, Exception):
                logger.warning("Send to websocket failed: %s", r)
