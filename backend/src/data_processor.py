\"\"\"数据聚合、计算、格式化\"\"\"
import logging

logger = logging.getLogger(__name__)


class DataProcessor:
    \"\"\"对 PlantSimulation 的原始数据进行清洗、解析、格式化\"\"\"

    @staticmethod
    def parse(raw: str) -> dict:
        \"\"\"解析 PlantSimulation 发来的字符串，返回结构化字典\"
        格式示例: \"machine_01,TEMP,85.2\" 或 JSON 字符串
        \"\"\"
        raw = raw.strip()
        # 尝试 JSON 解析
        import json
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass

        # 逗号分隔格式兜底
        parts = [p.strip() for p in raw.split(",")]
        if len(parts) >= 2:
            return {"device": parts[0], "metric": parts[1], "value": parts[2] if len(parts) > 2 else ""}

        return {"raw": raw}

    @staticmethod
    def build_telemetry(device: str, metric: str, value: str) -> dict:
        \"\"\"组装标准遥测消息格式\"\"\"
        return {
            "type": "telemetry",
            "device": device,
            "metric": metric,
            "value": value,
        }
