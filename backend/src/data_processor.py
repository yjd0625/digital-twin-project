"""数据聚合、计算、格式化"""
import logging

logger = logging.getLogger(__name__)


class DataProcessor:
    """对 PlantSimulation 的原始数据进行清洗、解析、格式化"""

    @staticmethod
    def parse(raw: str) -> dict:
        """解析 PlantSimulation 发来的字符串，返回结构化字典
        格式示例: "machine_01,TEMP,85.2" 或 JSON 字符串

        容错：PlantSimulation 常把 JSON 当作字符串再发一次（双重编码），
        此时 json.loads 会得到 str 而非 dict，这里会再解一层，保证返回 dict。
        """
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
        # 已在 main.py 的 plant_read_loop（字节缓冲 + raw_decode）中统一处理。
        logger.warning("收到非 JSON 数据，原样透传: %s", raw[:200])
        return {"raw": raw}

    @staticmethod
    def build_telemetry(device: str, metric: str, value: str) -> dict:
        """组装标准遥测消息格式"""
        return {
            "type": "telemetry",
            "device": device,
            "metric": metric,
            "value": value,
        }
