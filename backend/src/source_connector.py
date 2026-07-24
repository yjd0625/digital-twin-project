"""与数据源（Source）的 Socket 通信：后端作为 TCP 客户端连接到数据源连接器。

数据源默认是 Python 实时仿真器（connectors/sources/python_realtime.py），
也可以是任意实现了连接器协议的服务（TCP 服务端，监听 SOURCE_PORT）。

注意：这是单向读取通道。原 PlantSimulation 的「指令回写」(send) 已随
「断开 Plant 实时架构」一并移除——实时环只剩 数据源 -> 后端 一条路。
后续若需把推演场景参数发往分析外挂（如 Plant Simulation 做预测/推演），
走独立异步通道 source/prediction（待开发），不经过这里。
"""
import socket
import logging

from .config import SOURCE_HOST, SOURCE_PORT, SOURCE_BUFFER_SIZE, DATA_ENCODING

logger = logging.getLogger(__name__)


class SourceClient:
    """管理到数据源的 TCP 持久连接（后端为客户端）"""

    def __init__(self):
        self.sock: socket.socket | None = None
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected and self.sock is not None

    def connect(self) -> socket.socket:
        """建立 TCP 连接，返回 socket 对象"""
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.settimeout(5.0)  # 设置超时，避免 recv 永久阻塞
        self.sock.connect((SOURCE_HOST, SOURCE_PORT))
        self._connected = True
        logger.info("Connected to data source at %s:%s", SOURCE_HOST, SOURCE_PORT)
        return self.sock

    def recv(self, bufsize: int | None = None) -> bytes:
        """从数据源接收原始字节（阻塞调用，应在 executor 中执行）"""
        if not self.is_connected:
            raise ConnectionError("Data source socket is not connected")
        return self.sock.recv(bufsize or SOURCE_BUFFER_SIZE)

    def close(self) -> None:
        """关闭连接"""
        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass
        self.sock = None
        self._connected = False
        logger.info("Data source connection closed")
