"""数据源连接器抽象基类（与后端传输协议解耦）。

平台协议要点：
- 后端是 TCP 客户端，连接器是 TCP 服务端（监听 SOURCE_PORT，后端连上来后推数据）。
- 信封用 JSON，多个帧直接拼接发送，**不带换行/分隔符**（后端用 raw_decode
  顺序解析，前导空白会导致解析失败）。
- 中文 id 用 UTF-8（ensure_ascii=False）。
- 信封 type ∈ {create, state, action, reset, attach, detach}。

任何语言/系统只要实现同一协议即可作为数据源接入，后端零改动。
"""
from __future__ import annotations

import abc
import json
import socket
import threading
import time

# 平台支持的信封类型
ENVELOPE_TYPES = ("create", "state", "action", "reset", "attach", "detach")


def build_frame(envelope: dict) -> bytes:
    """把一个 JSON 信封编码为字节帧（UTF-8，无尾随分隔符）。

    多个帧直接拼接、不带换行/空格——后端用 raw_decode 顺序解析，
    前导空白会解析失败，故此处严格不带任何分隔符。
    """
    return json.dumps(envelope, ensure_ascii=False).encode("utf-8")


class SourceConnector(abc.ABC):
    """数据源连接器基类。

    子类实现 generate_frame() 产出下一帧信封；基类负责 TCP 服务端监听、
    接受后端连接、按帧率拼接发送。后端下发的指令由 on_receive() 处理
    （实时环为单向：数据源→后端；预测/推演回写走独立通道，默认忽略）。
    """

    def __init__(self, host: str = "0.0.0.0", port: int = 30000):
        self.host = host
        self.port = port
        self._stop = threading.Event()

    @abc.abstractmethod
    def generate_frame(self) -> dict | None:
        """返回下一帧信封 dict；返回 None 表示本周期不发送。"""
        raise NotImplementedError

    def on_receive(self, payload: bytes) -> None:
        """处理后端下发的指令（预留）。实时数据源默认忽略。"""
        # 实时环为单向（数据源→后端）。预测/推演回写走独立通道 source/prediction。
        pass

    def tick(self) -> float:
        """每帧间隔（秒）。子类可覆盖（如按 hz）。"""
        return 1.0 / 20.0

    def stop(self) -> None:
        self._stop.set()

    def serve(self) -> None:
        """起 TCP 服务端，阻塞等待后端连接并持续推送，直到 stop()。"""
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind((self.host, self.port))
        srv.listen(1)
        print(f"[connector] 监听 {self.host}:{self.port}，等待后端(数据源客户端)连接...")
        while not self._stop.is_set():
            try:
                srv.settimeout(1.0)
                conn, addr = srv.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            print(f"[connector] 后端已连接：{addr}")
            self._stream(conn)
            print("[connector] 连接结束，等待重连...")
        srv.close()

    def _stream(self, conn: socket.socket) -> None:
        conn.settimeout(1.0)
        try:
            while not self._stop.is_set():
                # 排空对端可能下发的数据（指令），目前忽略
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
                frame = self.generate_frame()
                if frame is not None:
                    try:
                        conn.sendall(build_frame(frame))
                    except OSError:
                        break
                time.sleep(self.tick())
        finally:
            try:
                conn.close()
            except OSError:
                pass
