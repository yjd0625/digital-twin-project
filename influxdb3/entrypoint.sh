#!/bin/sh
set -e

# InfluxDB 3 Core 不会用 INFLUXDB3_AUTH_TOKEN 环境变量来预设 serve 的 admin token
# （该变量仅用于 CLI 客户端认证）。必须通过 --admin-token-file 提供离线 token 文件。
# 这里从环境变量动态生成该文件，使服务端 token 始终与 .env 中的 INFLUXDB3_AUTH_TOKEN 一致，
# 从而 InfluxDB / Explorer / backend 三端 token 完全统一，避免 INVALID_TOKEN_CORE。
# 注意：不能用 /run/secrets（容器里通常只读、且 influxdb3 镜像以非 root 运行会 Permission denied），
# 改用任何用户都可写的 /tmp。
TOKEN_FILE=/tmp/influxdb3-admin-token.json
mkdir -p "$(dirname "$TOKEN_FILE")"
cat > "$TOKEN_FILE" <<EOF
{"token":"${INFLUXDB3_AUTH_TOKEN}","name":"_admin"}
EOF

exec influxdb3 serve \
  --node-id="${NODE_ID:-digital-twin-node-0}" \
  --object-store=file \
  --data-dir=/var/lib/influxdb3/data \
  --plugin-dir=/var/lib/influxdb3/plugins \
  --http-bind=0.0.0.0:18080 \
  --admin-token-file="$TOKEN_FILE"
