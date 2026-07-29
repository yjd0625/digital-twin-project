"""InfluxDB 3 Core 历史查询：把 station_state 的历史时序读给前端面板

设计要点：
- 仅读，best-effort：未启用 / 未连接 / 查询异常均返回 (None, error)。
- 复用 influx_writer 已建好的同一 client（不重复建连）。
- InfluxDB 3 Core 用 SQL 方言 + `mode="all"`（返回 pyarrow Table），再转成前端友好的 [{time, value}]。
- field 走白名单（防注入）；device / part 做单引号转义。
"""
import logging
import re
from . import config

logger = logging.getLogger(__name__)

# state 测量支持的标量 field 白名单（与 influx_writer.state_to_points 写入的 field 对齐）
ALLOWED_FIELDS = {
    "temp", "simulationTime", "received_at", "simulate_speed",
    "pos_x", "pos_y", "pos_z",
    "rot_x", "rot_y", "rot_z",
    "scale_x", "scale_y", "scale_z",
}

_UNIT_MAP = {"m": "minute", "h": "hour", "d": "day"}


def _range_to_interval(range_: str) -> str:
    """把前端传来的 '15m'/'1h'/'7d' 转成 InfluxDB SQL 的 interval 字面量 '15 minutes' 等。"""
    s = str(range_).strip().lstrip("-")
    m = re.match(r"^(\d+)\s*([mhd])$", s)
    if not m:
        return "1 hour"
    num, unit = m.group(1), _UNIT_MAP[m.group(2)]
    return f"{num} {unit}s"


def _to_points(result):
    """把 pyarrow Table（`mode='all'`）转成 [{time, value}]。"""
    if result is None:
        return []
    # pyarrow Table
    if hasattr(result, "to_pydict"):
        d = result.to_pydict()
    # pandas DataFrame（兜底）
    elif hasattr(result, "to_dict"):
        d = result.to_dict(orient="list")
    else:
        return []
    times = d.get("time")
    if not times:
        return []
    field = next((k for k in d if k != "time"), None)
    if field is None:
        return []
    values = d[field]
    n = len(times)
    points = []
    for i in range(n):
        v = values[i]
        if v is None:
            continue
        try:
            val = float(v)
        except (TypeError, ValueError):
            val = v
        t = times[i]
        tstr = t.isoformat() if hasattr(t, "isoformat") else str(t)
        points.append({"time": tstr, "value": val})
    return points


def query_history(writer, device, part="Clamp", field="temp", range_="1h", measurement=None):
    """查询某设备某零件某 field 的历史序列。返回 (points, error)。

    range_ 形如 '1h' / '15m'（InfluxDB 时间偏移语法）。
    """
    if not writer.enabled:
        return None, "INFLUXDB_ENABLED=false"
    client = writer.client
    if client is None:
        return None, "InfluxDB client 未连接"
    if field not in ALLOWED_FIELDS:
        return None, f"字段 {field!r} 不在允许列表 {sorted(ALLOWED_FIELDS)}"
    meas = measurement or config.INFLUXDB_MEASUREMENT_STATE
    # 防注入：device / part 中的单引号转义为两个单引号
    dev = str(device).replace("'", "''")
    prt = str(part).replace("'", "''")
    interval = _range_to_interval(range_)
    sql = (
        f"SELECT time, {field} FROM {meas} "
        f"WHERE station_id = '{dev}' AND part_name = '{prt}' "
        f"AND time >= now() - interval '{interval}' "
        f"ORDER BY time"
    )
    try:
        # mode="all" => pyarrow Table（influxdb3-python 默认也是它）
        result = client.query(sql, language="sql", mode="all")
        points = _to_points(result)
        return points, None
    except Exception as exc:  # noqa: BLE001
        logger.warning("InfluxDB history query failed: %s | sql=%s", exc, sql)
        return None, str(exc)
