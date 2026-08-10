"""MessageBus 契约测试：用内存桩 FakeBus 验证 publish/subscribe 转发逻辑，
并验证 create_bus 工厂（RedisBus 默认实现、未知类型报错）。

不依赖真实 Redis：RedisBus 的 redis 导入发生在 _new_client() 内部（懒加载），
因此本文件可在无 Redis 环境下安全运行，专注验证 MessageBus 接口契约。
"""
import asyncio

import pytest

from src.bus import MessageBus, create_bus


class FakeBus(MessageBus):
    """内存实现的 MessageBus：publish 同步分发给该 topic 的所有订阅者。"""

    def __init__(self):
        self.published = []
        self._handlers = {}
        self._connected = True
        self.closed = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def connect(self) -> None:
        self._connected = True

    async def close(self) -> None:
        self.closed = True

    async def publish(self, topic: str, payload: str) -> None:
        self.published.append((topic, payload))
        for handler in self._handlers.get(topic, []):
            await handler(payload)

    async def subscribe(self, topic: str, handler) -> "asyncio.Task":
        self._handlers.setdefault(topic, []).append(handler)
        return asyncio.create_task(asyncio.sleep(0))  # 占位任务，符合接口返回 Task


async def test_publish_dispatches_to_subscriber():
    bus = FakeBus()
    received = []

    async def on_msg(payload: str):
        received.append(payload)

    await bus.subscribe("source/state", on_msg)
    await bus.publish("source/state", '{"type":"state"}')

    assert received == ['{"type":"state"}']
    assert bus.published == [("source/state", '{"type":"state"}')]


async def test_multiple_subscribers_all_receive():
    bus = FakeBus()
    a, b = [], []

    async def h_a(p): a.append(p)
    async def h_b(p): b.append(p)

    await bus.subscribe("t", h_a)
    await bus.subscribe("t", h_b)
    await bus.publish("t", "x")

    assert a == ["x"] and b == ["x"]


def test_create_bus_default_is_redis(monkeypatch):
    import src.config as cfg
    monkeypatch.setattr(cfg, "BUS_TYPE", "redis")
    bus = create_bus()
    assert bus.__class__.__name__ == "RedisBus"


def test_create_bus_unknown_type_raises(monkeypatch):
    import src.config as cfg
    monkeypatch.setattr(cfg, "BUS_TYPE", "nats")
    with pytest.raises(ValueError):
        create_bus()
