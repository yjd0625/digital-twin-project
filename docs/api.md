
## WebSocket 接口

**地址**: ws://localhost:8765

### 后端 -> 前端（数据推送）

```json
{
  "value": "machine_01,TEMP,85.2",
  "device": "machine_01",
  "metric": "TEMP"
}
```

### 前端 -> 后端（指令发送）

| 指令 | 说明 |
|------|------|
| START | 启动仿真 |
| STOP | 暂停仿真 |
| SPEED:20 | 设置仿真倍速 |

## HTTP API（FastAPI 可选）

**地址**: http://localhost:8000

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | / | 健康检查 |

## TCP Socket（PlantSimulation 通信）

**地址**: 127.0.0.1:30000

数据格式：CSV 或 JSON 字符串，以换行符分隔。
