/**
 * WebSocket 数据处理与状态更新
 */

export class DataHandler {
  constructor(sceneObjects) {
    this.objects = sceneObjects; // { cube, labelRenderer, scene, camera, ... }
    this.latestData = null;
  }

  /**
   * 处理从后端接收到的 JSON 数据
   */
  process(data) {
    this.latestData = data;
    console.log('📩 Data received:', data);

    if (!this.objects.cube) return;

    const raw = data.value || data.raw || JSON.stringify(data);

    // 根据数据驱动立方体状态
    const val = raw.length / 10;
    this.objects.cube.rotation.x = val;
    this.objects.cube.rotation.y = val * 0.5;

    // 根据数据内容变换颜色
    const hue = (raw.length * 10) % 360 / 360;
    this.objects.cube.material.color.setHSL(hue, 0.8, 0.5);

    return data;
  }

  /**
   * 获取最近一次数据概要
   */
  getSummary() {
    return this.latestData;
  }
}
