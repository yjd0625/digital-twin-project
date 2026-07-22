"""PlantConnector 单元测试（mock 层，不依赖真实 PlantSimulation）"""
import unittest
from unittest.mock import patch, MagicMock

import sys
sys.path.insert(0, "..")

from backend.src.plant_connector import PlantConnector


class TestPlantConnector(unittest.TestCase):

    @patch("backend.src.plant_connector.socket.socket")
    def test_connect(self, mock_socket_cls):
        mock_sock = MagicMock()
        mock_socket_cls.return_value = mock_sock

        conn = PlantConnector()
        conn.connect()

        mock_sock.connect.assert_called_once()
        self.assertTrue(conn.is_connected)

    @patch("backend.src.plant_connector.socket.socket")
    def test_send(self, mock_socket_cls):
        mock_sock = MagicMock()
        mock_socket_cls.return_value = mock_sock

        conn = PlantConnector()
        conn.connect()
        conn.send("TEST_CMD")

        mock_sock.send.assert_called_once_with(b"TEST_CMD")

    @patch("backend.src.plant_connector.socket.socket")
    def test_close(self, mock_socket_cls):
        mock_sock = MagicMock()
        mock_socket_cls.return_value = mock_sock

        conn = PlantConnector()
        conn.connect()
        conn.close()

        self.assertFalse(conn.is_connected)
        mock_sock.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
