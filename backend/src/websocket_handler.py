"""WebSocket 连接管理与消息广播（FastAPI 版，经消息总线解耦）"""
import json
import logging

import asyncio
from fastapi import WebSocket, WebSocketDisconnect

from .bus import MessageBus

logger = logging.getLogger(__name__)


class WebSocketHandler:
    """管理前端 WebSocket 连接的集合，提供注册／注销／广播能力。

    实时环为单向：数据源 -> 后端 -> 前端。前端不再经本服务下发控制指令
    （原 plant/command 回写已随「断开 Plant 实时架构」移除）。本 handler 只
    负责把 source/state 经总线收到的消息广播给所有前端，并在收到前端文本时
    仅做记录（控制通道已不存在，将来若需前端触发推演再接 source/prediction）。
    """

    def __init__(self, bus: MessageBus):
        self._connections: set[WebSocket] = set()
        self._bus = bus

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
                # 控制通道已移除：实时数据单向（数据源 -> 后端 -> 前端）。
                # 前端下发的文本暂不使用，仅记录，便于将来接 source/prediction。
                logger.info("Frontend says (ignored, no control channel): %s", message)
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
