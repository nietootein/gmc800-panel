/* Vistas de divulgación: /screen (proyector) y /view (móviles). Solo lectura. */
"use strict";

const IS_SCREEN = location.pathname.startsWith("/screen");
document.body.classList.add(IS_SCREEN ? "screen" : "mobile");
if (!IS_SCREEN) document.getElementById("bigUnit").dataset.t = "cpsShort";

const $ = (id) => document.getElementById(id);
const detector = makeDetector($("detector"));
const clicker = makeClicker();
const LANG_KEY = "gmc800_lang";

let S = null;              // estado público
let live = [];             // [t, cps] recientes
let lastTick = null;
let langLocked = false;    // el usuario ha elegido idioma en este dispositivo
let statsInterval = 1;
let arrivalsLog = true;    // la exponencial se ve recta en escala logarítmica
let builtFor = null;       // actividad para la que está montado el panel

/* ---------------------------------------------------------------- idioma */
function applyLang(l) {
  LANG = l === "en" ? "en" : "es";
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === LANG)));
  document.title = `${t("app")} · IPARCOS-UCM`;
  builtFor = null;
  render();
}
document.querySelectorAll("[data-lang]").forEach((b) =>
  b.addEventListener("click", () => {
    langLocked = true;
    try { localStorage.setItem(LANG_KEY, b.dataset.lang); } catch (e) { /* sin almacenamiento */ }
    applyLang(b.dataset.lang);
  })
);
(() => {
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch (e) { /* nada */ }
  if (!IS_SCREEN && saved) langLocked = true;
  applyLang(saved || (navigator.language || "es").slice(0, 2));
})();

$("soundBtn").addEventListener("click", async () => {
  const on = await clicker.toggle();
  $("soundBtn").setAttribute("aria-pressed", String(on));
});

/* ---------------------------------------------------------------- datos */
async function loadState() {
  try {
    S = await api("/api/public/state");
    if (!langLocked && IS_SCREEN && S.screen_lang !== LANG) applyLang(S.screen_lang);
    $("simBadge").hidden = !S.simulated;
    $("url").textContent = S.mobile_url;
    const qr = "/api/qr.svg?u=" + encodeURIComponent(S.mobile_url);   // se regenera si cambia la dirección
    if ($("qr").getAttribute("src") !== qr) $("qr").setAttribute("src", qr);
    render();
  } catch (e) {
    setTimeout(loadState, 2000);
  }
}
async function loadSeries() {
  try { live = await api("/api/series?seconds=600"); } catch (e) { live = []; }
}

stream({
  tick(d) {
    lastTick = d;
    $("offBadge").hidden = d.connected;
    if (d.cps != null) {
      live.push([d.t, d.cps]);
      if (live.length > 600) live.shift();
      detector.pulses(d.cps);
      clicker.clicks(d.cps);
      if (S && d.appended && S.measure.activity) S.data[S.measure.activity].samples.push(d.cps);
    }
    if (S) { S.measure.elapsed = d.measure.elapsed; S.measure.counts = d.measure.counts; S.measure.running = d.measure.running; }
    if (S && d.version !== S.version) { loadState(); return; }
    updateLive(d);
    update();
  },
  state() { loadState(); },
  open() { loadState(); loadSeries(); },
});

function updateLive(d) {
  $("bigCps").textContent = d.cps == null ? "–" : d.cps;
  $("rCps").textContent = d.cps == null ? "–" : d.cps;
  $("rCpm").textContent = fmt(d.cpm, 0);
  $("rUsv").textContent = fmt(d.usvh, 3);
}

/* ---------------------------------------------------------------- panel */
const panel = $("panel");

function label(l) {
  if (!l) return "–";
  const s = I18N[LANG].src[l] || I18N[LANG].mat[l];
  return s || l;
}

function render() {
  if (!S) return;
  if (builtFor !== S.activity + LANG) build();
  update();
}

function build() {
  const a = S.activity;
  builtFor = a + LANG;
  const txt = t(`act.${a}`);
  let extra = "";
  if (a === "stats") {
    extra = `<div class="row" style="display:flex;gap:.6rem;align-items:center;margin-bottom:.4rem">
      <span>${t("interval")}</span>
      <div class="seg" role="group" aria-label="${t("interval")}">
        ${[1, 2, 5, 10].map((n) => `<button data-int="${n}" aria-pressed="${n === statsInterval}">${n} ${t("seconds")}</button>`).join("")}
      </div></div>`;
  }
  if (a === "arrivals") {
    extra = `<div class="row" style="display:flex;gap:.6rem;align-items:center;margin-bottom:.4rem">
      <div class="seg" role="group" aria-label="${t("logScale")}">
        <button data-log="1" aria-pressed="${arrivalsLog}">${t("logScale")}</button>
        <button data-log="0" aria-pressed="${!arrivalsLog}">${t("linScale")}</button>
      </div></div>`;
  }
  panel.innerHTML = `
    <h2>${esc(txt.t)}</h2>
    <p class="lead">${esc(txt.lead)}</p>
    <div id="meas" hidden>
      <div class="measuring"><span>${t("measuring")}: <span id="mLabel"></span></span><span class="num" id="mTime"></span></div>
      <div class="progress"><div id="mBar"></div></div>
    </div>
    ${extra}
    <div class="facts" id="facts"></div>
    <div class="legend" id="legend"></div>
    <canvas class="chart" id="chart" role="img" aria-label="${esc(txt.t)}"></canvas>
    <div class="explain">${txt.ex.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`;
  panel.querySelectorAll("[data-log]").forEach((b) =>
    b.addEventListener("click", () => {
      arrivalsLog = b.dataset.log === "1";
      panel.querySelectorAll("[data-log]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      update();
    })
  );
  panel.querySelectorAll("[data-int]").forEach((b) =>
    b.addEventListener("click", () => {
      statsInterval = +b.dataset.int;
      panel.querySelectorAll("[data-int]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      update();
    })
  );
}

function fact(v, k) { return `<div class="fact"><div class="v num">${v}</div><div class="k">${esc(k)}</div></div>`; }

function update() {
  if (!S || !$("chart")) return;
  const m = S.measure, a = S.activity;
  const meas = $("meas");
  meas.hidden = !(m.running && m.activity === a);
  if (!meas.hidden) {
    $("mLabel").textContent = a === "background" || a === "stats" || a === "arrivals" ? "" :
      label(m.label) + (m.x != null ? ` · ${fmt(m.x, a === "distance" ? 1 : 1)} ${a === "distance" ? "cm" : "mm"}` : "");
    $("mTime").textContent = m.duration ? `${m.elapsed} ${t("of")} ${m.duration} ${t("seconds")} · ${m.counts} ${t("counts")}`
                                         : `${m.elapsed} ${t("seconds")} · ${m.counts} ${t("counts")}`;
    $("mBar").style.width = m.duration ? `${Math.min(100, (100 * m.elapsed) / m.duration)}%` : "100%";
  }
  const bg = S.background_rate;
  const chart = $("chart"), facts = $("facts"), legend = $("legend");
  legend.innerHTML = "";

  if (a === "welcome" || a === "background") {
    const win = a === "welcome" ? 120 : 300;
    const now = Date.now() / 1000;
    const pts = live.filter((p) => now - p[0] <= win).map((p) => [p[0] - now, p[1]]);
    const series = [{ type: "line", points: pts, color: COLORS[0], width: 1.6 }];
    if (a === "background") {
      const s = S.data.background.samples;
      const n = s.reduce((x, y) => x + y, 0);
      const mean = s.length ? n / s.length : NaN, err = s.length ? Math.sqrt(Math.max(n, 1)) / s.length : NaN;
      if (s.length) series.push({ type: "func", f: () => mean, color: COLORS[2], dash: [6, 5], width: 2 });
      facts.innerHTML = s.length
        ? fact(fmtErr(mean, err), `${t("mean")} (${t("cpsShort")})`) + fact(fmtErr(mean * 60, err * 60), t("cpm")) +
          fact(fmt(s.length, 0) + " " + t("seconds"), t("time")) + fact(fmt(n, 0), t("total"))
        : `<p>${t("waiting")}</p>`;
    } else facts.innerHTML = "";
    plot(chart, { x: { label: t("secondsAgo"), min: -win, max: 0 }, y: { label: t("rate"), min: 0 }, series });
  }

  else if (a === "compare") {
    const pts = S.data.compare.points.map((p) => ({ ...netRate(p, bg), label: label(p.label) }));
    facts.innerHTML = pts.length ? fact(fmtErr(bg.value, bg.err) + " cps", t("bgUsed")) : `<p>${t("waiting")}</p>`;
    plot(chart, {
      x: { categories: pts.map((p) => p.label) }, y: { label: t("rateNet") },
      series: [{ type: "bars", values: pts.map((p, i) => ({ y: p.r, err: p.e, color: COLORS[i % COLORS.length] })) }],
    });
  }

  else if (a === "shielding") {
    const groups = {}, zeros = [];
    for (const p of S.data.shielding.points) {
      const q = { x: p.x ?? 0, ...netRate(p, bg) };
      if (q.x === 0 || p.label === "none") zeros.push(q);
      else (groups[p.label || "–"] ||= []).push(q);
    }
    // la medida sin blindaje es el punto de partida común de todas las curvas
    if (!Object.keys(groups).length && zeros.length) groups.none = [];
    for (const g of Object.values(groups)) g.unshift(...zeros);
    const series = [];
    let f = "", lg = "";
    Object.entries(groups).forEach(([g, pts], i) => {
      const c = COLORS[i % COLORS.length];
      series.push({ type: "scatter", points: pts.filter((p) => p.r > 0).map((p) => [p.x, p.r, p.e]), color: c });
      const fit = fitAttenuation(pts);
      if (fit) {
        series.push({ type: "func", f: (x) => fit.R0 * Math.exp(-fit.mu * x), color: c, width: 1.6 });
        f += fact(`${fmtErr(fit.hvl, fit.ehvl)} mm`, `${t("halfLayer")} · ${label(g)}`);
      }
      lg += `<span><i style="background:${c}"></i>${esc(label(g))}</span>`;
    });
    legend.innerHTML = lg;
    facts.innerHTML = f || (S.data.shielding.points.length ? "" : `<p>${t("waiting")}</p>`);
    plot(chart, { x: { label: t("thickness"), min: 0 }, y: { label: t("rateNet"), log: true }, series });
  }

  else if (a === "distance") {
    const pts = S.data.distance.points.map((p) => ({ x: p.x, ...netRate(p, bg) })).filter((p) => p.x > 0);
    const fit = fitInverseSquare(pts);
    const series = [{ type: "scatter", points: pts.map((p) => [p.x, p.r, p.e]), color: COLORS[0] }];
    if (fit) series.push({ type: "func", f: (x) => fit.k / (x * x), color: COLORS[2], width: 1.8 });
    facts.innerHTML = fit && fit.n != null
      ? fact(fmtErr(fit.n, fit.en), t("slope")) + fact("2", "1 / r²")
      : (pts.length ? "" : `<p>${t("waiting")}</p>`);
    if (fit) legend.innerHTML = `<span><i style="background:${COLORS[0]}"></i>${t("measured")}</span><span><i style="background:${COLORS[2]}"></i>${t("fitR2")}</span>`;
    plot(chart, { x: { label: t("distance"), min: 0 }, y: { label: t("rateNet"), min: 0 }, series });
  }

  else if (a === "arrivals") {
    const { d, lambda } = waitTimes(S.data.arrivals.samples);
    const N = d.length;
    const hist = {};
    d.forEach((k) => (hist[k] = (hist[k] || 0) + 1));
    // hasta donde se esperaría menos de media espera, o la más larga observada
    let kmax = Math.max(4, ...d);
    if (lambda > 0) while (N * waitPmf(kmax + 1, lambda) >= 0.5 && kmax < 120) kmax++;
    const expected = [];
    for (let k = 0; k <= kmax; k++) expected.push([k, N * waitPmf(k, lambda)]);
    const meanD = N ? d.reduce((x, y) => x + y, 0) / N : NaN;
    facts.innerHTML = N
      ? fact(fmt(lambda, 2), t("rateL")) + fact(fmt(meanD, 2), t("meanWait")) + fact("1/λ = " + fmt(1 / lambda, 2), t("expectedExp")) +
        fact(fmt(N, 0), t("intervals")) + (lambda > 2 ? `<p class="warn" style="color:var(--warn);flex-basis:100%;margin:0">${t("tooFast")}</p>` : "")
      : `<p>${t("waiting")}</p>`;
    legend.innerHTML = N ? `<span><i style="background:${COLORS[0]}"></i>${t("measured")}</span><span><i style="background:${COLORS[2]}"></i>${t("expectedExp")}</span><span>${t("sameSecond")}</span>` : "";
    plot(chart, {
      x: { label: t("waitTime"), min: -0.5, max: kmax + 0.5, integer: true },
      y: arrivalsLog ? { label: t("occurrences"), log: true } : { label: t("occurrences"), min: 0 },
      series: [{ type: "hist", bins: Object.entries(hist).map(([k, n]) => ({ x: +k, y: n })), color: COLORS[0] },
               { type: "line", points: expected.filter((p) => !arrivalsLog || p[1] > 0), color: COLORS[2], width: 2.5 },
               { type: "scatter", points: expected, color: COLORS[2], r: 3 }],
    });
  }

  else if (a === "stats") {
    const g = group(S.data.stats.samples, statsInterval);
    const { mean, var: v } = meanVar(g);
    const hist = {};
    g.forEach((k) => (hist[k] = (hist[k] || 0) + 1));
    const kmax = Math.max(...g, Math.ceil(mean + 4 * Math.sqrt(mean || 1)), 5);
    const bins = Object.entries(hist).map(([k, n]) => ({ x: +k, y: n }));
    const pois = [];
    for (let k = 0; k <= kmax; k++) pois.push([k, g.length * poissonPmf(k, mean)]);
    facts.innerHTML = g.length
      ? fact(fmt(mean, 2), t("mean")) + fact(fmt(v, 2), t("variance")) + fact(fmt(v / mean, 2), t("ratio")) + fact(fmt(g.length, 0), t("interval") + "s")
      : `<p>${t("waiting")}</p>`;
    legend.innerHTML = g.length ? `<span><i style="background:${COLORS[0]}"></i>${t("measured")}</span><span><i style="background:${COLORS[2]}"></i>${t("expected")}</span>` : "";
    plot(chart, {
      x: { label: t("countsPerInterval"), min: -0.5, max: kmax + 0.5, integer: true }, y: { label: t("occurrences"), min: 0 },
      series: [{ type: "hist", bins, color: COLORS[0] },
               { type: "line", points: pois, color: COLORS[2], width: 2.5 },
               { type: "scatter", points: pois, color: COLORS[2], r: 3 }],
    });
  }
}

window.addEventListener("resize", () => update());
