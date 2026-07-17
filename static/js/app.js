/* SETI@Home Relay — front-end controller */

const $ = (sel) => document.querySelector(sel);

const els = {
  targetSelect: $("#target-select"),
  btnScan: $("#btn-scan"),
  btnStop: $("#btn-stop"),
  btnWu: $("#btn-wu"),
  btnAnalyze: $("#btn-analyze"),
  btnClearLog: $("#btn-clear-log"),
  log: $("#log"),
  candidates: $("#candidates"),
  minScore: $("#min-score"),
  minScoreVal: $("#min-score-val"),
  scanStatus: $("#scan-status"),
  linkStatus: $("#link-status"),
  uptime: $("#uptime"),
  clock: $("#clock"),
  targetName: $(".target-name"),
  tRa: $("#t-ra"),
  tDec: $("#t-dec"),
  tDist: $("#t-dist"),
  spectrum: $("#spectrum"),
  waterfall: $("#waterfall"),
  radar: $("#radar"),
  modal: $("#cand-modal"),
  mTitle: $("#m-title"),
  mBody: $("#m-body"),
};

const state = {
  scanning: false,
  targets: [],
  candidates: [],
  startedAt: Date.now(),
  radarAngle: 0,
  lastSpectrum: [],
  pollTimer: null,
  statsTimer: null,
};

// ── Logging ──────────────────────────────────────────────────

function log(msg, kind = "") {
  const line = document.createElement("div");
  line.className = `line ${kind}`;
  const t = new Date();
  const ts = t.toTimeString().slice(0, 8);
  line.innerHTML = `<time>${ts}</time>${escapeHtml(msg)}`;
  els.log.prepend(line);
  while (els.log.children.length > 80) els.log.lastChild.remove();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ── API helpers ──────────────────────────────────────────────

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  return res.json();
}

// ── Canvas: spectrum ─────────────────────────────────────────

function drawSpectrum(data) {
  const canvas = els.spectrum;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // grid
  ctx.strokeStyle = "rgba(0,180,150,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  if (!data || !data.length) return;
  state.lastSpectrum = data;

  const n = data.length;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(0, 255, 200, 0.85)");
  grad.addColorStop(1, "rgba(0, 100, 180, 0.15)");

  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = h - data[i] * (h - 8) - 4;
    if (i === 0) ctx.lineTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = h - data[i] * (h - 8) - 4;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#00e8c0";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // peak marker
  let peakI = 0;
  for (let i = 1; i < n; i++) if (data[i] > data[peakI]) peakI = i;
  if (data[peakI] > 0.45) {
    const px = (peakI / (n - 1)) * w;
    const py = h - data[peakI] * (h - 8) - 4;
    ctx.strokeStyle = "rgba(255,176,32,0.8)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffb020";
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Canvas: waterfall ────────────────────────────────────────

function drawWaterfall(rows) {
  const canvas = els.waterfall;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#03060c";
  ctx.fillRect(0, 0, w, h);

  if (!rows || !rows.length) return;
  const nRows = rows.length;
  const nCols = rows[0].length;
  const cellH = h / nRows;
  const cellW = w / nCols;

  for (let r = 0; r < nRows; r++) {
    const row = rows[r];
    for (let c = 0; c < nCols; c++) {
      const v = row[c];
      ctx.fillStyle = heatColor(v);
      ctx.fillRect(c * cellW, r * cellH, cellW + 0.5, cellH + 0.5);
    }
  }
}

function heatColor(v) {
  // dark blue → cyan → yellow → white
  const t = Math.max(0, Math.min(1, v));
  let r, g, b;
  if (t < 0.33) {
    const k = t / 0.33;
    r = 0;
    g = Math.floor(40 + 160 * k);
    b = Math.floor(60 + 100 * k);
  } else if (t < 0.66) {
    const k = (t - 0.33) / 0.33;
    r = Math.floor(255 * k);
    g = Math.floor(200 + 55 * k);
    b = Math.floor(160 * (1 - k));
  } else {
    const k = (t - 0.66) / 0.34;
    r = 255;
    g = Math.floor(255);
    b = Math.floor(180 * k);
  }
  return `rgb(${r},${g},${b})`;
}

// ── Canvas: radar ────────────────────────────────────────────

function drawRadar() {
  const canvas = els.radar;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const size = Math.min(canvas.clientWidth, 320);
  canvas.style.height = size + "px";
  if (canvas.width !== Math.floor(size * dpr) || canvas.height !== Math.floor(size * dpr)) {
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 8;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#03060c";
  ctx.beginPath();
  ctx.arc(cx, cy, R + 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0, 200, 160, 0.25)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - R, cy);
  ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R);
  ctx.lineTo(cx, cy + R);
  ctx.stroke();

  // sweep
  if (state.scanning) state.radarAngle = (state.radarAngle + 0.04) % (Math.PI * 2);
  const ang = state.radarAngle;
  const grad = ctx.createConicalGradient
    ? null
    : null;

  // fan
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R, ang - 0.5, ang, false);
  ctx.closePath();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  g.addColorStop(0, "rgba(0,232,192,0.25)");
  g.addColorStop(1, "rgba(0,232,192,0)");
  ctx.fillStyle = g;
  ctx.fill();

  ctx.strokeStyle = "#00e8c0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
  ctx.stroke();

  // blips from candidates
  const cands = state.candidates.slice(0, 12);
  cands.forEach((c, i) => {
    const a = (i / Math.max(cands.length, 1)) * Math.PI * 2 + ang * 0.1;
    const dist = 0.25 + (c.score / 100) * 0.65;
    const x = cx + Math.cos(a) * R * dist;
    const y = cy + Math.sin(a) * R * dist;
    const hot = c.score >= 70;
    ctx.fillStyle = hot ? "#ffb020" : "#00e8c0";
    ctx.globalAlpha = 0.5 + (c.score / 200);
    ctx.beginPath();
    ctx.arc(x, y, hot ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  ctx.strokeStyle = "rgba(0,232,192,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  requestAnimationFrame(drawRadar);
}

// ── UI updates ───────────────────────────────────────────────

function setTargetCard(t) {
  if (!t) {
    els.targetName.textContent = "— sin apuntar —";
    els.tRa.textContent = "—";
    els.tDec.textContent = "—";
    els.tDist.textContent = "—";
    return;
  }
  els.targetName.textContent = t.name;
  els.tRa.textContent = t.ra;
  els.tDec.textContent = t.dec;
  els.tDist.textContent = t.dist_ly != null ? `${t.dist_ly} al` : "—";
}

function renderCandidates() {
  const min = Number(els.minScore.value) || 0;
  els.minScoreVal.textContent = String(min);
  const list = state.candidates.filter((c) => c.score >= min);
  els.candidates.innerHTML = "";
  if (!list.length) {
    els.candidates.innerHTML = `<div class="meta" style="color:var(--muted);padding:0.5rem">Sin candidatos (score ≥ ${min})</div>`;
    return;
  }
  for (const c of list) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cand";
    const scoreClass = c.score >= 70 ? "high" : c.score >= 40 ? "mid" : "low";
    btn.innerHTML = `
      <div class="row">
        <span class="id">${escapeHtml(c.id)}</span>
        <span class="score ${scoreClass}">${c.score.toFixed(1)}</span>
      </div>
      <div class="meta">${escapeHtml(c.classification?.label || c.signal_type)} · ${c.frequency_mhz.toFixed(4)} MHz · SNR ${c.snr_db} dB</div>
      <div class="meta">${escapeHtml(c.target?.name || "")}</div>
    `;
    btn.addEventListener("click", () => openCandidate(c));
    els.candidates.appendChild(btn);
  }
}

function openCandidate(c) {
  els.mTitle.textContent = c.id;
  const hot = c.score >= 70;
  els.mBody.innerHTML = `
    <p>${escapeHtml(c.classification?.desc || "")}</p>
    ${hot ? `<span class="badge">★ Alta prioridad científica (simulada)</span>` : ""}
    <dl>
      <dt>Tipo</dt><dd>${escapeHtml(c.classification?.label || c.signal_type)}</dd>
      <dt>Objetivo</dt><dd>${escapeHtml(c.target?.name || "—")}</dd>
      <dt>Frecuencia</dt><dd>${c.frequency_mhz.toFixed(6)} MHz</dd>
      <dt>SNR</dt><dd>${c.snr_db} dB</dd>
      <dt>Score</dt><dd>${c.score}</dd>
      <dt>Ancho de banda</dt><dd>${c.bandwidth_hz} Hz</dd>
      <dt>Duración</dt><dd>${c.duration_s} s</dd>
      <dt>Drift</dt><dd>${c.drift_hz_s} Hz/s</dd>
      <dt>Work unit</dt><dd>${escapeHtml(c.work_unit_id)}</dd>
      <dt>Notas</dt><dd>${escapeHtml(c.notes || "")}</dd>
    </dl>
  `;
  els.modal.showModal();
}

function updateStats(s) {
  const map = {
    work_units_completed: s.work_units_completed,
    candidates_found: s.candidates_found,
    high_interest: s.high_interest,
    total_cpu_seconds: Number(s.total_cpu_seconds || 0).toFixed(1),
    bytes_mb: ((s.bytes_analyzed || 0) / (1024 * 1024)).toFixed(2),
    scans_run: s.scans_run,
  };
  for (const [k, v] of Object.entries(map)) {
    const el = document.querySelector(`[data-k="${k}"]`);
    if (el) el.textContent = v;
  }
  if (s.current_target) setTargetCard(s.current_target);
  state.scanning = !!s.scanning;
  els.scanStatus.textContent = state.scanning ? "ESCANEANDO" : "IDLE";
  els.scanStatus.classList.toggle("live", state.scanning);
  els.btnScan.disabled = state.scanning;
  els.btnStop.disabled = !state.scanning;
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `UP ${h}:${m}:${sec}`;
}

// ── Actions ──────────────────────────────────────────────────

async function loadTargets() {
  state.targets = await api("/api/targets");
  els.targetSelect.innerHTML = state.targets
    .map((t, i) => `<option value="${i}">${escapeHtml(t.name)}</option>`)
    .join("");
}

async function refreshCandidates() {
  const min = Number(els.minScore.value) || 0;
  state.candidates = await api(`/api/candidates?limit=40&min_score=${min}`);
  renderCandidates();
}

async function refreshStats() {
  try {
    const s = await api("/api/stats");
    updateStats(s);
    els.linkStatus.querySelector("span:last-child").textContent = "ENLACE OK";
  } catch (e) {
    els.linkStatus.querySelector("span:last-child").textContent = "SIN ENLACE";
  }
}

async function tickScan() {
  try {
    const data = await api("/api/scan/tick");
    drawSpectrum(data.spectrum);
    drawWaterfall(data.waterfall);
    if (data.target) setTargetCard(data.target);
    if (data.event) {
      log(
        `⚠ CANDIDATO ${data.event.id} · score ${data.event.score} · ${data.event.classification?.label} @ ${data.event.frequency_mhz} MHz`,
        "event"
      );
      await refreshCandidates();
      await refreshStats();
    }
  } catch (e) {
    log(`Error de telemetría: ${e.message}`, "err");
  }
}

async function startScan() {
  const idx = Number(els.targetSelect.value);
  try {
    const r = await api("/api/scan/start", {
      method: "POST",
      body: JSON.stringify({ target_index: idx }),
    });
    state.scanning = true;
    updateStats({ ...((await api("/api/stats"))), scanning: true, current_target: r.target });
    log(r.message || "Escaneo iniciado", "ok");
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(tickScan, 400);
    tickScan();
  } catch (e) {
    log(`No se pudo iniciar escaneo: ${e.message}`, "err");
  }
}

async function stopScan() {
  try {
    const r = await api("/api/scan/stop", { method: "POST", body: "{}" });
    state.scanning = false;
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    els.scanStatus.textContent = "IDLE";
    els.scanStatus.classList.remove("live");
    els.btnScan.disabled = false;
    els.btnStop.disabled = true;
    log(r.message || "Escaneo detenido", "ok");
  } catch (e) {
    log(`Error al detener: ${e.message}`, "err");
  }
}

async function processWU() {
  els.btnWu.disabled = true;
  log("Procesando work unit…", "ok");
  try {
    const idx = Number(els.targetSelect.value);
    const r = await api("/api/work-units", {
      method: "POST",
      body: JSON.stringify({ target_index: idx }),
    });
    const s = r.summary || {};
    log(
      `WU ${r.work_unit.id} completada · ${s.candidates} candidatos · best ${s.best_score} · CPU ${s.cpu_seconds}s`,
      s.candidates ? "event" : "ok"
    );
    if (r.candidates?.length) {
      for (const c of r.candidates) {
        log(`  → ${c.id} score=${c.score} ${c.classification?.label}`, "event");
      }
    }
    await refreshCandidates();
    await refreshStats();
  } catch (e) {
    log(`Error WU: ${e.message}`, "err");
  } finally {
    els.btnWu.disabled = false;
  }
}

async function analyzeBuffer() {
  // Generate pseudo IQ samples client-side
  const samples = [];
  const n = 512;
  for (let i = 0; i < n; i++) {
    const noise = (Math.random() - 0.5) * 2;
    const tone = Math.sin((i / n) * Math.PI * 2 * 17) * (Math.random() > 0.7 ? 1.8 : 0.2);
    samples.push(noise + tone);
  }
  log("Analizando buffer local de muestras…", "ok");
  try {
    const r = await api("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ samples }),
    });
    drawSpectrum(r.spectrum);
    log(
      `Análisis: peak_bin=${r.peak_bin} SNR≈${r.snr_estimate} ${r.interesting ? "★ INTERESANTE" : "(ruido)"}`,
      r.interesting ? "event" : "ok"
    );
    if (r.candidate) {
      log(`Nuevo candidato ${r.candidate.id} score ${r.candidate.score}`, "event");
      await refreshCandidates();
      await refreshStats();
    }
  } catch (e) {
    log(`Error análisis: ${e.message}`, "err");
  }
}

// ── Boot ─────────────────────────────────────────────────────

function bind() {
  els.btnScan.addEventListener("click", startScan);
  els.btnStop.addEventListener("click", stopScan);
  els.btnWu.addEventListener("click", processWU);
  els.btnAnalyze.addEventListener("click", analyzeBuffer);
  els.btnClearLog.addEventListener("click", () => {
    els.log.innerHTML = "";
  });
  els.minScore.addEventListener("input", () => {
    renderCandidates();
    refreshCandidates();
  });
  els.targetSelect.addEventListener("change", () => {
    const t = state.targets[Number(els.targetSelect.value)];
    if (t && !state.scanning) setTargetCard(t);
  });
  window.addEventListener("resize", () => {
    if (state.lastSpectrum.length) drawSpectrum(state.lastSpectrum);
  });
}

async function boot() {
  bind();
  drawRadar();
  drawSpectrum(Array.from({ length: 256 }, () => Math.random() * 0.2 + 0.1));
  drawWaterfall(
    Array.from({ length: 30 }, () =>
      Array.from({ length: 256 }, () => Math.random() * 0.25)
    )
  );

  try {
    await loadTargets();
    if (state.targets[0]) setTargetCard(state.targets[0]);
    await refreshStats();
    await refreshCandidates();
    // seed one waterfall frame from server
    const tick = await api("/api/scan/tick");
    drawSpectrum(tick.spectrum);
    drawWaterfall(tick.waterfall);
    log("Nodo SETI@Home Relay en línea. Listo para captar señales (simuladas).", "ok");
    log("Consejo: inicia un escaneo o procesa un work unit.", "ok");
  } catch (e) {
    log(`Fallo al conectar con el backend: ${e.message}`, "err");
  }

  state.statsTimer = setInterval(refreshStats, 5000);
  setInterval(() => {
    els.uptime.textContent = formatUptime(Date.now() - state.startedAt);
    els.clock.textContent = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  }, 1000);
}

boot();
