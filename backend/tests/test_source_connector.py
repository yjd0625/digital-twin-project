"""SourceClient 单元测试（mock 层，不依赖真实数据源）"""
import unittest
from unittest.mock import patch, MagicMock

import sys
sys.path.insert(0, "..")

from backend.src.source_connector import SourceClient


class TestSourceClient(unittest.TestCase):

    @patch("backend.src.source_connector.socket.socket")
    def test_connect(self, mock_socket_cls):
        mock_sock = MagicMock()
        mock_socket_cls.return_value = mock_sock

        conn = SourceClient()
        conn.connect()

        mock_sock.connect.assert_called_once()
        self.assertTrue(conn.is_connected)

    @patch("backend.src.source_connector.socket.socket")
    def test_close(self, mock_socket_cls):
        mock_sock = MagicMock()
        mock_socket_cls.return_value = mock_sock

        conn = SourceClient()
        conn.connect()
        conn.close()

        self.assertFalse(conn.is_connected)
        mock_sock.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
