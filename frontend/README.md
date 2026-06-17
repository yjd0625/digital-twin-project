# 数字孪生前端

Three.js 3D 可视化前端，通过 WebSocket 接收后端实时数据。

## 目录

| 路径 | 说明 |
|------|------|
| public/models/ | 3D 模型文件(.glb/.gltf) |
| public/textures/ | 纹理贴图 |
| src/main.js | 入口：场景初始化 + WebSocket |
| src/scene.js | 场景配置：灯光、相机、控制器 |
| src/models.js | 模型加载与管理 |
| src/data_handler.js | WebSocket 数据处理 |
| src/ui.js | 按钮、信息面板等 UI 控制 |
| index.html | 页面入口 |

## 开发

```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173

## 构建

```bash
npm run build
npm run preview
```
