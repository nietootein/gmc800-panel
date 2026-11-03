/* Modo profesional: datos, control de actividades, aparato y configuración. */
"use strict";

LANG = "es";
const $ = (id) => document.getElementById(id);
let S = null, status = null, live = [], win = 600, unit = "cps", lastCpmDev = null;

/* ---------------------------------------------------------------- acceso */
async function login(pw) {
  const r = await api("/api/login", { password: pw });
  sessionStorage.setItem(TOKEN_KEY, r.token);
}
async function boot() {
  try {
    await refreshStatus();
    $("login").hidden = true;
    start();
  } catch (e) {
    $("login").hidden = false;
    $("pw").focus();
  }
}
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { await login($("pw").value); boot(); } catch (err) { toast(err.message, true); }
});

/* helper: llamada con aviso de error */
async function act(path, body, okMsg) {
  try {
    const r = await api(path, body);
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    if (e.status === 401) { sessionStorage.removeItem(TOKEN_KEY); $("login").hidden = false; }
    toast(e.message, true);
    throw e;
  }
}

/* ---------------------------------------------------------------- pestañas */
document.querySelectorAll("nav [data-tab]").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("nav [data-tab]").forEach((x) => x.setAttribute("aria-current", String(x === b)));
    document.querySelectorAll("section.tab").forEach((s) => (s.hidden = s.id !== "tab-" + b.dataset.tab));
    if (b.dataset.tab === "config" && !cfg) loadConfig();
    if (b.dataset.tab === "device") refreshStatus();
    drawLive();
  })
);

/* ---------------------------------------------------------------- arranque */
let started = false;
async function start() {
  if (started) return;
  started = true;
  const tok = sessionStorage.getItem(TOKEN_KEY);
  $("dlSeries").href = `/api/pro/series.csv?token=${encodeURIComponent(tok)}`;
  $("dlSession").href = `/api/pro/session.json?token=${encodeURIComponent(tok)}`;
  $("dlHistCsv").href = `/api/pro/history.csv?token=${encodeURIComponent(tok)}`;
  $("dlHistBin").href = `/api/pro/history.bin?token=${encodeURIComponent(tok)}`;
  try { live = await api("/api/series?seconds=3600"); } catch (e) { live = []; }
  await loadState();
  stream({
    tick(d) {
      $("offBadge").hidden = d.connected;
      if (d.cps != null) { live.push([d.t, d.cps]); if (live.length > 3600) live.shift(); }
      $("sCps").textContent = d.cps ?? "–";
      $("sCpm").textContent = fmt(d.cpm, 1);
      $("sUsv").textContent = fmt(d.usvh, 4);
      if (S) Object.assign(S.measure, d.measure);
      if (S && d.version !== S.version) loadState(); else renderMeasure();
      drawLive();
    },
    state() { loadState(); },
  });
  setInterval(refreshStatus, 5000);
}

async function loadState() {
  S = await api("/api/public/state");
  renderActivity();
}

async function refreshStatus() {
  status = await api("/api/pro/status");
  const d = status.device || {};
  $("simBadge").hidden = !status.simulated;
  $("simTabBtn").hidden = !status.simulated;
  $("devLine").textContent = status.connected
    ? `${d.version || "GMC"} · ${d.port || ""} · ${status.clients} pantallas conectadas`
    : `Sin conexión${status.error ? ": " + status.error : ""}`;
  $("sCpmDev").textContent = d.cpm_device ?? "–";
  $("sDose").textContent = fmt(status.dose_usv, 4);
  $("sMax").textContent = d.max_cps ?? "n/d";
  if (document.activeElement !== $("factor")) $("factor").value = status.usv_per_cpm.toPrecision(4);
  const rows = [
    ["Modelo / firmware", d.version], ["Número de serie", d.serial], ["Puerto", d.port],
    ["Fecha y hora del aparato", d.datetime], ["Batería (V)", d.voltage ?? "no disponible en este modelo"], ["Temperatura (°C)", d.temperature ?? "no disponible en este modelo"], ["Segundos perdidos (lecturas fallidas)", d.lost_seconds],
    ["Puertos detectados", (status.ports || []).map((p) => p.device + (p.likely_gq ? " ✓" : "")).join(", ") || "ninguno"],
  ];
  $("infoTable").innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v ?? "–")}</td></tr>`).join("");
  if (status.simulated && !simFilled) fillSim();
  renderJob(status.job);
  return status;
}

/* ---------------------------------------------------------------- gráfica en directo */
const seg = (attr, fn) =>
  document.querySelectorAll(`[data-${attr}]`).forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(`[data-${attr}]`).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      fn(b.dataset[attr]);
    })
  );
seg("win", (v) => { win = +v; drawLive(); });
seg("unit", (v) => { unit = v; drawLive(); });

function drawLive() {
  if ($("tab-live").hidden) return;
  const now = Date.now() / 1000;
  let pts = live.filter((p) => now - p[0] <= win);
  const raw = pts.map((p) => p[1]);
  if (unit !== "cps") {
    const f = unit === "usv" ? (status ? status.usv_per_cpm : 1 / 153.8) : 1;
    pts = pts.map((p, i) => {
      const lo = Math.max(0, i - 59), w = raw.slice(lo, i + 1);
      return [p[0], (w.reduce((a, b) => a + b, 0) * 60 / w.length) * f];
    });
  }
  const { mean, var: v } = meanVar(raw);
  $("winStats").textContent = raw.length
    ? `En la ventana: ${raw.length} s · media ${fmt(mean, 3)} cps · varianza ${fmt(v, 3)} · total ${raw.reduce((a, b) => a + b, 0)} cuentas`
    : "";
  plot($("liveChart"), {
    x: { label: "segundos atrás", min: -win, max: 0 },
    y: { label: { cps: "CPS", cpm: "CPM", usv: "µSv/h" }[unit], min: 0 },
    series: [{ type: "line", points: pts.map((p) => [p[0] - now, p[1]]), color: COLORS[0], width: 1.4 }],
  });
}
window.addEventListener("resize", drawLive);

/* ---------------------------------------------------------------- actividades */
const SRC = Object.keys(I18N.es.src).filter((k) => k !== "none");
const MAT = Object.keys(I18N.es.mat);
const ACT = {
  welcome: { name: "Presentación", help: "Pantalla de bienvenida con la medida en directo. No guarda datos." },
  background: { name: "Fondo", help: "Retira todas las fuentes. Con duración 0 mide hasta que pulses «Parar»; puedes reanudar y se acumula.", dur: 0 },
  compare: { name: "Comparar muestras", sel: SRC, selLabel: "Muestra", help: "Coloca cada muestra en la misma posición y mide el mismo tiempo. Se resta el fondo.", dur: 60 },
  shielding: { name: "Blindaje", sel: MAT, selLabel: "Material", x: "Espesor (mm)", help: "Mide primero sin blindaje (espesor 0); ese punto se usa como referencia para todos los materiales. Después añade láminas.", dur: 60 },
  distance: { name: "Distancia", sel: SRC, selLabel: "Fuente", x: "Distancia (cm)", help: "Mide la distancia desde la fuente hasta el centro del tubo, marcado en la carcasa del GMC-800. Evita distancias muy cortas: el contador puede saturarse.", dur: 60 },
  stats: { name: "Estadística", help: "Usa una fuente débil o el fondo (de 1 a 5 cps es ideal) y mide al menos 5 minutos. Con duración 0, mide hasta que pares.", dur: 0 },
  arrivals: { name: "Tiempos de llegada", help: "El contador solo informa de cuentas por segundo, así que las esperas se miden con resolución de 1 s. Funciona bien entre 0,2 y 1 cps: el fondo o una fuente débil a distancia. Por encima de 2 cps la pantalla avisa. Mide al menos 10 minutos; con duración 0, hasta que pares.", dur: 0 },
};

$("actBtns").innerHTML = Object.entries(ACT).map(([k, a]) => `<button data-act="${k}">${a.name}</button>`).join("");
document.querySelectorAll("[data-act]").forEach((b) =>
  b.addEventListener("click", () => act("/api/pro/activity", { activity: b.dataset.act }))
);
document.querySelectorAll("[data-slang]").forEach((b) =>
  b.addEventListener("click", () => act("/api/pro/screen_lang", { lang: b.dataset.slang }))
);

let builtAct = null;
function renderActivity() {
  if (!S) return;
  const a = S.activity, cfg = ACT[a];
  document.querySelectorAll("[data-act]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.act === a)));
  document.querySelectorAll("[data-slang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.slang === S.screen_lang)));
  $("measurePanel").hidden = a === "welcome";
  $("mTitle").textContent = `Medir: ${cfg.name}`;
  $("mHelp").textContent = cfg.help;
  if (builtAct !== a) {
    builtAct = a;
    $("lblSel").hidden = !cfg.sel;
    $("lblText").hidden = !cfg.sel;
    $("lblX").hidden = !cfg.x;
    if (cfg.x) $("lblXText").textContent = cfg.x;
    $("lblSel").firstChild.textContent = cfg.selLabel || "";
    if (cfg.sel) {
      const names = a === "shielding" ? I18N.es.mat : I18N.es.src;
      $("mSel").innerHTML = cfg.sel.map((k) => `<option value="${k}">${names[k]}</option>`).join("");
    }
    $("mDur").value = cfg.dur ?? 60;
    $("mX").value = a === "shielding" ? 0 : a === "distance" ? 5 : "";
  }
  const bg = S.background_rate;
  $("bgNow").textContent = `Fondo actual: ${fmtErr(bg.value, bg.err)} cps (${{ manual: "manual", measured: "medido", default: "valor típico, aún sin medir" }[bg.source]})`;
  renderPoints();
  renderMeasure();
}

function renderMeasure() {
  if (!S) return;
  const m = S.measure, running = m.running;
  $("mStart").disabled = running;
  $("mStop").disabled = !running;
  $("mStatus").textContent = running
    ? `Midiendo${m.label ? " «" + labelOf(m.label) + "»" : ""}: ${m.elapsed}${m.duration ? " / " + m.duration : ""} s · ${m.counts} cuentas`
    : "";
  $("mBar").style.width = running ? (m.duration ? `${(100 * m.elapsed) / m.duration}%` : "100%") : "0";
}

function labelOf(k) { return I18N.es.src[k] || I18N.es.mat[k] || k; }

function renderPoints() {
  const a = S.activity, tb = $("pointsTable"), bg = S.background_rate;
  if (a === "background" || a === "stats" || a === "arrivals") {
    const s = S.data[a].samples, n = s.reduce((x, y) => x + y, 0);
    const { mean, var: v } = meanVar(s);
    tb.innerHTML = s.length
      ? `<tr><th>Segundos</th><th>Cuentas</th><th>Media (cps)</th><th>Varianza</th><th>Varianza/media</th></tr>
         <tr class="num"><td>${s.length}</td><td>${n}</td><td>${fmtErr(mean, Math.sqrt(Math.max(n, 1)) / s.length)}</td><td>${fmt(v, 3)}</td><td>${fmt(v / mean, 3)}</td></tr>`
      : "<tr><td>Aún no hay datos.</td></tr>";
    return;
  }
  if (!S.data[a] || !S.data[a].points) { tb.innerHTML = ""; return; }
  const pts = S.data[a].points;
  const xh = ACT[a].x ? `<th>${ACT[a].x}</th>` : "";
  tb.innerHTML = pts.length
    ? `<tr><th>#</th><th>${ACT[a].selLabel}</th>${xh}<th>Cuentas</th><th>Tiempo (s)</th><th>Tasa (cps)</th><th>Neta (cps)</th><th></th></tr>` +
      pts.map((p, i) => {
        const n = netRate(p, bg);
        return `<tr class="num"><td>${i + 1}</td><td>${esc(labelOf(p.label))}</td>${ACT[a].x ? `<td>${p.x ?? "–"}</td>` : ""}
          <td>${p.counts}</td><td>${p.seconds}</td><td>${fmtErr(p.counts / p.seconds, Math.sqrt(Math.max(p.counts, 1)) / p.seconds)}</td>
          <td>${fmtErr(n.r, n.e)}</td><td><button class="danger" data-del="${i}" aria-label="Borrar punto ${i + 1}">Borrar</button></td></tr>`;
      }).join("")
    : "<tr><td>Aún no hay medidas. Pulsa «Empezar medida».</td></tr>";
  tb.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => act("/api/pro/point/delete", { activity: a, index: +b.dataset.del }))
  );
}

$("mStart").addEventListener("click", () => {
  const a = S.activity, cfg = ACT[a];
  const label = cfg.sel ? ($("mText").value.trim() || $("mSel").value) : "";
  const x = cfg.x ? $("mX").value : null;
  if (cfg.x && (x === "" || isNaN(+x))) return toast(`Indica ${cfg.x.toLowerCase()}`, true);
  act("/api/pro/measure/start", { label, x, duration: +$("mDur").value || 0 });
});
$("mStop").addEventListener("click", () => act("/api/pro/measure/stop", {}));
$("mReset").addEventListener("click", () => {
  if (confirm(`¿Borrar todos los datos de «${ACT[S.activity].name}»?`))
    act("/api/pro/activity/reset", { activity: S.activity }, "Datos borrados");
});
$("bgSet").addEventListener("click", () => act("/api/pro/background/manual", { value: $("bgManual").value }, "Fondo fijado"));
$("bgAuto").addEventListener("click", () => { $("bgManual").value = ""; act("/api/pro/background/manual", { value: null }, "Se usará el fondo medido"); });

/* ---------------------------------------------------------------- aparato */
$("syncTime").addEventListener("click", () => act("/api/pro/device/datetime", {}, "Hora sincronizada").then(refreshStatus));
$("refreshInfo").addEventListener("click", refreshStatus);
document.querySelectorAll("[data-key]").forEach((b) =>
  b.addEventListener("click", () => act("/api/pro/device/key", { key: +b.dataset.key }))
);
$("pwrOn").addEventListener("click", () => act("/api/pro/device/poweron", {}, "Orden de encendido enviada"));
$("pwrOff").addEventListener("click", () => confirm("¿Apagar el contador?") && act("/api/pro/device/poweroff", {}, "Orden de apagado enviada"));
$("reboot").addEventListener("click", () => confirm("¿Reiniciar el contador?") && act("/api/pro/device/reboot", {}, "Reiniciando"));
$("setFactor").addEventListener("click", () => act("/api/pro/settings", { usv_per_cpm: +$("factor").value }, "Factor guardado"));
$("resetDose").addEventListener("click", () => act("/api/pro/settings", { reset_dose: true }, "Dosis a cero").then(refreshStatus));
$("factoryReset").addEventListener("click", () =>
  act("/api/pro/device/factory_reset", { confirm: $("frConfirm").value }).then((r) => toast(`Restablecido. Copia: ${r.backup}`))
);
$("histStart").addEventListener("click", () => act("/api/pro/history/start", {}).then(pollJob));

let jobTimer = null;
function pollJob() {
  clearTimeout(jobTimer);
  api("/api/pro/job").then((j) => {
    renderJob(j);
    if (!j.done) jobTimer = setTimeout(pollJob, 700);
    else if (j.error) toast(j.error, true);
    else if (j.name === "history") toast(`Historial leído: ${j.result ? j.result.bytes.toLocaleString("es-ES") : 0} bytes`);
    else if (j.name === "config_write" || j.name === "config_restore") { toast("Configuración escrita"); pending = {}; loadConfig(); }
  });
}
function renderJob(j) {
  if (!j) return;
  const bar = j.name === "history" ? $("histBar") : $("cfgBar");
  bar.style.width = `${(j.progress || 0) * 100}%`;
  const histReady = j.name === "history" && j.done && !j.error;
  $("dlHistCsv").hidden = $("dlHistBin").hidden = !histReady;
}

/* ---------------------------------------------------------------- configuración */
let cfg = null, pending = {};
async function loadConfig() {
  try {
    cfg = await act("/api/pro/config");
  } catch (e) { return; }
  $("cfgFields").innerHTML = `<tr><th>Campo</th><th>Byte</th><th>Tipo</th><th>Valor</th></tr>` +
    cfg.fields.map((f) => `<tr><td>${esc(f.desc)}</td><td class="num">${f.offset}</td><td>${f.type}</td><td class="num">${esc(f.value)}</td></tr>`).join("");
  renderHex();
  loadBackups();
}
function renderHex() {
  const bytes = cfg.hex.match(/../g).map((h) => parseInt(h, 16));
  let html = `<tr><td class="off"></td>${[...Array(16)].map((_, i) => `<td class="off">${i.toString(16).toUpperCase()}</td>`).join("")}</tr>`;
  for (let r = 0; r < bytes.length; r += 16) {
    html += `<tr><td class="off">${r.toString(16).padStart(3, "0").toUpperCase()}</td>`;
    for (let c = 0; c < 16 && r + c < bytes.length; c++) {
      const i = r + c, v = pending[i] ?? bytes[i];
      html += `<td data-i="${i}" class="${i in pending ? "changed" : ""}" title="byte ${i} = ${v}">${v.toString(16).padStart(2, "0").toUpperCase()}</td>`;
    }
    html += "</tr>";
  }
  $("cfgHex").innerHTML = html;
  $("cfgWrite").disabled = $("cfgDiscard").disabled = !Object.keys(pending).length;
}
$("cfgHex").addEventListener("click", (e) => {
  const td = e.target.closest("td[data-i]");
  if (!td) return;
  const i = +td.dataset.i;
  const orig = parseInt(cfg.hex.substr(i * 2, 2), 16);
  const ans = prompt(`Byte ${i} (0x${i.toString(16).toUpperCase()}). Valor actual: ${pending[i] ?? orig}.\nNuevo valor (decimal 0–255 o hexadecimal 0x..):`);
  if (ans == null || ans.trim() === "") return;
  const v = ans.trim().toLowerCase().startsWith("0x") ? parseInt(ans, 16) : parseInt(ans, 10);
  if (!(v >= 0 && v <= 255)) return toast("Valor no válido", true);
  if (v === orig) delete pending[i]; else pending[i] = v;
  renderHex();
});
$("cfgReload").addEventListener("click", () => { pending = {}; loadConfig(); });
$("cfgDiscard").addEventListener("click", () => { pending = {}; renderHex(); });
$("cfgBackup").addEventListener("click", () => act("/api/pro/config/backup", {}).then((r) => { toast(`Copia guardada: ${r.name}`); loadBackups(); }));
$("cfgWrite").addEventListener("click", () => {
  const changes = Object.entries(pending).map(([offset, value]) => ({ offset: +offset, value }));
  const list = changes.map((c) => `byte ${c.offset} → ${c.value}`).join("\n");
  if (!confirm(`Se va a reescribir la configuración del aparato con estos cambios:\n${list}\n\nSe guardará antes una copia. ¿Continuar?`)) return;
  act("/api/pro/config/write", { changes }).then(pollJob);
});
async function loadBackups() {
  const files = await api("/api/pro/backups");
  $("backupSel").innerHTML = files.length ? files.reverse().map((f) => `<option>${f}</option>`).join("") : "<option value=''>No hay copias</option>";
}
$("cfgRestore").addEventListener("click", () => {
  const name = $("backupSel").value;
  if (name && confirm(`¿Restaurar ${name} en el aparato?`)) act("/api/pro/config/restore", { name }).then(pollJob);
});

/* ---------------------------------------------------------------- simulación */
let simFilled = false;
function fillSim() {
  simFilled = true;
  $("simSource").innerHTML = status.sim_sources.map((k) => `<option value="${k}">${I18N.es.src[k] || k}</option>`).join("");
  $("simMat").innerHTML = status.sim_materials.map((k) => `<option value="${k}">${I18N.es.mat[k] || k}</option>`).join("");
  const p = status.sim;
  $("simSource").value = p.source; $("simDist").value = p.distance_cm;
  $("simMat").value = p.material; $("simThick").value = p.thickness_mm;
}
$("simApply").addEventListener("click", () =>
  act("/api/pro/sim", {
    source: $("simSource").value, distance_cm: +$("simDist").value,
    material: $("simMat").value, thickness_mm: +$("simThick").value,
  }, "Simulación actualizada")
);

boot();
