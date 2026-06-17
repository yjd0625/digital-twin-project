"""与 PlantSimulation 的 Socket 通信"""
import socket
import logging

from .config import PLANT_HOST, PLANT_PORT, PLANT_BUFFER_SIZE, DATA_ENCODING

logger = logging.getLogger(__name__)


class PlantConnector:
    """管理到 PlantSimulation 的 TCP 持久连接"""

    def __init__(self):
        self.sock: socket.socket | None = None
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected and self.sock is not None

    def connect(self) -> socket.socket:
        """建立 TCP 连接，返回 socket 对象"""
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.connect((PLANT_HOST, PLANT_PORT))
        self._connected = True
        logger.info("Connected to PlantSimulation at %s:%s", PLANT_HOST, PLANT_PORT)
        return self.sock

    def send(self, command: str) -> None:
        """向 PlantSimulation 发送指令字符串"""
        if not self.is_connected:
            raise ConnectionError("PlantSimulation socket is not connected")
        self.sock.send(command.encode(DATA_ENCODING))
        logger.info("Sent command: %s", command)

    def recv(self, bufsize: int | None = None) -> bytes:
        """从 PlantSimulation 接收原始字节（阻塞调用，应在线程池中执行）"""
        if not self.is_connected:
            raise ConnectionError("PlantSimulation socket is not connected")
        return self.sock.recv(bufsize or PLANT_BUFFER_SIZE)

    def close(self) -> None:
        """关闭连接"""
        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass
        self.sock = None
        self._connected = False
        logger.info("PlantSimulation connection closed")
