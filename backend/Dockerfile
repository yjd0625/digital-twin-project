# 数字孪生后端 — 开发镜像（含热重载）
FROM python:3.12-slim

WORKDIR /app

# 避免 Python 输出缓冲，方便看日志；pip 不写缓存层
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# 先装依赖（利用镜像层缓存：依赖不变就不重装）
COPY requirements.txt ./
RUN pip install -r requirements.txt

# 再拷源码（源码常改，放在依赖之后）
COPY src/ ./src/

EXPOSE 8300

# 用 uvicorn 直接跑包入口；--reload 监听挂载的源码实现热重载
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8300", "--reload"]
