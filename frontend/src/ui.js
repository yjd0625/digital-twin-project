/**
 * UI 控制（按钮、信息面板）
 */

export function setupUI(controls, sendCommand) {
  const infoDiv = document.getElementById('info');

  function updateInfo(text, bg = 'rgba(0,0,0,0.7)') {
    if (infoDiv) {
      infoDiv.textContent = text;
      infoDiv.style.background = bg;
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

  return { updateInfo };
}
