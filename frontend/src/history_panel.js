/**
 * 历史数据面板 / 场景绑定看板：从后端 /api/history 读取 InfluxDB 时序并画折线图（vanilla，零依赖）
 *
 * 用法：
 *   initHistoryPanel({ getDevices, apiBase, getSelectedDevice })
 *     getDevices()       -> [{ id, parts: [partName,...] }]  （通常来自 allModelInstances 的 userData）
 *     apiBase            -> 后端 REST 基址，如 http://localhost:8300
 *     getSelectedDevice()-> 当前 3D 选中的模型 {id, parts} 或 null（供「绑定选中设备」用）
 *
 * 特性：
 *  - 顶部「聚焦查询」：单选设备/零件/字段/时间范围，画一张主图（兼容旧行为）。
 *  - 「绑定选中设备」：一键把当前 3D 选中的孪生体 id 填入设备下拉，证明面板数据绑定到具体孪生体。
 *  - 「＋ 加入看板」：把当前选择快照成一张卡片，看板区可并排多张（如某设备 temp + pos_x 同屏），
 *    各自独立 fetch + 独立 SVG 图，演示「scene-bound dashboard」（对标中台 GoView 但零重依赖）。
 * 图表用内联 SVG 手绘（零依赖、零构建风险）；若将来迁 Vue，本模块可原样改成 Dashboard.vue。
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
const BTN2_CSS = "padding:6px 10px;border:none;border-radius:5px;background:#3a6ea5;color:#fff;cursor:pointer;font-size:12px;";
const BTN3_CSS = "padding:6px 10px;border:none;border-radius:5px;background:#555;color:#fff;cursor:pointer;font-size:12px;";

export function initHistoryPanel({ getDevices, apiBase, getSelectedDevice }) {
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
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <strong style="font-size:15px;">📈 历史数据看板 (InfluxDB)</strong>
      <button id="hp-close" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
      <label>设备 <select id="hp-device"></select></label>
      <label>零件 <select id="hp-part"></select></label>
      <label>字段 <select id="hp-field"></select></label>
      <label>时间范围 <select id="hp-range"></select></label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:2px;">
        <button id="hp-refresh">刷新</button>
        <label style="display:flex;gap:4px;align-items:center;color:#bbb;">
          <input type="checkbox" id="hp-auto"> 自动 (10s)
        </label>
        <button id="hp-bind" title="把当前 3D 选中的模型填入设备">📌 绑定选中设备</button>
        <button id="hp-add" title="把当前选择加入下方看板">＋ 加入看板</button>
      </div>
    </div>
    <div id="hp-status" style="margin:8px 0;font-size:12px;color:#9ad;min-height:16px;"></div>
    <div id="hp-chart" style="flex:1;min-height:200px;background:rgba(0,0,0,0.25);border-radius:6px;"></div>
    <div style="margin:14px 0 6px;font-size:12px;color:#bbb;font-weight:bold;">看板（多孪生体并排）</div>
    <div id="hp-cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;"></div>
  `;
  document.body.appendChild(panel);

  panel.querySelectorAll("select").forEach((s) => (s.style.cssText = SEL_CSS));
  panel.querySelector("#hp-refresh").style.cssText = BTN_CSS;
  panel.querySelector("#hp-bind").style.cssText = BTN2_CSS;
  panel.querySelector("#hp-add").style.cssText = BTN3_CSS;
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
  const elCards = panel.querySelector("#hp-cards");

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

  // 看板卡片模型：{ device, part, field, range, _points }
  const cards = [];

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
      renderStatus("场景尚未加载设备"); renderEmpty(elChart); return;
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
  elRange.addEventListener("change", () => { refresh(); refreshCards(); });
  panel.querySelector("#hp-refresh").addEventListener("click", () => { refresh(); refreshCards(); });
  panel.querySelector("#hp-bind").addEventListener("click", onBindSelected);
  panel.querySelector("#hp-add").addEventListener("click", onAddCard);

  // 「绑定选中设备」：读当前 3D 选中模型，填入设备下拉
  function onBindSelected() {
    const dev = getSelectedDevice && getSelectedDevice();
    if (!dev) { renderStatus("⚠️ 请先在 3D 场景中选中一个模型"); return; }
    if (Array.from(elDevice.options).some((o) => o.value === dev.id)) {
      elDevice.value = dev.id;
      onDeviceChange();
      renderStatus("已绑定选中设备：" + dev.id);
    } else {
      renderStatus("⚠️ 选中设备不在列表：" + dev.id);
    }
  }

  // ---- 看板卡片 ----
  function onAddCard() {
    const device = elDevice.value;
    const part = elPart.value;
    if (!device || !part) { renderStatus("⚠️ 该设备无零件，无法加入看板"); return; }
    cards.push({ device, part, field: elField.value, range: elRange.value, _points: null });
    renderCards();
  }
  function renderCards() {
    // 清理所有卡片的旧 ResizeObserver（DOM 即将整体重建，避免观察器持有已移除节点的引用）
    cards.forEach(function(c) { if (c._ro) { c._ro.disconnect(); c._ro = null; } });
    elCards.innerHTML = "";
    cards.forEach((card, idx) => {
      const el = document.createElement("div");
      el.className = "hp-card";
      el.style.cssText = "background:rgba(0,0,0,0.25);border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:4px;";
      el.innerHTML =
        `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#9ad;">` +
        `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(card.device)} / ${escapeHtml(card.part)} / ${escapeHtml(card.field)}</span>` +
        `<button data-idx="${idx}" style="background:none;border:none;color:#f88;cursor:pointer;font-size:13px;padding:0 2px;">✕</button>` +
        `</div>` +
        `<div class="hp-card-chart" style="height:120px;"></div>`;
      elCards.appendChild(el);
      const chartEl = el.querySelector(".hp-card-chart");
      el.querySelector("button").addEventListener("click", () => {
        cards.splice(idx, 1);
        renderCards();
      });
      // 尺寸变化时按实际像素重绘（避免文字被拉伸变形）；observer 引用存于 card，删除卡片时随 renderCards 清理
      if (typeof ResizeObserver !== "undefined") {
        card._ro = new ResizeObserver(() => { if (card._points) drawChart(chartEl, card._points); });
        card._ro.observe(chartEl);
      }
      fetchCard(card, chartEl);
    });
  }
  async function fetchCard(card, chartEl) {
    // 卡片级请求序号：仅该卡片最新一次请求生效（防刷新连点时旧结果覆盖新结果）
    const seq = (card._seq = (card._seq || 0) + 1);
    const pts = await fetchPoints(card.device, card.part, card.field, card.range);
    if (seq !== card._seq) return;   // 已有更新的请求，丢弃过期结果
    card._points = pts;
    drawChart(chartEl, pts);
  }
  function refreshCards() {
    Array.from(elCards.children).forEach((el, idx) => {
      const card = cards[idx];
      if (card) fetchCard(card, el.querySelector(".hp-card-chart"));
    });
  }

  // ---- 拉取数据 ----
  // 请求序号令牌：仅最新一次请求的结果生效，防止慢的旧请求晚到覆盖新结果
  let _mainSeq = 0;
  async function refresh() {
    const seq = ++_mainSeq;
    const device = elDevice.value;
    const part = elPart.value;
    if (!device || !part) {
      renderStatus("该设备无零件数据"); renderEmpty(elChart); return;
    }
    renderStatus("查询中...");
    const pts = await fetchPoints(device, part, elField.value, elRange.value);
    if (seq !== _mainSeq) return;   // 已有更新的请求，丢弃本次过期结果
    if (pts === null) { renderEmpty(elChart); return; }
    renderStatus(`聚焦：${device} / ${part} / ${elField.value} · ${pts.length} 点`);
    _mainPoints = pts;
    drawChart(elChart, pts);
  }

  async function fetchPoints(device, part, field, range) {
    const url =
      `${apiBase}/api/history?device=${encodeURIComponent(device)}` +
      `&part=${encodeURIComponent(part)}&field=${encodeURIComponent(field)}` +
      `&range=${encodeURIComponent(range)}`;
    try {
      const res = await fetch(url);
      // 先判 HTTP 状态再解析 JSON（后端可能返回非 JSON 错误页）
      if (!res.ok) {
        let errText = "HTTP " + res.status;
        try { const j = await res.json(); if (j && j.error) errText = j.error; } catch (e) { /* 非 JSON 响应，保留状态码 */ }
        renderStatus("⚠️ " + errText);
        return null;
      }
      const data = await res.json();
      return data.points || [];
    } catch (e) {
      renderStatus("⚠️ 请求失败：" + e.message);
      return null;
    }
  }

  // ---- SVG 折线图（零依赖，按容器实际像素绘制，不变形）----
  function renderEmpty(container) {
    container.innerHTML =
      `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:12px;">暂无数据</div>`;
  }
  function renderStatus(t) { elStatus.textContent = t; }

  // 大数据量抽稀：超过 MAX_POINTS 时均匀采样（保留末点），控制 SVG 节点数与渲染开销
  const MAX_POINTS = 800;
  function decimate(points) {
    if (points.length <= MAX_POINTS) return points;
    const step = points.length / MAX_POINTS;
    const out = [];
    for (let i = 0; i < points.length; i += step) out.push(points[Math.floor(i)]);
    if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
    return out;
  }

  function drawChart(container, points) {
    if (!points || !points.length) { renderEmpty(container); return; }
    points = decimate(points);
    const W = Math.max(container.clientWidth || 160, 120);
    const H = Math.max(container.clientHeight || 160, 100);
    const padL = 46, padR = 14, padT = 14, padB = 28;
    // 循环求 min/max：Math.min(...大数组) 展开实参在数万点时可能栈溢出
    let vmin = Infinity, vmax = -Infinity;
    for (const p of points) {
      const v = p.value;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
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
    container.innerHTML =
      `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;">` +
      `<defs><linearGradient id="hpGrad" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#2196F3" stop-opacity="0.35"/>` +
      `<stop offset="100%" stop-color="#2196F3" stop-opacity="0"/></linearGradient></defs>` +
      gridY +
      `<path d="${area}" fill="url(#hpGrad)"/>` +
      `<path d="${line}" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-linejoin="round"/>` +
      (points.length > 1
        ? `<text x="${padL}" y="${H - 8}" fill="#9aa" font-size="10">${fmtT(new Date(points[0].time).getTime())}</text>` +
          `<text x="${W - padR}" y="${H - 8}" fill="#9aa" font-size="10" text-anchor="end">${fmtT(new Date(points[points.length - 1].time).getTime())}</text>`
        : `<text x="${padL}" y="${H - 8}" fill="#9aa" font-size="10">${fmtT(new Date(points[0].time).getTime())}</text>`) +
      `</svg>`;
  }

  // 主图尺寸变化时按实际像素重绘（面板开合/窗口缩放会改变容器尺寸，导致文字拉伸变形）
  let _mainPoints = null;   // 最近一次主图数据，供 ResizeObserver 重绘
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => { if (_mainPoints && _mainPoints.length) drawChart(elChart, _mainPoints); }).observe(elChart);
  }

  let autoTimer = null;
  const AUTO_REFRESH_MS = 10000;   // 自动刷新周期（10s）
  panel.querySelector("#hp-auto").addEventListener("change", (e) => {
    if (e.target.checked) autoTimer = setInterval(() => { refresh(); refreshCards(); }, AUTO_REFRESH_MS);
    else if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  });

  // 简单 HTML 转义（设备/零件名可能含 # 等）
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  populateDevices();
  return { refresh, open: () => setOpen(true), close: () => setOpen(false) };
}
