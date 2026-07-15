"""传输无关的消息总线抽象：现用 Redis Pub/Sub，将来可平滑替换为 MQTT。

设计目标
--------
把「传输层」与「业务层」解耦。业务代码（main.py / plant_read_loop /
WebSocketHandler）只依赖 MessageBus 接口，将来从 Redis 切到 MQTT 时，
只需新增 MqttBus 实现并改 config.BUS_TYPE，业务代码一行不用动。

主题命名
--------
采用 MQTT 风格的斜杠层级（plant/state、plant/command）。Redis 视其为
普通 channel 名，不解释斜杠；MQTT 原生支持层级主题。因此切换传输层时
主题名可以直接复用。

注意
----
- Redis Pub/Sub 是 fire-and-forget，无持久化：订阅者离线期间的消息会丢。
  实时孪生流可接受偶发丢帧；如需「重连补发」，那是将来 MQTT 的 QoS 优势。
- pubsub 需要独立连接，故 publish 用一条连接、每个 subscribe 各用一条连接。
"""
from abc import ABC, abstractmethod
from typing import Awaitable, Callable
import asyncio
import logging

logger = logging.getLogger(__name__)

# 订阅回调签名：收到消息负载（字符串）后异步处理
MessageHandler = Callable[[str], Awaitable[None]]


class MessageBus(ABC):
    """传输无关的发布/订阅总线接口"""

    @abstractmethod
    async def connect(self) -> None:
        """建立发布连接（订阅连接在 subscribe 时按需建立）"""

    @abstractmethod
    async def close(self) -> None:
        """关闭所有连接并取消订阅任务"""

    @abstractmethod
    async def publish(self, topic: str, payload: str) -> None:
        """向 topic 发布一条字符串消息"""

    @abstractmethod
    async def subscribe(self, topic: str, handler: MessageHandler) -> "asyncio.Task":
        """订阅 topic，为每条消息调用 handler；返回后台订阅任务"""

    @property
    @abstractmethod
    def is_connected(self) -> bool:
        """发布连接是否可用"""


class RedisBus(MessageBus):
    """基于 Redis Pub/Sub 的消息总线实现。

    - 发布：复用单个 redis.asyncio 客户端（该客户端按命令自动重连）。
    - 订阅：每个 topic 起一个后台任务，独立连接 + 断线自动重连（3s 重试）。
    - 强制 RESP2（protocol=2）以兼容老版 Redis（不支持 RESP3 的 HELLO）。
    """

    def __init__(self, host: str, port: int, db: int = 0, protocol: int = 2):
        self._host = host
        self._port = port
        self._db = db
        self._protocol = protocol
        self._pub = None            # 发布用客户端
        self._tasks: list[asyncio.Task] = []
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    def _new_client(self):
        """创建一个 redis.asyncio 客户端（RESP2、自动解码为 str）"""
        import redis.asyncio as aioredis
        return aioredis.Redis(
            host=self._host,
            port=self._port,
            db=self._db,
            protocol=self._protocol,
            decode_responses=True,   # publish/接收均以 str 处理，省去手动 encode/decode
        )

    async def connect(self) -> None:
        """建立发布连接。失败不抛致命异常：客户端会在后续 publish 时自动重连，
        从而保证「Redis 短暂不可用时后端仍能启动」。"""
        self._pub = self._new_client()
        try:
            await self._pub.ping()
            self._connected = True
            logger.info("RedisBus connected: %s:%s db=%s (RESP%s)",
                        self._host, self._port, self._db, self._protocol)
        except Exception as exc:  # noqa: BLE001 启动期容错，连不上也让服务起来
            self._connected = False
            logger.warning("RedisBus initial ping failed (%s); will retry on demand", exc)

    async def publish(self, topic: str, payload: str) -> None:
        if self._pub is None:
            raise RuntimeError("RedisBus not connected; call connect() first")
        try:
            await self._pub.publish(topic, payload)
            self._connected = True
        except Exception as exc:  # noqa: BLE001 记录并标记断开，客户端下次会自动重连
            self._connected = False
            logger.warning("RedisBus publish to %s failed: %s", topic, exc)
            raise

    async def subscribe(self, topic: str, handler: MessageHandler) -> "asyncio.Task":
        task = asyncio.create_task(self._subscribe_loop(topic, handler))
        self._tasks.append(task)
        return task

    async def _subscribe_loop(self, topic: str, handler: MessageHandler) -> None:
        """单个 topic 的订阅循环：独立连接，断线每 3s 自动重连。"""
        while True:
            client = None
            pubsub = None
            try:
                client = self._new_client()
                pubsub = client.pubsub()
                await pubsub.subscribe(topic)
                logger.info("RedisBus subscribed: %s", topic)
                async for message in pubsub.listen():
                    if message.get("type") != "message":
                        continue  # 跳过 subscribe/unsubscribe 确认帧
                    try:
                        await handler(message["data"])
                    except Exception as exc:  # noqa: BLE001 单条消息处理失败不应中断订阅
                        logger.error("Handler error on %s: %s", topic, exc, exc_info=True)
            except asyncio.CancelledError:
                logger.info("Subscribe loop cancelled: %s", topic)
                break
            except Exception as exc:  # noqa: BLE001 连接层异常 → 重连
                logger.warning("Subscribe loop error on %s: %s; retry in 3s", topic, exc)
                await asyncio.sleep(3)
            finally:
                if pubsub is not None:
                    try:
                        await pubsub.aclose()
                    except Exception:  # noqa: BLE001
                        pass
                if client is not None:
                    try:
                        await client.aclose()
                    except Exception:  # noqa: BLE001
                        pass

    async def close(self) -> None:
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._tasks.clear()
        if self._pub is not None:
            try:
                await self._pub.aclose()
            except Exception:  # noqa: BLE001
                pass
        self._pub = None
        self._connected = False
        logger.info("RedisBus closed")


def create_bus() -> MessageBus:
    """按 config.BUS_TYPE 工厂化消息总线（将来加 MqttBus 时在此分支即可）。"""
    from .config import (BUS_TYPE, REDIS_HOST, REDIS_PORT, REDIS_DB, REDIS_PROTOCOL)
    if BUS_TYPE == "redis":
        return RedisBus(REDIS_HOST, REDIS_PORT, REDIS_DB, REDIS_PROTOCOL)
    raise ValueError(f"Unsupported BUS_TYPE: {BUS_TYPE!r} (未来可支持 'mqtt')")
