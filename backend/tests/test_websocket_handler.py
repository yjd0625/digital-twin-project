"""WebSocketHandler 单元测试：broadcast 多连接容错 + handle_client 生命周期。

用内存桩 FakeWebSocket / FakeBus，不依赖真实网络或 Redis。
"""
import asyncio

from fastapi import WebSocketDisconnect

from src.bus import MessageBus
from src.websocket_handler import WebSocketHandler


class FakeBus(MessageBus):
    def __init__(self): self._connected = True; self.closed = False
    @property
    def is_connected(self): return self._connected
    async def connect(self): pass
    async def close(self): self.closed = True
    async def publish(self, topic, payload): pass
    async def subscribe(self, topic, handler): return asyncio.create_task(asyncio.sleep(0))


class FakeWebSocket:
    def __init__(self, messages=()):
        self._messages = list(messages)
        self.sent = []
        self.accepted = False

    async def accept(self):
        self.accepted = True

    async def receive_text(self):
        if self._messages:
            return self._messages.pop(0)
        raise WebSocketDisconnect()

    async def send_text(self, text):
        self.sent.append(text)


class FailingWebSocket(FakeWebSocket):
    async def send_text(self, text):
        raise RuntimeError("send failed")


async def test_broadcast_tolerates_single_failure():
    handler = WebSocketHandler(FakeBus())
    good1, good2, bad = FakeWebSocket(), FakeWebSocket(), FailingWebSocket()
    handler._connections.update({good1, good2, bad})

    # 一个连接发送失败，不应抛异常，其余连接仍应收到
    await handler.broadcast({"type": "state", "n": 1})

    assert good1.sent == ['{"type": "state", "n": 1}']
    assert good2.sent == ['{"type": "state", "n": 1}']


async def test_broadcast_no_connections_is_noop():
    handler = WebSocketHandler(FakeBus())
    # 空连接集合：不应抛异常
    await handler.broadcast({"type": "state"})


async def test_handle_client_lifecycle():
    handler = WebSocketHandler(FakeBus())
    ws = FakeWebSocket(messages=["hello"])

    await handler.handle_client(ws)

    assert ws.accepted is True
    # 连接已正常移除（disconnect 在 finally 中 discard）
    assert handler.connection_count == 0
