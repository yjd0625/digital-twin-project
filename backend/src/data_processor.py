"""数据聚合、计算、格式化"""
import logging

logger = logging.getLogger(__name__)


class DataProcessor:
    """对数据源(Source)的原始数据进行清洗、解析、格式化"""

    @staticmethod
    def parse(raw: str) -> dict:
        """解析数据源(Source)发来的字符串，返回结构化字典"""
        import json
        raw = raw.strip()
        obj = None
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            obj = None

        # 拆双重编码：若解析结果是字符串，再尝试解析一次
        if isinstance(obj, str):
            try:
                obj = json.loads(obj)
            except json.JSONDecodeError:
                pass

        if isinstance(obj, dict):
            return obj

        # 既不是 dict 也无法解析为 JSON：安全透传，避免误拆成 device/metric/value
        # 注意：旧的"逗号分隔兜底"已移除——它会把被 TCP 截断的 JSON 片段
        # 错误拆成 {device,metric,value}，导致前端识别不到 type。消息重组
        # 已在 main.py 的 source_read_loop（字节缓冲 + raw_decode）中统一处理。
        logger.warning("收到非 JSON 数据，原样透传: %s", raw[:200])
        return {"raw": raw}

    @staticmethod
    def process(data: dict) -> dict:
        """数据处理占位函数：解析之后、广播前端之前的二次加工环节。

        当前仅原样透传，作为后续业务逻辑的唯一种植点（stub）。
        后续可在此实现：
          - 字段映射 / 重命名（与前端约定字段对齐）
          - 单位换算、精度裁剪
          - 异常值 / 缺失值清洗与兜底
          - 设备状态聚合、派生指标计算
          - 按前端所需结构重组（type 信封分流等）
        """
        # TODO: 在此实现具体的数据处理逻辑（占位，暂原样返回）
        return data

    @staticmethod
    def build_telemetry(device: str, metric: str, value: str) -> dict:
        """组装标准遥测消息格式"""
        return {
            "type": "telemetry",
            "device": device,
            "metric": metric,
            "value": value,
        }
