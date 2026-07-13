/**
 * UI 控制（按钮、信息面板）
 */

export function setupUI(controls, sendCommand, extra) {
  const infoDiv = document.getElementById('info');

  function updateInfo(text, bg = 'rgba(0,0,0,0.7)') {
    if (infoDiv) {
      infoDiv.textContent = text;
      infoDiv.style.background = bg;
    }
  }

  // 线速度独立标签（不覆盖连接状态）
  const speedDiv = document.getElementById('speed-info');
  function updateSpeed(text, bg = 'rgba(0,0,0,0.7)') {
    if (speedDiv) {
      speedDiv.textContent = text;
      speedDiv.style.background = bg;
    }
  }

  // 控制按钮
  document.getElementById('btn-start')?.addEventListener('click', () => {
    sendCommand('START');
    console.log('Sent: START');
  });
  document.getElementById('btn-stop')?.addEventListener('click', () => {
    sendCommand('STOP');
    console.log('Sent: STOP');
  });
  document.getElementById('btn-speed')?.addEventListener('click', () => {
    sendCommand('SPEED:20');
    console.log('Sent: SPEED:20');
  });

  // view buttons
  document.getElementById("btn-top")?.addEventListener("click", () => extra?.onView?.("top"));
  document.getElementById("btn-front")?.addEventListener("click", () => extra?.onView?.("front"));
  document.getElementById("btn-side")?.addEventListener("click", () => extra?.onView?.("side"));
  document.getElementById("btn-default")?.addEventListener("click", () => extra?.onView?.("default"));
  // 复位按钮
  document.getElementById("btn-reset")?.addEventListener("click", () => extra?.onReset?.());
  // 标签显隐切换
  document.getElementById("btn-labels")?.addEventListener("click", () => extra?.onToggleLabels?.());

  return { updateInfo, updateSpeed };
}