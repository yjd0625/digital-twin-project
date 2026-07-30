"""MQTT 数据源连接器：订阅 MQTT 主题，把收到的平台信封经 TCP 转发给后端。

这是「可插拔数据源」的第二个参考实现——证明本项目后端只认协议、不挑数据源：
同一个后端既能接 `python_realtime`（TCP 直推），也能接本连接器（MQTT → TCP 桥接），
后端零改动。

链路：
    MQTT broker --(订阅)--> 本连接器 --(TCP :30000)--> 后端(FastAPI) --(Redis/WS)--> 前端
                                                                              --(InfluxDB 旁路)

运行：
    pip install -r connectors/requirements.txt   # 仅需 paho-mqtt
    python -m connectors.sources.mqtt_source --broker test.mosquitto.org --topic digital-twin/source
参数：
    --host/--port  TCP 监听地址（默认 0.0.0.0:30000，后端作为客户端连上来）
    --broker        MQTT broker 地址（默认公共测试 broker test.mosquitto.org）
    --mqtt-port     MQTT broker 端口（默认 1883）
    --topic         订阅主题（默认 digital-twin/source）
    --username/--password  MQTT 认证（可选）
    --client-id     MQTT client id（可选，默认随机）
    --dry-run       不连 MQTT/TCP，仅验证信封解析与转发逻辑
"""
from __future__ import annotations

import argparse
import json
import queue
import signal
import threading
import time

from ..base import ENVELOPE_TYPES, SourceConnector, build_frame


def _make_mqtt_client(client_id: str, username: str, password: str):
    """版本兼容地构造 paho-mqtt Client（同时支持 1.x 与 2.x）。"""
    from paho.mqtt.client import Client

    try:
        from paho.mqtt.client import CallbackAPIVersion

        client = Client(callback_api_version=CallbackAPIVersion.VERSION2, client_id=client_id)
    except (ImportError, TypeError):
        # paho-mqtt < 2.0：Client 不接收 callback_api_version
        client = Client(client_id=client_id)
    if username or password:
        client.username_pw_set(username, password)
    return client


class MqttSourceConnector(SourceConnector):
    """订阅 MQTT 主题，把合法信封入队，后端连上后经 TCP 逐帧转发。

    与 RealtimeSimulator 的区别：本类不「生成」帧，而是「桥接」——
    MQTT 来一帧就转发一帧（事件驱动），而非按固定帧率 tick 生成。
    """

    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 30000,
        broker: str = "test.mosquitto.org",
        mqtt_port: int = 1883,
        topic: str = "digital-twin/source",
        username: str = "",
        password: str = "",
        client_id: str = "",
    ):
        super().__init__(host, port)
        self.broker = broker
        self.mqtt_port = mqtt_port
        self.topic = topic
        self.username = username
        self.password = password
        self._client_id = client_id
        self._queue: "queue.Queue[dict]" = queue.Queue()
        self._client = None

    def generate_frame(self):
        # 本类以事件驱动的 _stream() 转发，不按 tick 生成帧；
        # 保留基类接口实现（返回 None），避免成为抽象类。
        return None

    # ---- 信封校验 ----
    @staticmethod
    def _is_valid_envelope(env) -> bool:
        return isinstance(env, dict) and env.get("type") in ENVELOPE_TYPES

    # ---- MQTT 回调 ----
    def _on_connect(self, client, userdata, flags, rc, *args) -> None:
        if rc == 0:
            print(f"[mqtt] 已连 broker {self.broker}:{self.mqtt_port}，订阅 {self.topic}")
            client.subscribe(self.topic)
        else:
            print(f"[mqtt] 连接 broker 失败 rc={rc}")

    def _on_message(self, client, userdata, msg) -> None:
        payload = msg.payload.decode("utf-8", errors="replace")
        decoder = json.JSONDecoder()
        idx = 0
        n = 0
        while idx < len(payload):
            # 跳过空白（兼容「无分隔符、多帧拼接」的平台帧约定）
            while idx < len(payload) and payload[idx] in " \t\r\n":
                idx += 1
            if idx >= len(payload):
                break
            try:
                env, end = decoder.raw_decode(payload, idx)
            except json.JSONDecodeError as e:
                print(f"[mqtt] 信封解析失败（已忽略）：{e}")
                break
            idx = end
            if self._is_valid_envelope(env):
                self._queue.put(env)
                n += 1
            else:
                bad = env.get("type") if isinstance(env, dict) else type(env).__name__
                print(f"[mqtt] 忽略未知信封 type={bad}")
        if n:
            print(f"[mqtt] 收到 {n} 帧（来自 {msg.topic}）")

    # ---- MQTT 生命周期 ----
    def _start_mqtt(self) -> None:
        self._client = _make_mqtt_client(self._client_id, self.username, self.password)
        self._client.on_connect = self._on_connect
        self._client.on_message = self._on_message
        try:
            self._client.connect(self.broker, self.mqtt_port, keepalive=60)
        except Exception as e:  # 连不上 broker 时仍起 TCP 服务端，等待重连
            print(f"[mqtt] broker 连接异常（将每 60s 重试）：{e}")
            return
        self._client.loop_start()

    def _stop_mqtt(self) -> None:
        if self._client is not None:
            try:
                self._client.loop_stop()
                self._client.disconnect()
            except Exception:
                pass

    # ---- 重写基类：先起 MQTT，再跑 TCP 服务端 ----
    def serve(self) -> None:
        self._start_mqtt()
        try:
            super().serve()
        finally:
            self._stop_mqtt()

    def _stream(self, conn) -> None:
        """事件驱动：后端连上后，MQTT 队列里每来一帧就立即转发（不按 tick）。"""
        conn.settimeout(1.0)
        try:
            while not self._stop.is_set():
                # 排空对端可能下行的数据（指令），目前忽略
                try:
                    conn.setblocking(False)
                    try:
                        data = conn.recv(65536)
                        if data:
                            self.on_receive(data)
                    except BlockingIOError:
                        pass
                    finally:
                        conn.setblocking(True)
                except OSError:
                    break
                try:
                    frame = self._queue.get(timeout=1.0)
                except queue.Empty:
                    continue
                try:
                    conn.sendall(build_frame(frame))
                except OSError:
                    break
        finally:
            try:
                conn.close()
            except OSError:
                pass

    # ---- 自检 ----
    def dry_run(self) -> None:
        print("[mqtt_source] dry-run：验证信封解析与转发逻辑（不连 MQTT/TCP）")
        samples = [
            {"type": "state", "timestamp": int(time.time()),
             "stations": [{"id": "组装工位 #1", "status": "running", "temp": 33,
                           "parts": {"Clamp": {"position": {"y": 1.2}}}}]},
            {"type": "action",
             "commands": [{"id": "组装工位 #1", "duration": 1.5,
                           "parts": {"LeftSlide": {"position": {"x": 1.0, "duration": 1.5}}}}]},
            # 无分隔符、多帧拼接（与平台 TCP 帧约定一致）
            '{"type":"state","stations":[{"id":"搬运机器人 #1","status":"moving"}]}'
            '{"type":"action","commands":[]}',
            "not json at all",  # 应被忽略
            {"type": "unknown_type"},  # 应被忽略
        ]
        n_ok = 0
        for s in samples:
            if isinstance(s, str):
                payload = s
                decoder = json.JSONDecoder()
                idx = 0
                while idx < len(payload):
                    while idx < len(payload) and payload[idx] in " \t\r\n":
                        idx += 1
                    if idx >= len(payload):
                        break
                    try:
                        env, end = decoder.raw_decode(payload, idx)
                    except json.JSONDecodeError:
                        print(f"  [忽略] 非法 JSON：{payload[idx:idx + 30]!r}")
                        break
                    idx = end
                    if self._is_valid_envelope(env):
                        print(f"  [OK] 拼接信封解析 -> {env.get('type')}")
                        n_ok += 1
                    else:
                        print(f"  [忽略] 未知 type: {env.get('type')}")
            else:
                if self._is_valid_envelope(s):
                    print("  [OK] 信封:", s["type"], "->", build_frame(s).decode("utf-8")[:120], "...")
                    n_ok += 1
                else:
                    print(f"  [忽略] 未知 type: {s.get('type')}")
        print(f"[mqtt_source] dry-run 结束，合法信封 {n_ok} 条")


def main() -> None:
    ap = argparse.ArgumentParser(description="MQTT 数据源连接器（订阅 MQTT，经 TCP 转发给后端）")
    ap.add_argument("--host", default="0.0.0.0", help="TCP 监听地址（默认 0.0.0.0）")
    ap.add_argument("--port", type=int, default=30000, help="TCP 监听端口（默认 30000，后端作为客户端连上来）")
    ap.add_argument("--broker", default="test.mosquitto.org", help="MQTT broker 地址（默认公共测试 broker test.mosquitto.org）")
    ap.add_argument("--mqtt-port", type=int, default=1883, help="MQTT broker 端口（默认 1883）")
    ap.add_argument("--topic", default="digital-twin/source", help="订阅主题（默认 digital-twin/source）")
    ap.add_argument("--username", default="", help="MQTT 用户名（可选）")
    ap.add_argument("--password", default="", help="MQTT 密码（可选）")
    ap.add_argument("--client-id", default="", dest="client_id", help="MQTT client id（可选，默认随机）")
    ap.add_argument("--dry-run", action="store_true", help="不连 MQTT/TCP，仅验证信封解析与转发逻辑")
    args = ap.parse_args()

    conn = MqttSourceConnector(
        host=args.host, port=args.port, broker=args.broker, mqtt_port=args.mqtt_port,
        topic=args.topic, username=args.username, password=args.password, client_id=args.client_id,
    )

    if args.dry_run:
        conn.dry_run()
        return

    def _handler(signum, frame):
        print("\n[mqtt_source] 收到停止信号，退出...")
        conn.stop()

    signal.signal(signal.SIGINT, _handler)
    signal.signal(signal.SIGTERM, _handler)
    try:
        conn.serve()
    except KeyboardInterrupt:
        conn.stop()


if __name__ == "__main__":
    main()
