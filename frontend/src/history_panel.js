/**
 * 历史数据面板：从后端 /api/history 读取 InfluxDB 时序并画折线图（vanilla，零依赖）
 *
 * 用法：
 *   initHistoryPanel({ getDevices, apiBase })
 *     getDevices() -> [{ id, parts: [partName,...] }]  （通常来自 allModelInstances 的 userData）
 *     apiBase      -> 后端 REST 基址，如 http://localhost:8300
 *
 * 设备/零件下拉直接读当前 3D 场景里加载的模型，避免和后端 station_id 漂移。
 * 图表用内联 SVG 手绘（零依赖、零构建风险）；若将来迁 Vue，本模块可原样改成 HistoryPanel.vue。
 */
const FIELDS = [
  ["temp", "温度"],
  ["pos_x", "位置 X"], ["pos_y", "位置 Y"], ["pos_z", "位置 Z"],
  ["rot_x", "旋转 X"], ["rot_y", "旋转 Y"], ["rot_z", "旋转 Z"],
  ["scale_x", "缩放 X"], ["scale_y", "缩放 Y"], ["scale_z", "缩放 Z"],
  ["simulationTime", "仿真时刻"],
  ["simulate_speed", "仿真倍速"],
];
const RANGES = [
  ["15m", "15 分钟"], ["1h", "1 小时"], ["6h", "6 小时"],
  ["24h", "24 小时"], ["7d", "7 天"],
];

const SEL_CSS = "width:100%;padding:5px;border-radius:5px;border:1px solid #444;background:#2a2d35;color:#eee;font-size:12px;";
const BTN_CSS = "padding:6px 14px;border:none;border-radius:5px;background:#2196F3;color:#fff;font-weight:bold;cursor:pointer;font-size:12px;";

export function initHistoryPanel({ getDevices, apiBase }) {
  // ---- 创建面板 DOM ----
  const panel = document.createElement("div");
  panel.id = "history-panel";
  panel.style.cssText =
    "position:absolute;top:0;right:0;height:100%;width:380px;max-width:90vw;" +
    "background:rgba(20,22,28,0.94);color:#e8e8e8;font-family:Arial,sans-serif;" +
    "box-shadow:-4px 0 18px rgba(0,0,0,0.5);z-index:200;transform:translateX(100%);" +
    "transition:transform 0.25s ease;display:flex;flex-direction:column;padding:14px 16px;" +
    "box-sizing:border-box;overflow-y:auto;";
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <strong style="font-size:15px;">📈 历史数据 (InfluxDB)</strong>
      <button id="hp-close" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
      <label>设备 <select id="hp-device"></select></label>
      <label>零件 <select id="hp-part"></select></label>
      <label>字段 <select id="hp-field"></select></label>
      <label>时间范围 <select id="hp-range"></select></label>
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
        <button id="hp-refresh">刷新</button>
        <label style="display:flex;gap:4px;align-items:center;color:#bbb;">
          <input type="checkbox" id="hp-auto"> 自动 (10s)
        </label>
      </div>
    </div>
    <div id="hp-status" style="margin:8px 0;font-size:12px;color:#9ad;min-height:16px;"></div>
    <div id="hp-chart" style="flex:1;min-height:200px;background:rgba(0,0,0,0.25);border-radius:6px;"></div>
  `;
  document.body.appendChild(panel);

  panel.querySelectorAll("select").forEach((s) => (s.style.cssText = SEL_CSS));
  panel.querySelector("#hp-refresh").style.cssText = BTN_CSS;
  panel.querySelectorAll("label").forEach((l) => {
    l.style.display = "flex";
    l.style.flexDirection = "column";
    l.style.gap = "3px";
  });

  const elDevice = panel.querySelector("#hp-device");
  const elPart = panel.querySelector("#hp-part");
  const elField = panel.querySelector("#hp-field");
  const elRange = panel.querySelector("#hp-range");
  const elStatus = panel.querySelector("#hp-status");
  const elChart = panel.querySelector("#hp-chart");

  FIELDS.forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = t; elField.appendChild(o);
  });
  RANGES.forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = t; elRange.appendChild(o);
  });
  elField.value = "temp";
  elRange.value = "1h";

  // ---- 开关 ----
  const toggleBtn = document.getElementById("btn-history");
  let open = false;
  const setOpen = (v) => {
    open = v;
    panel.style.transform = v ? "translateX(0)" : "translateX(100%)";
  };
  toggleBtn?.addEventListener("click", () => {
    const next = !open;
    setOpen(next);
    if (next) populateDevices();   // 打开时同步最新设备列表
  });
  panel.querySelector("#hp-close").addEventListener("click", () => setOpen(false));

  // ---- 设备 / 零件联动 ----
  function populateDevices() {
    const devs = getDevices ? getDevices() : [];
    elDevice.innerHTML = "";
    if (!devs.length) {
      const o = document.createElement("option");
      o.textContent = "(无设备)"; elDevice.appendChild(o);
      renderEmpty(); return;
    }
    devs.forEach((d) => {
      const o = document.createElement("option");
      o.value = d.id; o.textContent = d.id; elDevice.appendChild(o);
    });
    onDeviceChange();
  }
  function onDeviceChange() {
    const id = elDevice.value;
    const dev = (getDevices() || []).find((d) => d.id === id);
    const parts = (dev && dev.parts) || [];
    elPart.innerHTML = "";
    if (!parts.length) {
      const o = document.createElement("option");
      o.value = ""; o.textContent = "(无零件)"; o.disabled = true; elPart.appendChild(o);
    } else {
      parts.forEach((p) => {
        const o = document.createElement("option");
        o.value = p; o.textContent = p; elPart.appendChild(o);
      });
    }
    refresh();
  }
  elDevice.addEventListener("change", onDeviceChange);
  elPart.addEventListener("change", refresh);
  elField.addEventListener("change", refresh);
  elRange.addEventListener("change", refresh);
  panel.querySelector("#hp-refresh").addEventListener("click", refresh);

  let autoTimer = null;
  panel.querySelector("#hp-auto").addEventListener("change", (e) => {
    if (e.target.checked) autoTimer = setInterval(refresh, 10000);
    else if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  });

  // ---- 拉取数据 ----
  async function refresh() {
    const device = elDevice.value;
    const part = elPart.value;
    if (!device || !part) {
      renderStatus("该设备无零件数据"); renderEmpty(); return;
    }
    const url =
      `${apiBase}/api/history?device=${encodeURIComponent(device)}` +
      `&part=${encodeURIComponent(part)}&field=${encodeURIComponent(elField.value)}` +
      `&range=${encodeURIComponent(elRange.value)}`;
    renderStatus("查询中...");
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        renderStatus("⚠️ " + (data.error || ("HTTP " + res.status)));
        renderEmpty();
        return;
      }
      renderStatus(`共 ${data.count} 点 · ${device} / ${part} / ${elField.value}`);
      renderChart(data.points);
    } catch (e) {
      renderStatus("⚠️ 请求失败：" + e.message);
      renderEmpty();
    }
  }

  // ---- SVG 折线图（零依赖，按容器实际像素绘制，不变形）----
  let lastPoints = null;
  function renderEmpty() {
    elChart.innerHTML =
      `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:13px;">暂无数据</div>`;
  }
  function renderStatus(t) { elStatus.textContent = t; }

  function renderChart(points) {
    lastPoints = points || null;
    if (!points || !points.length) { renderEmpty(); return; }
    const W = Math.max(elChart.clientWidth || 348, 200);
    const H = Math.max(elChart.clientHeight || 240, 160);
    const padL = 46, padR = 14, padT = 14, padB = 28;
    const vals = points.map((p) => p.value);
    let vmin = Math.min(...vals), vmax = Math.max(...vals);
    if (vmin === vmax) { vmin -= 1; vmax += 1; }
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const xOf = (i) => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const yOf = (v) => padT + (1 - (v - vmin) / (vmax - vmin)) * plotH;
    const pts = points.map((p, i) => [xOf(i), yOf(p.value)]);
    const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const area = `${line} L ${xOf(points.length - 1).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${xOf(0).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;
    const fmtT = (t) => {
      const d = new Date(t);
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    };
    const gridY = [0, 0.5, 1].map((f) => {
      const v = vmin + (vmax - vmin) * f;
      const y = padT + (1 - f) * plotH;
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#333" stroke-width="1"/>` +
        `<text x="${padL - 6}" y="${(y + 4).toFixed(1)}" fill="#9aa" font-size="10" text-anchor="end">${v.toFixed(1)}</text>`;
    }).join("");
    elChart.innerHTML =
      `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;">` +
      `<defs><linearGradient id="hpGrad" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#2196F3" stop-opacity="0.35"/>` +
      `<stop offset="100%" stop-color="#2196F3" stop-opacity="0"/></linearGradient></defs>` +
      gridY +
      `<path d="${area}" fill="url(#hpGrad)"/>` +
      `<path d="${line}" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-linejoin="round"/>` +
      `<text x="${padL}" y="${H - 8}" fill="#9aa" font-size="10">${fmtT(new Date(points[0].time).getTime())}</text>` +
      `<text x="${W - padR}" y="${H - 8}" fill="#9aa" font-size="10" text-anchor="end">${fmtT(new Date(points[points.length - 1].time).getTime())}</text>` +
      `</svg>`;
  }

  // 容器尺寸变化时按实际像素重绘（避免文字被拉伸变形）
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => { if (lastPoints) renderChart(lastPoints); }).observe(elChart);
  }

  populateDevices();
  return { refresh, open: () => setOpen(true), close: () => setOpen(false) };
}
