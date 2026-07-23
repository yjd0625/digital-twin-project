"""InfluxDB 3 Core 旁路写入：把数据源(Source)的 state/action 同步落库（best-effort）

设计要点：
- 仅作旁路记录，写入失败 / 未启用都不影响 WebSocket 广播与采集主流程。
- 写库用 asyncio.to_thread 包裹同步客户端，避免阻塞事件循环。
- InfluxDB 3 Core 为 schemaless：measurement / field 首次写入自动创建，无需预建表。
- field 不能为 null：只写数据中存在的维度，缺失维度直接跳过。
- Point.time = 实际接收时刻（保证时序正确、单调）；simulationTime 作为 field 保留仿真时钟。
- 仿真时刻字段名统一为 simulationTime；为兼容旧 action 数据，回退读取 timestamp。
"""
import asyncio
import logging
import time
from datetime import datetime, timezone

from . import config

logger = logging.getLogger(__name__)


def _as_float(v):
    """把可能的大小数 / 字符串转 float，无法转换返回 None（不写该 field）"""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _add_vec(point, prefix, transform, with_speed=False):
    """把 position/rotation/scale 的三个轴写入 Point（只写存在的轴）。
    with_speed=True 时额外写 <prefix>_speed（action 通道速度）。返回 Point。"""
    if not isinstance(transform, dict):
        return point
    for axis in ("x", "y", "z"):
        val = transform.get(axis)
        if val is not None:
            f = _as_float(val)
            if f is not None:
                point = point.field(f"{prefix}_{axis}", f)
    if with_speed:
        sp = transform.get("speed")
        if sp is not None:
            f = _as_float(sp)
            if f is not None:
                point = point.field(f"{prefix}_speed", f)
    return point


class InfluxWriter:
    def __init__(self):
        self.enabled = config.INFLUXDB_ENABLED
        self.url = config.INFLUXDB_URL
        self.token = config.INFLUXDB_TOKEN or None
        self.database = config.INFLUXDB_DATABASE
        self.measurement_state = config.INFLUXDB_MEASUREMENT_STATE
        self.measurement_action = config.INFLUXDB_MEASUREMENT_ACTION
        self.client = None
        self.write_count = 0
        self.last_error = None

    # ---- 生命周期 ----
    def connect(self):
        if not self.enabled:
            logger.info("InfluxDB 写入已禁用（INFLUXDB_ENABLED=false）")
            return
        try:
            from influxdb_client_3 import InfluxDBClient3
            # InfluxDBClient3 的 host 参数接收**带 scheme 的完整 URL**（如 http://localhost:18080）；
            # 它内部 urlparse 出 scheme/hostname/port，据此构造 HTTP 写地址与 gRPC 查询地址。
            # 不能传 "localhost:18080"（无 scheme）：内部会把 gRPC 地址拼成
            # grpc+tcp://localhost:18080:443 导致 URI 解析失败。该版本也无独立 port 形参。
            self.client = InfluxDBClient3(
                token=self.token,
                host=self.url,
                database=self.database,
            )
            logger.info("InfluxDB client 已连接: %s db=%s", self.url, self.database)
        except ImportError:
            logger.warning("未安装 influxdb3-python，InfluxDB 写入不可用（请在本机 DT 环境 pip install influxdb3-python）")
            self.client = None
        except Exception as exc:  # noqa: BLE001
            logger.warning("InfluxDB 连接失败: %s", exc)
            self.client = None

    def close(self):
        if self.client is not None:
            try:
                self.client.close()
            except Exception:  # noqa: BLE001
                pass
            self.client = None

    # ---- 映射：state（每帧，来自 Plant type=state）----
    def state_to_points(self, parsed):
        from influxdb_client_3 import Point
        points = []
        sim_time = _as_float(parsed.get("simulationTime", parsed.get("timestamp")))
        simulate_speed = _as_float(parsed.get("simulateSpeed"))
        received_at = time.time()
        ts = datetime.now(timezone.utc)
        for station in parsed.get("stations", []):
            sid = station.get("id")
            temp = _as_float(station.get("temp"))
            for part_name, transform in station.get("parts", {}).items():
                p = (Point(self.measurement_state)
                     .tag("station_id", str(sid))
                     .tag("part_name", str(part_name))
                     .time(ts))
                p = _add_vec(p, "pos", transform.get("position"))
                p = _add_vec(p, "rot", transform.get("rotation"))   # 不含 angle（按约定去掉）
                p = _add_vec(p, "scale", transform.get("scale"))
                if temp is not None:
                    p = p.field("temp", temp)
                if sim_time is not None:
                    p = p.field("simulationTime", sim_time)
                p = p.field("received_at", received_at)
                if simulate_speed is not None:
                    p = p.field("simulate_speed", simulate_speed)
                points.append(p)
        return points

    # ---- 映射：action（事件，来自 Plant type=action）----
    def action_to_points(self, parsed):
        from influxdb_client_3 import Point
        points = []
        sim_time = _as_float(parsed.get("simulationTime", parsed.get("timestamp")))
        simulate_speed = _as_float(parsed.get("simulateSpeed"))
        received_at = time.time()
        ts = datetime.now(timezone.utc)
        for cmd in parsed.get("commands", []):
            sid = cmd.get("id")
            temp = _as_float(cmd.get("temp"))
            for part_name, transform in cmd.get("parts", {}).items():
                p = (Point(self.measurement_action)
                     .tag("station_id", str(sid))
                     .tag("part_name", str(part_name))
                     .time(ts))
                p = _add_vec(p, "pos", transform.get("position"), with_speed=True)
                p = _add_vec(p, "rot", transform.get("rotation"), with_speed=True)
                p = _add_vec(p, "scale", transform.get("scale"), with_speed=True)
                if temp is not None:
                    p = p.field("temp", temp)
                if sim_time is not None:
                    p = p.field("simulationTime", sim_time)
                p = p.field("received_at", received_at)
                if simulate_speed is not None:
                    p = p.field("simulate_speed", simulate_speed)
                points.append(p)
        return points

    # ---- 底层写入（同步，在线程中执行）----
    def _write(self, points):
        if not points:
            return
        if self.client is None:
            logger.warning("InfluxDB client 未连接，跳过 %d 条写入", len(points))
            return
        try:
            # 逐条写入：influxdb3-python 的 client.write(points=list) 批量路径不可靠
            # （实测整批被丢弃或仅写入部分字段），单条 write(record=p) 稳定落库。
            for p in points:
                self.client.write(p)
            self.write_count += len(points)
            self.last_error = None
        except Exception as exc:  # noqa: BLE001
            self.last_error = str(exc)
            logger.warning("InfluxDB 写入失败（%d 条）: %s", len(points), exc)

    # ---- 异步入口（事件循环侧调用）----
    async def write_state(self, parsed):
        if not self.enabled or self.client is None:
            return
        try:
            await asyncio.to_thread(self._write, self.state_to_points(parsed))
        except Exception as exc:  # noqa: BLE001
            logger.warning("write_state 异常: %s", exc)

    async def write_action(self, parsed):
        if not self.enabled or self.client is None:
            return
        try:
            await asyncio.to_thread(self._write, self.action_to_points(parsed))
        except Exception as exc:  # noqa: BLE001
            logger.warning("write_action 异常: %s", exc)
