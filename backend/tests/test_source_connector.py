"""SourceClient 单元测试（mock socket，不依赖真实数据源）"""
from unittest.mock import MagicMock, patch

from src.source_connector import SourceClient


@patch("src.source_connector.socket.socket")
def test_connect(mock_socket_cls):
    mock_sock = MagicMock()
    mock_socket_cls.return_value = mock_sock

    conn = SourceClient()
    conn.connect()

    mock_sock.connect.assert_called_once()
    assert conn.is_connected is True


@patch("src.source_connector.socket.socket")
def test_close(mock_socket_cls):
    mock_sock = MagicMock()
    mock_socket_cls.return_value = mock_sock

    conn = SourceClient()
    conn.connect()
    conn.close()

    assert conn.is_connected is False
    mock_sock.close.assert_called_once()


def test_backoff_increases_and_caps():
    conn = SourceClient()
    d1 = conn.next_backoff()  # 第 1 次失败
    d2 = conn.next_backoff()  # 第 2 次失败
    assert d2 > d1
    # 连续多次后封顶 30s（含抖动不超过 33s）
    for _ in range(10):
        d = conn.next_backoff()
    assert d <= 33.0


def test_reset_backoff():
    conn = SourceClient()
    conn.next_backoff()
    conn.next_backoff()
    conn.reset_backoff()
    assert conn._failures == 0
