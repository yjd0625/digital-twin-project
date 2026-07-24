"""实时演示数据源：模拟产线设备运动与状态，按平台协议推送给后端。

作为「项目主实时数据源」的参考实现（开源、纯标准库），端到端驱动：
    连接器(TCP 服务端) -> 后端(FastAPI) -> Redis/WS -> 前端(Three.js)
                                             -> InfluxDB(旁路写入)

默认驱动前端 loadAllModels() 预载的默认场景（组装工位/搬运机器人/焊接机器人/缓冲区），
因此无需任何前端改动即可测通整条链路。

运行：
    python -m connectors.sources.python_realtime
    （或兼容入口 python scripts/demo_simulator.py）
参数：
    --host/--port  TCP 监听地址（默认 0.0.0.0:30000，后端作为客户端连上来）
    --hz           推送帧率（默认 20）
    --dry-run      仅打印前几帧，不联网
"""
from __future__ import annotations

import argparse
import math
import signal
import time

from ..base import SourceConnector, build_frame

# 默认场景与前端 loadAllModels() 预载模型 id 对齐（label + " #" + 序号）
ASSEMBLE = [f"组装工位 #{i}" for i in range(1, 5)]
TRANSFER = "搬运机器人 #1"
WELD = ["焊接悬挂机器人 #1", "焊接悬挂机器人 #2"]
BUFFERS = [f"缓冲区 #{i}" for i in range(1, 5)]

ACTION_INTERVAL = 4.0  # 每 4s 演示一次 action 动画


class RealtimeSimulator(SourceConnector):
    """用三角函数驱动默认场景各模型的位姿/状态/温度。"""

    def __init__(self, host: str = "0.0.0.0", port: int = 30000, hz: int = 20):
        super().__init__(host, port)
        self.hz = hz
        self._t0 = time.time()
        self._last_action = -10.0
        self._toggle = False

    def tick(self) -> float:
        return 1.0 / self.hz

    # ---- 帧生成（与平台协议对齐）----
    def _make_state(self, t: float) -> dict:
        stations = []
        stations.append({
            "id": TRANSFER, "status": "moving",
            "temp": 28 + 2 * math.sin(t),
            "position": {"x": 15 + 5 * math.sin(t * 0.6)},
        })
        stations.append({
            "id": ASSEMBLE[0], "status": "running",
            "temp": 32 + 3 * math.sin(t),
            "parts": {
                "Clamp": {"position": {"y": 1.0 + 0.8 * math.sin(t * 1.5)}},
                "Bracket": {"rotation": {"y": 0.3 * math.sin(t)}},
            },
        })
        stations.append({
            "id": ASSEMBLE[1], "status": "running",
            "temp": 31 + 2 * math.sin(t + 1),
            "parts": {"PositionPin": {"position": {"x": 0.5 * math.sin(t * 2.0)}}},
        })
        stations.append({"id": ASSEMBLE[2], "status": "welding", "temp": 45 + 4 * math.sin(t)})
        stations.append({"id": ASSEMBLE[3], "status": "idle", "temp": 26})
        stations.append({
            "id": WELD[0], "status": "welding",
            "temp": 48 + 3 * math.sin(t),
            "rotation": {"z": 0.5 * math.sin(t * 0.8)},
        })
        stations.append({"id": WELD[1], "status": "welding", "temp": 47})
        for i, b in enumerate(BUFFERS, start=1):
            stations.append({"id": b, "status": "idle", "temp": 25 + i})
        return {
            "type": "state",
            "timestamp": int(time.time()),
            "simulationTime": round(t, 3),
            "simulateSpeed": 1,
            "stations": stations,
        }

    def _make_action(self, t: float, toggle: bool) -> dict:
        x = 1.0 if toggle else 0.0
        return {
            "type": "action",
            "simulationTime": round(t, 3),
            "commands": [
                {
                    "id": ASSEMBLE[0],
                    "duration": 1.5,
                    "parts": {"LeftSlide": {"position": {"x": x, "duration": 1.5}}},
                }
            ],
        }

    def generate_frame(self):
        t = time.time() - self._t0
        if t - self._last_action >= ACTION_INTERVAL:
            self._last_action = t
            self._toggle = not self._toggle
            return self._make_action(t, self._toggle)
        return self._make_state(t)

    # ---- 自检 ----
    def dry_run(self, seconds: float = 3.0) -> None:
        print("[python_realtime] dry-run：打印前几帧（不联网）")
        t0 = time.time()
        toggle = False
        n = 0
        while time.time() - t0 < seconds:
            t = time.time() - t0
            if n % 40 == 0:
                print(build_frame(self._make_state(t)).decode("utf-8")[:280], "...")
            if n % 80 == 0:
                toggle = not toggle
                print("ACTION:", build_frame(self._make_action(t, toggle)).decode("utf-8")[:200])
            n += 1
            time.sleep(self.tick())
        print(f"[python_realtime] dry-run 结束，约 {n} 帧生成正常")


def main() -> None:
    ap = argparse.ArgumentParser(description="数字孪生演示数据源（项目主实时源，开源参考实现）")
    ap.add_argument("--host", default="0.0.0.0", help="绑定地址（默认 0.0.0.0）")
    ap.add_argument("--port", type=int, default=30000, help="监听端口（默认 30000）")
    ap.add_argument("--hz", type=int, default=20, help="state 推送频率 Hz（默认 20）")
    ap.add_argument("--dry-run", action="store_true", help="不联网，仅打印生成的帧用于自检")
    args = ap.parse_args()

    if args.dry_run:
        RealtimeSimulator(hz=args.hz).dry_run()
        return

    sim = RealtimeSimulator(args.host, args.port, args.hz)

    def _handler(signum, frame):
        print("\n[python_realtime] 收到停止信号，退出...")
        sim.stop()

    signal.signal(signal.SIGINT, _handler)
    signal.signal(signal.SIGTERM, _handler)
    try:
        sim.serve()
    except KeyboardInterrupt:
        sim.stop()


if __name__ == "__main__":
    main()
