/* Panel GMC-800 · módulo común (sin dependencias externas: funciona sin internet) */
"use strict";

/* =================================================================== textos */
const I18N = {
  es: {
    org: "Instituto de Física de Partículas y del Cosmos · UCM",
    app: "Detectando radiactividad",
    cps: "cuentas por segundo", cpsShort: "cps", cpm: "cuentas/min", usvh: "µSv/h",
    sim: "Simulación", offline: "Contador desconectado",
    scan: "Sigue la medida en tu móvil", sound: "Sonido",
    measuring: "Midiendo", of: "de", seconds: "s", counts: "cuentas",
    waiting: "Esperando la primera medida…",
    bgUsed: "Fondo restado", time: "Tiempo", total: "Cuentas totales",
    mean: "Media", variance: "Varianza", ratio: "Varianza / media",
    interval: "Intervalo", rateNet: "Tasa neta (cps)", rate: "Cuentas por segundo",
    thickness: "Espesor (mm)", distance: "Distancia (cm)", sample: "Muestra",
    occurrences: "Veces que ocurre", countsPerInterval: "Cuentas en cada intervalo",
    halfLayer: "Capa hemirreductora", mu: "Coeficiente μ", slope: "Exponente medido",
    expected: "Poisson esperada", measured: "Medido", fitR2: "Ajuste k / r²",
    waitTime: "Tiempo hasta la siguiente detección (s)", intervals: "Intervalos",
    expectedExp: "Esperado (exponencial)", rateL: "Tasa λ (cps)", meanWait: "Espera media (s)",
    logScale: "Escala logarítmica", linScale: "Escala lineal", sameSecond: "0 = en el mismo segundo",
    tooFast: "La tasa es demasiado alta para medir esperas con resolución de 1 s: aleja la fuente o usa el fondo.",
    secondsAgo: "segundos atrás",
    act: {
      welcome: {
        t: "¿Qué detecta un contador Geiger?",
        lead: "Cada destello del círculo es una partícula que ha atravesado el tubo del detector.",
        ex: ["Dentro del tubo hay un gas a baja presión y un hilo a unos 400 voltios. Cuando una partícula beta o un fotón gamma ioniza el gas, se produce una pequeña avalancha de electrones que el aparato cuenta como un «clic».",
             "Aunque no haya ninguna fuente cerca, el contador nunca marca cero: siempre hay radiación natural a nuestro alrededor."]
      },
      background: {
        t: "La radiación de fondo",
        lead: "Medimos sin ninguna fuente. ¿De dónde salen estas cuentas?",
        ex: ["Parte llega del espacio: los rayos cósmicos chocan con la atmósfera y producen muones que nos atraviesan continuamente.",
             "Otra parte viene del suelo y los materiales de construcción, que contienen uranio, torio y potasio-40 de forma natural.",
             "Cuanto más tiempo medimos, más precisa es la media: la incertidumbre baja como 1/√N."]
      },
      compare: {
        t: "Comparar muestras",
        lead: "¿Qué objetos cotidianos son radiactivos? Medimos cada uno el mismo tiempo y restamos el fondo.",
        ex: ["Las barras muestran la tasa neta: lo que mide el contador menos la radiación de fondo.",
             "Las líneas finas son la incertidumbre. Si dos barras se solapan dentro de su incertidumbre, no podemos asegurar que sean distintas."]
      },
      shielding: {
        t: "Blindaje",
        lead: "Interponemos láminas de distintos materiales entre la fuente y el detector.",
        ex: ["La radiación gamma no se detiene de golpe: cada milímetro de material absorbe la misma fracción. Por eso la curva es exponencial.",
             "La capa hemirreductora es el espesor que reduce la radiación a la mitad. Cuanto más denso es el material, más fina es."]
      },
      distance: {
        t: "Distancia",
        lead: "Alejamos la fuente del detector. ¿Cuánto baja la radiación?",
        ex: ["La radiación sale en todas direcciones y se reparte sobre una esfera cada vez mayor. Al doblar la distancia, llega una cuarta parte: es la ley del inverso del cuadrado.",
             "Si el exponente medido se acerca a 2, la ley se cumple. Alejarse es la forma más sencilla de protegerse."]
      },
      stats: {
        t: "El azar de la desintegración",
        lead: "Nadie puede predecir cuándo se desintegrará un núcleo. Pero muchos juntos siguen una ley muy precisa.",
        ex: ["Contamos cuántas partículas llegan en cada intervalo y dibujamos con qué frecuencia sale cada número.",
             "La curva es la distribución de Poisson. Su propiedad más llamativa: la varianza es igual a la media."]
      },
      arrivals: {
        t: "¿Cuánto hay que esperar?",
        lead: "Medimos el tiempo entre una detección y la siguiente. Las esperas cortas son las más frecuentes.",
        ex: ["Si las desintegraciones son independientes, el tiempo de espera sigue una distribución exponencial: cada segundo que pasa, la probabilidad de que llegue la siguiente partícula es la misma.",
             "Por eso el núcleo «no tiene memoria»: haber esperado mucho no hace más probable que llegue pronto.",
             "En escala logarítmica, la exponencial se convierte en una recta. Su pendiente es la tasa de detecciones."]
      }
    },
    src: { none: "Ninguna", cs137: "Cesio-137", co60: "Cobalto-60", na22: "Sodio-22", am241: "Americio-241",
           ra226: "Radio-226", uraninite: "Uraninita", thorium_rod: "Barra de torio", mantle: "Camisa toriada",
           uranium_glass: "Vidrio de uranio", potassium_salt: "Sal de potasio" },
    mat: { none: "Ninguno", paper: "Papel", aluminium: "Aluminio", steel: "Acero", lead: "Plomo" }
  },
  en: {
    org: "Institute of Particle and Cosmos Physics · UCM",
    app: "Detecting radioactivity",
    cps: "counts per second", cpsShort: "cps", cpm: "counts/min", usvh: "µSv/h",
    sim: "Simulation", offline: "Counter disconnected",
    scan: "Follow the measurement on your phone", sound: "Sound",
    measuring: "Measuring", of: "of", seconds: "s", counts: "counts",
    waiting: "Waiting for the first measurement…",
    bgUsed: "Background subtracted", time: "Time", total: "Total counts",
    mean: "Mean", variance: "Variance", ratio: "Variance / mean",
    interval: "Interval", rateNet: "Net rate (cps)", rate: "Counts per second",
    thickness: "Thickness (mm)", distance: "Distance (cm)", sample: "Sample",
    occurrences: "Times observed", countsPerInterval: "Counts in each interval",
    halfLayer: "Half-value layer", mu: "Coefficient μ", slope: "Measured exponent",
    expected: "Expected Poisson", measured: "Measured", fitR2: "k / r² fit",
    waitTime: "Time until the next detection (s)", intervals: "Intervals",
    expectedExp: "Expected (exponential)", rateL: "Rate λ (cps)", meanWait: "Mean wait (s)",
    logScale: "Log scale", linScale: "Linear scale", sameSecond: "0 = within the same second",
    tooFast: "The rate is too high to time the waits with 1 s resolution: move the source away or use the background.",
    secondsAgo: "seconds ago",
    act: {
      welcome: {
        t: "What does a Geiger counter detect?",
        lead: "Every flash in the circle is a particle that has crossed the detector tube.",
        ex: ["Inside the tube there is a low-pressure gas and a wire at about 400 volts. When a beta particle or a gamma photon ionises the gas, it triggers a small electron avalanche that the device counts as a “click”.",
             "Even with no source nearby the counter never reads zero: natural radiation is always around us."]
      },
      background: {
        t: "Background radiation",
        lead: "We measure with no source at all. Where do these counts come from?",
        ex: ["Some come from space: cosmic rays hit the atmosphere and produce muons that pass through us all the time.",
             "The rest comes from the ground and building materials, which naturally contain uranium, thorium and potassium-40.",
             "The longer we measure, the more precise the mean: the uncertainty shrinks as 1/√N."]
      },
      compare: {
        t: "Comparing samples",
        lead: "Which everyday objects are radioactive? We measure each for the same time and subtract the background.",
        ex: ["The bars show the net rate: what the counter measures minus the background radiation.",
             "The thin lines are the uncertainty. If two bars overlap within their uncertainty, we cannot be sure they differ."]
      },
      shielding: {
        t: "Shielding",
        lead: "We place sheets of different materials between the source and the detector.",
        ex: ["Gamma radiation is not stopped all at once: each millimetre absorbs the same fraction. That is why the curve is exponential.",
             "The half-value layer is the thickness that halves the radiation. The denser the material, the thinner it is."]
      },
      distance: {
        t: "Distance",
        lead: "We move the source away from the detector. How much does the radiation drop?",
        ex: ["Radiation spreads in all directions over an ever larger sphere. Doubling the distance leaves a quarter: the inverse-square law.",
             "If the measured exponent is close to 2, the law holds. Keeping your distance is the simplest protection."]
      },
      stats: {
        t: "The randomness of decay",
        lead: "Nobody can predict when a nucleus will decay. Yet many of them together follow a very precise law.",
        ex: ["We count how many particles arrive in each interval and plot how often each number appears.",
             "The curve is the Poisson distribution. Its most striking property: the variance equals the mean."]
      },
      arrivals: {
        t: "How long do we wait?",
        lead: "We measure the time between one detection and the next. Short waits are the most frequent.",
        ex: ["If decays are independent, the waiting time follows an exponential distribution: every second, the chance that the next particle arrives is the same.",
             "That is why the nucleus “has no memory”: having waited a long time does not make the next arrival any more likely to come soon.",
             "On a log scale the exponential becomes a straight line. Its slope is the detection rate."]
      }
    },
    src: { none: "None", cs137: "Caesium-137", co60: "Cobalt-60", na22: "Sodium-22", am241: "Americium-241",
           ra226: "Radium-226", uraninite: "Uraninite", thorium_rod: "Thorium rod", mantle: "Thoriated mantle",
           uranium_glass: "Uranium glass", potassium_salt: "Potassium salt" },
    mat: { none: "None", paper: "Paper", aluminium: "Aluminium", steel: "Steel", lead: "Lead" }
  }
};

let LANG = "es";
function t(path) {
  const get = (o) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
  const v = get(I18N[LANG]);
  return v == null ? get(I18N.es) ?? path : v;
}

/* =================================================================== red */
const TOKEN_KEY = "gmc800_token";
async function api(path, body) {
  const opts = { headers: { "Content-Type": "application/json" } };
  const tok = sessionStorage.getItem(TOKEN_KEY);
  if (tok) opts.headers["X-Token"] = tok;
  if (body !== undefined) { opts.method = "POST"; opts.body = JSON.stringify(body); }
  const r = await fetch(path, opts);
  const ct = r.headers.get("Content-Type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) {
    const err = new Error((data && data.error) || r.statusText);
    err.status = r.status;
    throw err;
  }
  return data;
}

/*
 * Tiempo real. Primero intenta Server-Sent Events; si en 6 s no llega ningún dato
 * (un proxy los está reteniendo), cambia a consultar /api/ticks cada segundo.
 */
function stream(handlers) {
  let last = Date.now(), after = 0, polling = false, opened = false;
  const deliver = (ev, d) => {
    last = Date.now();
    if (ev === "tick") after = Math.max(after, d.t);
    if (handlers[ev]) handlers[ev](d);
  };
  const open = () => { if (!opened) { opened = true; handlers.open && handlers.open(); } };

  const es = new EventSource("/api/stream");
  for (const ev of Object.keys(handlers)) {
    if (ev === "open" || ev === "disconnect") continue;
    es.addEventListener(ev, (e) => { open(); deliver(ev, JSON.parse(e.data)); });
  }
  es.onopen = () => { last = Date.now(); };
  es.onerror = () => handlers.disconnect && handlers.disconnect();

  async function poll() {
    try {
      const ticks = await api(`/api/ticks?after=${after}`);
      ticks.forEach((d) => deliver("tick", d));
    } catch (e) { /* reintenta en el siguiente ciclo */ }
    setTimeout(poll, 1000);
  }
  setInterval(() => {
    if (!polling && Date.now() - last > 6000) {
      polling = true;
      es.close();
      console.info("Sin datos en tiempo real por streaming: se consulta cada segundo");
      open();
      poll();
    }
  }, 2000);
}

/* =================================================================== formato */
function fmt(v, d = 2) {
  if (v == null || !isFinite(v)) return "–";
  const loc = LANG === "es" ? "es-ES" : "en-GB";
  return Number(v).toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtErr(v, e) {
  if (!isFinite(v)) return "–";
  if (!e || !isFinite(e)) return fmt(v, 2);
  const d = Math.max(0, Math.min(4, 1 - Math.floor(Math.log10(e))));
  return `${fmt(v, d)} ± ${fmt(e, d)}`;
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* =================================================================== física */
function netRate(p, bg) {
  const r = p.counts / p.seconds;
  const er = Math.sqrt(Math.max(p.counts, 1)) / p.seconds;
  return { r: r - bg.value, e: Math.hypot(er, bg.err || 0) };
}

/* Regresión lineal ponderada y = a + b·x */
function linfit(xs, ys, ws) {
  let S = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const w = ws ? ws[i] : 1;
    S += w; Sx += w * xs[i]; Sy += w * ys[i]; Sxx += w * xs[i] * xs[i]; Sxy += w * xs[i] * ys[i];
  }
  const D = S * Sxx - Sx * Sx;
  if (xs.length < 2 || D === 0) return null;
  const b = (S * Sxy - Sx * Sy) / D, a = (Sxx * Sy - Sx * Sxy) / D;
  return { a, b, ea: Math.sqrt(Sxx / D), eb: Math.sqrt(S / D) };
}

/* Blindaje: ln R = a − μ·x para cada material */
function fitAttenuation(points) {
  const ok = points.filter((p) => p.r > 0 && p.e > 0);
  if (ok.length < 2) return null;
  const f = linfit(ok.map((p) => p.x), ok.map((p) => Math.log(p.r)), ok.map((p) => (p.r / p.e) ** 2));
  if (!f || f.b >= 0) return null;
  const mu = -f.b;
  return { mu, emu: f.eb, R0: Math.exp(f.a), hvl: Math.LN2 / mu, ehvl: (Math.LN2 / mu) * (f.eb / mu) };
}

/* Distancia: R = k / x² y pendiente libre en escala log-log */
function fitInverseSquare(points) {
  const ok = points.filter((p) => p.r > 0 && p.x > 0 && p.e > 0);
  if (ok.length < 2) return null;
  let num = 0, den = 0;
  for (const p of ok) { const w = 1 / p.e ** 2; num += (w * p.r) / p.x ** 2; den += w / p.x ** 4; }
  const k = num / den;
  const f = linfit(ok.map((p) => Math.log(p.x)), ok.map((p) => Math.log(p.r)), ok.map((p) => (p.r / p.e) ** 2));
  return { k, n: f ? -f.b : null, en: f ? f.eb : null };
}

/*
 * Tiempos de llegada con resolución de 1 s.
 * El contador solo da cuentas por segundo, así que la espera entre dos detecciones consecutivas
 * se mide como D = (segundo de la siguiente) − (segundo de la anterior): D = 0 si caen en el mismo segundo.
 * Para un proceso de Poisson de tasa λ (llegada uniforme dentro de su segundo, espera T ~ Exp(λ)):
 *   P(D = 0) = 1 − (1 − e^−λ)/λ
 *   P(D = k) = (1 − e^−λ)² · e^−λ(k−1) / λ,  k ≥ 1
 * que es la exponencial «vista» con un reloj de 1 s. Su media es exactamente 1/λ.
 */
function waitTimes(samples) {
  const d = [];
  let last = -1, total = 0;
  samples.forEach((n, i) => {
    total += n;
    if (!n) return;
    if (last >= 0) d.push(i - last);
    for (let j = 1; j < n; j++) d.push(0);
    last = i;
  });
  return { d, lambda: samples.length ? total / samples.length : NaN };
}
function waitPmf(k, lam) {
  if (!(lam > 0)) return NaN;
  const q = 1 - Math.exp(-lam);
  return k === 0 ? 1 - q / lam : (q * q * Math.exp(-lam * (k - 1))) / lam;
}

function lnFact(n) { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; }
function poissonPmf(k, m) { return m <= 0 ? (k === 0 ? 1 : 0) : Math.exp(k * Math.log(m) - m - lnFact(k)); }
function group(samples, n) {
  const out = [];
  for (let i = 0; i + n <= samples.length; i += n) out.push(samples.slice(i, i + n).reduce((a, b) => a + b, 0));
  return out;
}
function meanVar(a) {
  if (!a.length) return { mean: NaN, var: NaN };
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  const v = a.length > 1 ? a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) : NaN;
  return { mean: m, var: v };
}

/* =================================================================== gráficas */
const COLORS = ["#1a7c84", "#7a4fa0", "#c46a1b", "#2f7d4a", "#b8403a", "#3b5ba5"];

function niceStep(range, target) {
  const raw = range / Math.max(target, 1);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

/**
 * plot(canvas, spec)
 * spec.x / spec.y: { label, min, max, log, categories }
 * spec.series: [{ type: line|scatter|bars|func|hist, ... }]
 */
function plot(canvas, spec) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.body);
  const ink = css.getPropertyValue("--ink").trim() || "#1c2b4a";
  const grid = css.getPropertyValue("--grid").trim() || "#cfdad5";
  const base = Math.max(11, Math.min(16, W / 45));
  const font = `${base}px ${css.getPropertyValue("--ui")}`;
  ctx.font = font;

  const X = spec.x || {}, Y = spec.y || {};
  const cats = X.categories;
  let xs = [], ys = [];
  for (const s of spec.series || []) {
    if (s.type === "bars") s.values.forEach((v) => { ys.push(v.y + (v.err || 0), v.y - (v.err || 0)); });
    else if (s.type === "hist") s.bins.forEach((b) => { xs.push(b.x - 0.5, b.x + 0.5); ys.push(b.y); });
    else if (s.points) s.points.forEach((p) => { xs.push(p[0]); ys.push(p[1] + (p[2] || 0)); ys.push(p[1] - (p[2] || 0)); });
  }
  if (Y.log) ys = ys.filter((v) => v > 0);
  let x0 = X.min ?? (xs.length ? Math.min(...xs) : 0), x1 = X.max ?? (xs.length ? Math.max(...xs) : 1);
  let y0 = Y.min ?? (ys.length ? Math.min(...ys) : 0), y1 = Y.max ?? (ys.length ? Math.max(...ys) : 1);
  if (!Y.log && Y.min == null) y0 = Math.min(0, y0);
  if (y1 <= y0) y1 = y0 + 1;
  if (x1 <= x0) x1 = x0 + 1;
  if (X.max == null && !cats) x1 += (x1 - x0) * 0.05;
  if (Y.log) { y0 = 10 ** Math.floor(Math.log10(y0 || 0.1)); y1 = 10 ** Math.ceil(Math.log10(y1)); }
  else if (Y.max == null) y1 += (y1 - y0) * 0.08;
  if (cats) { x0 = -0.5; x1 = cats.length - 0.5; }

  const padL = base * 4.2, padR = base * 1.2, padT = base * 0.8, padB = base * (cats ? 3.6 : 3.2);
  const pw = W - padL - padR, ph = H - padT - padB;
  const sx = (x) => padL + ((x - x0) / (x1 - x0)) * pw;
  const sy = Y.log
    ? (y) => padT + ph - ((Math.log10(Math.max(y, 1e-9)) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0))) * ph
    : (y) => padT + ph - ((y - y0) / (y1 - y0)) * ph;

  // rejilla y ejes
  ctx.strokeStyle = grid; ctx.fillStyle = ink; ctx.lineWidth = 1;
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  const yt = [];
  if (Y.log) for (let v = y0; v <= y1 * 1.0001; v *= 10) yt.push(v);
  else { const st = niceStep(y1 - y0, ph / (base * 3.5)); for (let v = Math.ceil(y0 / st) * st; v <= y1; v += st) yt.push(v); }
  for (const v of yt) {
    const y = sy(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + pw, y); ctx.stroke();
    ctx.fillText(Y.log ? String(v) : fmtTick(v), padL - base * 0.4, y);
  }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  if (cats) {
    const maxCh = Math.max(6, Math.floor(pw / cats.length / (base * 0.55)));
    cats.forEach((c, i) => {
      const lbl = c.length > maxCh ? c.slice(0, maxCh - 1) + "…" : c;
      ctx.fillText(lbl, sx(i), padT + ph + base * 0.4);
    });
  } else {
    let st = niceStep(x1 - x0, pw / (base * 6));
    if (X.integer) st = Math.max(1, Math.round(st));   // ejes de valores enteros (histogramas)
    for (let v = Math.ceil(x0 / st) * st; v <= x1 + 1e-9; v += st) {
      const x = sx(v);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke();
      ctx.fillText(fmtTick(v), x, padT + ph + base * 0.4);
    }
  }
  ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + ph); ctx.lineTo(padL + pw, padT + ph); ctx.stroke();
  if (X.label) ctx.fillText(X.label, padL + pw / 2, H - base * 1.3);
  if (Y.label) {
    ctx.save(); ctx.translate(base * 0.9, padT + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle"; ctx.fillText(Y.label, 0, 0); ctx.restore();
  }

  ctx.save();
  ctx.beginPath(); ctx.rect(padL, padT - 2, pw + 2, ph + 4); ctx.clip();
  for (const s of spec.series || []) {
    const c = s.color || COLORS[0];
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []);
    if (s.type === "line" && s.points.length) {
      ctx.beginPath();
      s.points.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))));
      ctx.stroke();
    } else if (s.type === "func") {
      ctx.beginPath();
      const n = 160;
      let first = true;
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n, y = s.f(x);
        if (!isFinite(y) || (Y.log && y <= 0)) { first = true; continue; }
        first ? ctx.moveTo(sx(x), sy(y)) : ctx.lineTo(sx(x), sy(y));
        first = false;
      }
      ctx.stroke();
    } else if (s.type === "scatter") {
      ctx.setLineDash([]);
      for (const p of s.points) {
        const x = sx(p[0]), y = sy(p[1]);
        if (p[2]) {
          ctx.lineWidth = 1.5; ctx.beginPath();
          ctx.moveTo(x, sy(Y.log ? Math.max(p[1] - p[2], y0) : p[1] - p[2])); ctx.lineTo(x, sy(p[1] + p[2])); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(x, y, s.r || base * 0.38, 0, 2 * Math.PI); ctx.fill();
      }
    } else if (s.type === "bars") {
      const bw = (pw / cats.length) * 0.6;
      s.values.forEach((v, i) => {
        const x = sx(i), yb = sy(Math.max(0, y0)), yv = sy(v.y);
        ctx.fillStyle = v.color || c; ctx.fillRect(x - bw / 2, Math.min(yb, yv), bw, Math.abs(yb - yv));
        if (v.err) {
          ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.beginPath();
          ctx.moveTo(x, sy(v.y - v.err)); ctx.lineTo(x, sy(v.y + v.err));
          ctx.moveTo(x - bw * 0.15, sy(v.y - v.err)); ctx.lineTo(x + bw * 0.15, sy(v.y - v.err));
          ctx.moveTo(x - bw * 0.15, sy(v.y + v.err)); ctx.lineTo(x + bw * 0.15, sy(v.y + v.err));
          ctx.stroke();
        }
      });
    } else if (s.type === "hist") {
      const bw = Math.max(1, sx(1) - sx(0) - 2);
      for (const b of s.bins) {
        const yv = sy(b.y), yb = sy(0);
        ctx.fillRect(sx(b.x) - bw / 2, yv, bw, yb - yv);
      }
    }
  }
  ctx.restore();
  ctx.setLineDash([]);
}
function fmtTick(v) {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1000) return Math.round(v).toLocaleString();
  if (a >= 10) return String(Math.round(v * 10) / 10);
  return String(Math.round(v * 1000) / 1000);
}

/* =================================================================== detector y sonido */
function makeDetector(el) {
  let pending = 0;
  return {
    pulses(n) {
      if (!n || document.hidden) return;
      const m = Math.min(n, 40); // por encima de 40/s ya no se distinguen
      for (let i = 0; i < m; i++) {
        setTimeout(() => {
          if (pending > 60) return;
          const d = document.createElement("span");
          d.className = "flash";
          const a = Math.random() * 2 * Math.PI, r = Math.sqrt(Math.random()) * 42;
          d.style.left = 50 + r * Math.cos(a) + "%";
          d.style.top = 50 + r * Math.sin(a) + "%";
          el.appendChild(d); pending++;
          setTimeout(() => { d.remove(); pending--; }, 720);
        }, Math.random() * 950);
      }
    }
  };
}

/* Clics sintéticos: el número de clics por segundo es real; su reparto dentro del segundo, aleatorio. */
function makeClicker() {
  let ctx = null;
  return {
    get on() { return !!ctx && ctx.state === "running"; },
    async toggle() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "running") await ctx.suspend(); else await ctx.resume();
      return ctx.state === "running";
    },
    clicks(n) {
      if (!ctx || ctx.state !== "running" || !n) return;
      const now = ctx.currentTime;
      for (let i = 0; i < Math.min(n, 200); i++) {
        const tt = now + Math.random() * 0.98;
        const buf = ctx.createBuffer(1, 220, ctx.sampleRate), d = buf.getChannelData(0);
        for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * Math.exp(-j / 25);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const g = ctx.createGain(); g.gain.value = 0.6;
        src.connect(g).connect(ctx.destination); src.start(tt);
      }
    }
  };
}

function toast(msg, isErr) {
  const d = document.createElement("div");
  d.className = "toast" + (isErr ? " err" : "");
  d.setAttribute("role", "status");
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), isErr ? 5000 : 2600);
}
