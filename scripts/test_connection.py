"""
连接测试脚本
用法: python scripts/test_connection.py [--plant] [--ws]

测试项:
  --plant  测试与 PlantSimulation 的 TCP 连接
  --ws     测试 WebSocket 服务器是否在线
"""
import argparse
import socket
import json

PLANT_HOST = "127.0.0.1"
PLANT_PORT = 30000
WS_HOST = "localhost"
WS_PORT = 8765


def test_plant():
    print(f"Testing PlantSimulation TCP connection ({PLANT_HOST}:{PLANT_PORT})...")
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect((PLANT_HOST, PLANT_PORT))
        print("  ✅ TCP connection successful")
        sock.close()
    except Exception as e:
        print(f"  ❌ Connection failed: {e}")


def test_ws():
    print(f"Testing WebSocket server ({WS_HOST}:{WS_PORT})...")
    try:
        import asyncio
        import websockets

        async def ping():
            async with websockets.connect(f"ws://{WS_HOST}:{WS_PORT}") as ws:
                await ws.send("PING")
                print("  ✅ WebSocket connected and sent test message")

        asyncio.run(ping())
    except ImportError:
        print("  ⚠️  websockets library not installed, skipping WS test")
    except Exception as e:
        print(f"  ❌ WebSocket test failed: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--plant", action="store_true", help="Test TCP connection to PlantSimulation")
    parser.add_argument("--ws", action="store_true", help="Test WebSocket server")
    args = parser.parse_args()

    if not args.plant and not args.ws:
        args.plant = args.ws = True

    if args.plant:
        test_plant()
    if args.ws:
        test_ws()
