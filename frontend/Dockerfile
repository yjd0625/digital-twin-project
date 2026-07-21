# 数字孪生前端 — 开发镜像（Vite dev + HMR）
FROM node:22-alpine

WORKDIR /app

# 先装依赖（利用镜像层缓存）
COPY package.json package-lock.json ./
RUN npm ci

EXPOSE 5173

# --host 0.0.0.0 让容器外（宿主浏览器）可访问；端口由 compose 映射
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
