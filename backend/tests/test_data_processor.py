"""DataProcessor 单元测试：parse / process 纯逻辑（不依赖网络或 Redis）"""
import json

from src.data_processor import DataProcessor


def test_parse_valid_json_dict():
    out = DataProcessor.parse('{"type":"state","stations":[]}')
    assert out == {"type": "state", "stations": []}


def test_parse_double_encoded_json():
    # 双重编码：外层是合法 JSON 字符串，内层才是真正的 dict
    inner = '{"type":"state"}'
    raw = json.dumps(inner)  # 生成字符串值 "{\"type\":\"state\"}"
    out = DataProcessor.parse(raw)
    assert out == {"type": "state"}


def test_parse_non_json_passthrough():
    raw = "this is not json"
    out = DataProcessor.parse(raw)
    assert out == {"raw": raw}


def test_parse_json_scalar_passthrough():
    # JSON 合法但不是 dict（如数组/数字）→ 安全透传，不误拆成 device/metric/value
    out = DataProcessor.parse("[1,2,3]")
    assert out == {"raw": "[1,2,3]"}


def test_process_passthrough():
    data = {"type": "state", "stations": [{"id": "A"}]}
    assert DataProcessor.process(data) is data
