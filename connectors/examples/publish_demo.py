"""MQTT 发布端演示：向主题推送符合平台协议的 state/action 信封。

配合 `python -m connectors.sources.mqtt_source` 使用——
后者订阅同一主题并把帧经 TCP 转发给后端，从而驱动前端 3D 场景动起来。

用法：
    pip install -r connectors/requirements.txt
    # 终端1：起连接器（订阅 + TCP 转发）
    python -m connectors.sources.mqtt_source --broker test.mosquitto.org --topic digital-twin/source
    # 终端2：起本发布端（发测试数据）
    python -m connectors.examples.publish_demo --broker test.mosquitto.org --topic digital-twin/source

参数：
    --broker/--mqtt-port/--topic/--username/--password  与连接器一致
    --hz           推送频率（默认 10）
"""
from __future__ import annotations

import argparse
import json
import math
import time

from paho.mqtt.client import Client


def _make_client():
    try:
        from paho.mqtt.client import CallbackAPIVersion

        return Client(callback_api_version=CallbackAPIVersion.VERSION2)
    except (ImportError, TypeError):
        return Client()


def make_state(t: float) -> dict:
    return {
        "type": "state",
        "timestamp": int(time.time()),
        "simulationTime": round(t, 3),
        "simulateSpeed": 1,
        "stations": [
            {"id": "组装工位 #1", "status": "running", "temp": 32 + 3 * math.sin(t),
             "parts": {"Clamp": {"position": {"y": 1.0 + 0.8 * math.sin(t * 1.5)}}}},
            {"id": "搬运机器人 #1", "status": "moving", "temp": 28 + 2 * math.sin(t),
             "position": {"x": 15 + 5 * math.sin(t * 0.6)}},
        ],
    }


def make_action(toggle: bool) -> dict:
    x = 1.0 if toggle else 0.0
    return {
        "type": "action",
        "simulationTime": round(time.time(), 3),
        "commands": [
            {"id": "组装工位 #1", "duration": 1.5,
             "parts": {"LeftSlide": {"position": {"x": x, "duration": 1.5}}}},
        ],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="MQTT 发布端演示（推送 state/action 信封）")
    ap.add_argument("--broker", default="test.mosquitto.org")
    ap.add_argument("--mqtt-port", type=int, default=1883)
    ap.add_argument("--topic", default="digital-twin/source")
    ap.add_argument("--hz", type=int, default=10)
    ap.add_argument("--username", default="")
    ap.add_argument("--password", default="")
    args = ap.parse_args()

    client = _make_client()
    if args.username or args.password:
        client.username_pw_set(args.username, args.password)
    client.connect(args.broker, args.mqtt_port, keepalive=60)
    client.loop_start()

    t0 = time.time()
    toggle = False
    n = 0
    try:
        print(f"[publish_demo] 每 1/{args.hz}s 发 state，每 4s 发 action，Ctrl+C 停止")
        while True:
            t = time.time() - t0
            client.publish(args.topic, json.dumps(make_state(t), ensure_ascii=False))
            if n % (args.hz * 4) == 0:
                toggle = not toggle
                client.publish(args.topic, json.dumps(make_action(toggle), ensure_ascii=False))
            n += 1
            time.sleep(1.0 / args.hz)
    except KeyboardInterrupt:
        pass
    finally:
        client.loop_stop()
        client.disconnect()
        print("\n[publish_demo] 已停止")


if __name__ == "__main__":
    main()
