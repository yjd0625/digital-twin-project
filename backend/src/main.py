"""主入口：FastAPI 应用，承载 WebSocket(/ws) + REST，并驱动数据源(Source) TCP 数据"""
import asyncio
import json
import logging
import os
import socket
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from .config import (WS_PATH, WS_TOKEN, HTTP_HOST, HTTP_PORT, SOURCE_BUFFER_SIZE,
                     DATA_ENCODING, LOG_LEVEL, LOG_FILE,
                     TOPIC_SOURCE_STATE,
                     INFLUXDB_ENABLED, INFLUXDB_URL, INFLUXDB_TOKEN,
                     INFLUXDB_DATABASE, INFLUXDB_MEASUREMENT_STATE,
                     INFLUXDB_MEASUREMENT_ACTION)
from .source_connector import SourceClient
from .websocket_handler import WebSocketHandler
from .data_processor import DataProcessor
from .bus import create_bus
from .influx_writer import InfluxWriter
from .influx_query import query_history

logger = logging.getLogger(__name__)


# ---- 共享模块（模块级单例，lifespan 与路由共用）----
# 数据经消息总线（Redis Pub/Sub）解耦，为将来切 MQTT 铺路：
#   采集端 source_read_loop --publish source/state-->  Redis --subscribe--> processor.process --> handler.broadcast --> 前端
# 实时环为单向（数据源 -> 后端），不回写控制指令；Plant Simulation 已作为分析外挂断开，
# 仅订阅 source/state 只读消费，未来预测/推演回写走独立通道 source/prediction（待开发）。
source = SourceClient()
bus = create_bus()
handler = WebSocketHandler(bus)
processor = DataProcessor()
influx_writer = InfluxWriter()


# 复用解码器：从字符串头部解析"第一个完整的 JSON 值"，并返回其结束位置
# 这样即使一条 JSON 跨多个 TCP 包到达、或被拆成多段，也能正确重组
_json_decoder = json.JSONDecoder()

# 采集缓冲上限：异常数据流（损坏 JSON / 非 UTF-8 字节）下 buffer 无限制增长会耗尽内存，
# 超过阈值即断开重连并清空（防御性保护，正常流量远小于此值）
MAX_BUFFER_BYTES = 1_048_576  # 1 MB

# InfluxDB 旁路写入任务集合：统一跟踪、shutdown 时回收，避免
# "Task was destroyed but it is pending" 泄漏与任务无限堆积（无背压）
_influx_tasks: set[asyncio.Task] = set()

# 最近一次收到的 state 快照：供前端在模型加载完成后主动拉取（补偿加载期丢失的初始状态）
_latest_state: dict | None = None


async def source_read_loop() -> None:
    """采集端后台任务：持续从数据源(Source)读取并发布到总线（断线自动重连）"""
    loop = asyncio.get_running_loop()
    byte_buffer = b""
    while True:
        try:
            if not source.is_connected:
                try:
                    source.connect()
                    source.reset_backoff()   # 连接成功 → 重置失败计数
                    byte_buffer = b""   # 重连后清空，避免旧数据混入新会话
                except OSError:
                    delay = source.next_backoff()  # 指数退避 + 抖动（封顶 30s）
                    logger.warning("数据源未连接，%.1fs 后重试（第 %d 次）...", delay, source.failures)
                    await asyncio.sleep(delay)
                    continue
            try:
                raw = await loop.run_in_executor(None, source.recv, SOURCE_BUFFER_SIZE)
            except socket.timeout:
                # 数据源保持连接但暂时无数据（recv 5s 超时）→ 视为空读取，非错误，不记日志不 sleep
                continue
            if not raw:
                # recv 返回空 bytes = 对端已关闭连接
                logger.warning("数据源连接已关闭，尝试重连...")
                source.close()
                byte_buffer = b""
                continue
            byte_buffer += raw
            # 防御：缓冲超限（连续损坏数据/非 UTF-8 前缀）→ 断开重连并清空，避免内存无限增长
            if len(byte_buffer) > MAX_BUFFER_BYTES:
                logger.error("采集缓冲超过 %d 字节（疑似异常数据流），断开重连...", MAX_BUFFER_BYTES)
                source.close()
                byte_buffer = b""
                continue
            # 从缓冲字节中尽可能多地解析出完整 JSON 对象
            while True:
                try:
                    text = byte_buffer.decode(DATA_ENCODING)
                except UnicodeDecodeError:
                    break  # 多字节字符被截断，等更多数据再试
                if not text.strip():
                    byte_buffer = b""
                    break
                # 跳过前导空白/换行分隔符：raw_decode 必须从 index 0 解析，带空白前缀的完整消息
                # 会因 ValueError 卡在 buffer 里，直到下一条数据到达才被消费（实时性受损 + buffer 堆积）
                start = len(text) - len(text.lstrip())
                try:
                    obj, end = _json_decoder.raw_decode(text, start)
                except ValueError:
                    break  # 片段不完整，等待更多数据
                # 按字节对齐消费已解析的前缀（raw_decode 返回的 end 是字符索引，已含前导空白）
                consumed = text[:end].encode(DATA_ENCODING)
                byte_buffer = byte_buffer[len(consumed):]
                logger.debug("Received from source: %s", text[start:end])
                parsed = processor.parse(text[start:end])
                # 缓存最近一次 state 快照：前端加载完成后可经 /api/state 拉取全量同步
                if parsed.get("type") == "state":
                    _latest_state = parsed
                # 旁路写入时序数据库（best-effort，不阻塞主流程）
                if influx_writer.enabled:
                    msg_type = parsed.get("type")
                    if msg_type == "state":
                        task = asyncio.create_task(influx_writer.write_state(parsed))
                    elif msg_type == "action":
                        task = asyncio.create_task(influx_writer.write_action(parsed))
                    else:
                        task = None
                    if task is not None:
                        # 跟踪旁路任务：完成后自动移出集合，shutdown 时统一 cancel/gather
                        _influx_tasks.add(task)
                        task.add_done_callback(_influx_tasks.discard)
                # 解耦点①：不再直接 broadcast，而是发布到 source/state 主题
                try:
                    await bus.publish(TOPIC_SOURCE_STATE, json.dumps(parsed, ensure_ascii=False))
                except Exception as exc:  # noqa: BLE001 总线暂不可用不应中断采集
                    logger.warning("Publish source/state failed (dropped 1 msg): %s", exc)
        except asyncio.CancelledError:
            logger.info("Source read loop cancelled.")
            break
        except Exception as exc:
            logger.error("Loop error: %s", exc, exc_info=True)
            await asyncio.sleep(1)
            continue


async def on_state_message(payload: str) -> None:
    """分发端：收到 source/state 消息 → 解析为 dict → 数据处理 → 广播给所有前端 WS"""
    try:
        data = json.loads(payload)
    except ValueError:
        logger.warning("Discard non-JSON on source/state: %s", payload[:120])
        return
    # 解耦点②：解析后、广播前插入数据处理（占位函数，后续在此编辑业务逻辑）
    data = processor.process(data)
    await handler.broadcast(data)


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
    # 清空上一轮快照（重启后重新积累）
    global _latest_state
    _latest_state = None
    # 1) 连接消息总线（Redis 暂不可用也不致命，publish 会按需自动重连）
    await bus.connect()
    # 1.5) 连接时序数据库（可选；未启用或连接失败均不致命）
    if INFLUXDB_ENABLED:
        # InfluxDBClient3 构造含网络握手，放线程执行避免阻塞事件循环
        await asyncio.to_thread(influx_writer.connect)
    # 2) 订阅：source/state → 广播前端（单向；无 command 订阅）
    await bus.subscribe(TOPIC_SOURCE_STATE, on_state_message)
    # 3) 采集端：读数据源 → 发布 source/state
    task = asyncio.create_task(source_read_loop())
    yield
    # 关闭阶段
    # 先关闭 socket：让采集循环中阻塞在 recv（最多 5s 超时）的调用立即返回，
    # 避免 cancel 后 await task 空等线程返回导致的服务关闭延迟。
    source.close()
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    # 回收 InfluxDB 旁路写入任务（避免 "Task was destroyed but it is pending" 泄漏）
    if _influx_tasks:
        for t in list(_influx_tasks):
            t.cancel()
        await asyncio.gather(*_influx_tasks, return_exceptions=True)
        _influx_tasks.clear()
    influx_writer.close()
    await bus.close()
    logger.info("Server shut down.")


app = FastAPI(
    title="数字孪生后端服务",
    description="数据源(Source) ↔ 前端 实时数据桥接（FastAPI 版，已与 Plant Simulation 解耦）。"
                "WebSocket 实时推送，REST 提供健康检查，交互式文档见 /docs。",
    version="1.0.0",
    lifespan=lifespan,
)

# 允许前端（如 Vite 开发服务器）跨域调用 REST / 建立 WebSocket
# 注意：allow_origins=["*"] 时 allow_credentials 必须为 false——
# 浏览器规范禁止"带凭据 + 通配来源"组合（allow_credentials=True + "*" 是无效且反模式）。
# demo 前端无 Cookie/凭据需求；生产若需凭据，应改为显式 origin 白名单 + allow_credentials=True。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket(WS_PATH)
async def ws_endpoint(websocket: WebSocket):
    """前端实时通道：把 source/state 经总线收到的消息广播给前端（实时环单向，无控制指令回写）

    WebSocket 可选鉴权（WS_TOKEN 非空时启用）：前端连接需带 `?token=<WS_TOKEN>`
    或 `Authorization: Bearer <WS_TOKEN>`；缺失/错误则直接关闭（1008 策略违规）。
    留空则不校验，开放 demo 默认可连。
    """
    if WS_TOKEN:
        token = websocket.query_params.get("token") \
            or websocket.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        if token != WS_TOKEN:
            logger.warning("WS 连接鉴权失败（token 缺失或错误），已拒绝")
            await websocket.close(code=1008, reason="unauthorized")
            return
    await handler.handle_client(websocket)


@app.get("/api/state", tags=["数据"], summary="最近一次全量状态快照")
async def api_state():
    """返回后端最近一次收到的 state 消息（部分覆盖语义的累积视角）。

    前端在模型加载完成后调用此接口拉取一次，补偿「加载窗口内 WebSocket 消息被丢弃」
    导致的初始状态丢失；尚未收到任何 state 时返回 {"state": null}。
    """
    return {"state": _latest_state}


@app.get("/api/history", tags=["数据"], summary="查询设备历史时序（来自 InfluxDB）")
async def api_history(
    device: str = Query(..., description="设备 station_id，如 '组装工位 #1'"),
    part: str = Query("Clamp", description="零件名，如 Clamp / Z1"),
    field: str = Query("temp", description="字段，见 influx_query.ALLOWED_FIELDS"),
    range_: str = Query("1h", alias="range", description="时间范围: 15m/1h/6h/24h/7d"),
):
    """从 InfluxDB 读取某设备某零件某字段的历史序列，供前端历史面板绘图。

    依赖 INFLUXDB_ENABLED=true 且 client 已连接（否则 503）；查询异常 502。
    """
    if not INFLUXDB_ENABLED:
        return JSONResponse(
            status_code=503,
            content={"error": "InfluxDB 未启用（后端需 INFLUXDB_ENABLED=true）"},
        )
    points, err = query_history(
        influx_writer, device=device, part=part, field=field, range_=range_
    )
    if err:
        return JSONResponse(
            status_code=502,
            content={"error": err, "last_error": influx_writer.last_error},
        )
    return {
        "device": device,
        "part": part,
        "field": field,
        "range": range_,
        "points": points,
        "count": len(points),
    }


@app.get("/health", tags=["运维"], summary="健康检查")
async def health():
    """返回服务是否存活，以及到数据源(Source)的连接状态"""
    return {"status": "ok", "source_connected": source.is_connected}


@app.get("/status", tags=["运维"], summary="运行状态")
async def status():
    """返回当前前端连接数、数据源(Source)与消息总线连接状态"""
    return {
        "source_connected": source.is_connected,
        "bus_connected": bus.is_connected,
        "frontend_connections": handler.connection_count,
        "influxdb": {
            "enabled": influx_writer.enabled,
            "connected": influx_writer.client is not None,
            "database": influx_writer.database,
            "write_count": influx_writer.write_count,
            "last_error": influx_writer.last_error,
        },
    }


if __name__ == "__main__":
    uvicorn.run(app, host=HTTP_HOST, port=HTTP_PORT)
