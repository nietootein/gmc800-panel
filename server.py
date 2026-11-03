#!/usr/bin/env python3
"""
Panel GMC-800 · IPARCOS-UCM
Servidor local que lee el contador Geiger y sirve tres vistas web:

  /pro     panel profesional (con contraseña): datos, configuración y control
  /screen  vista para proyectar en el aula, con código QR
  /view    vista para los móviles de los participantes (solo lectura)

Uso:
  python3 server.py                     # detecta el contador automáticamente
  python3 server.py --sim               # modo simulación, sin aparato
  python3 server.py --port /dev/ttyUSB0 --password miclave
"""

import argparse
import io
import json
import math
import os
import queue
import secrets
import socket
import sys
import threading
import time
import traceback
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import gmc
import simulator

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")
DATA = os.path.join(BASE, "data")
os.makedirs(DATA, exist_ok=True)

ACTIVITIES = ["welcome", "background", "compare", "shielding", "distance", "stats", "arrivals"]
DEFAULT_USV_PER_CPM = 1 / 153.8  # factor de GQ para el tubo M4011
SERIES_LEN = 3600


# ====================================================================== estado
class App:
    def __init__(self, args):
        self.args = args
        self.dev = None
        self.simulated = args.sim
        self.dev_lock = threading.Lock()
        self.state_lock = threading.RLock()
        self.connected = False
        self.last_error = ""
        self.password = args.password or secrets.token_urlsafe(6)
        self.tokens = set()
        self.clients = set()
        self.clients_lock = threading.Lock()
        self.series = deque(maxlen=SERIES_LEN)  # (t, cps)
        self.window = deque(maxlen=60)
        self.dose_usv = 0.0
        self.device_info = {}
        self.usv_per_cpm = DEFAULT_USV_PER_CPM
        self.job = {"name": None, "progress": 0, "done": True, "error": "", "result": None}
        self.version = 0
        self.screen_lang = "es"
        self.activity = "welcome"
        self.measure = self._idle_measure()
        self.data = self._empty_data()
        self.manual_background = None
        self.history_raw = b""
        self.recent_ticks = deque(maxlen=300)   # para pantallas que no reciben el streaming
        self.public_url = args.public_url.rstrip("/") if args.public_url else None
        self.tunnel_proc = None
        self.session_file = os.path.join(DATA, time.strftime("sesion_%Y%m%d_%H%M%S.json"))

    @staticmethod
    def _idle_measure():
        return {"running": False, "activity": None, "label": "", "x": None,
                "duration": 0, "elapsed": 0, "counts": 0, "started": None}

    @staticmethod
    def _empty_data():
        return {
            "background": {"samples": []},
            "compare": {"points": []},
            "shielding": {"points": []},
            "distance": {"points": []},
            "stats": {"samples": []},
            "arrivals": {"samples": []},
        }

    # ------------------------------------------------------------ dispositivo
    def connect(self):
        try:
            if self.simulated:
                self.dev = simulator.SimulatedGMC()
            else:
                self.dev = gmc.GMC(self.args.port, self.args.baud)
            with self.dev_lock:
                self.device_info = {
                    "port": self.dev.port,
                    "version": self.dev.get_version(),
                    "serial": self.dev.get_serial(),
                }
                self._load_calibration()
            self.connected = True
            self.last_error = ""
            print(f"[ok] Contador conectado: {self.device_info['version']} en {self.dev.port}")
        except Exception as e:
            self.connected = False
            if str(e) != self.last_error:  # print each new error once, not every 3 s
                print(f"[error] Could not connect to the counter: {e}", flush=True)
            self.last_error = str(e)
            if self.dev:
                self.dev.close()
            self.dev = None

    def _load_calibration(self):
        """Intenta deducir el factor CPM → µSv/h de la configuración del aparato."""
        try:
            fields = {f["name"]: f["value"] for f in gmc.decode_config(self.dev.get_config())}
            cpm, usv = fields.get("cal_cpm_0"), fields.get("cal_usv_0")
            if cpm and usv and 10 < cpm < 100000 and 0 < usv < 1000:
                factor = usv / cpm
                if 1e-4 < factor < 1e-1:
                    self.usv_per_cpm = factor
        except Exception:
            pass

    def poll_loop(self):
        next_t = time.monotonic()
        tick = 0
        while True:
            next_t += 1.0
            if not self.connected:
                self.connect()
                if not self.connected:
                    self.broadcast("tick", self._tick_payload(None))
                    time.sleep(3)
                    next_t = time.monotonic()
                    continue
            cps = None
            if self.dev_lock.acquire(timeout=0.5):
                try:
                    cps = self.dev.get_cps()
                    self.failures = 0
                except Exception as e:
                    # un segundo perdido no es una desconexión: solo se reconecta tras varios fallos seguidos
                    self.failures = getattr(self, "failures", 0) + 1
                    self.lost_seconds = getattr(self, "lost_seconds", 0) + 1
                    self.last_error = f"Lectura fallida: {e}"
                    print(f"[warn] Lost reading {self.failures}/5: {e}", flush=True)
                    if self.failures >= 5 or isinstance(e, OSError):
                        print("[error] Too many failed readings, reconnecting", flush=True)
                        self.connected = False
                        self.failures = 0
                        if not self.simulated and self.dev:
                            self.dev.close()
                            self.dev = None
                if self.connected:
                    # lecturas secundarias: si fallan no afectan a la medida
                    for every, key, fn in ((5, "cpm_device", "get_cpm"), (30, "voltage", "get_voltage"),
                                           (30, "max_cps", "get_max_cps")):
                        if tick % every == 0:
                            try:
                                self.device_info[key] = getattr(self.dev, fn)()
                            except Exception:
                                self.device_info[key] = None
                self.device_info["lost_seconds"] = getattr(self, "lost_seconds", 0)
                self.dev_lock.release()
            self.on_sample(cps)
            tick += 1
            delay = next_t - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            else:
                next_t = time.monotonic()

    # ------------------------------------------------------------ muestras
    def on_sample(self, cps):
        now = time.time()
        appended = False
        finished = False
        if cps is not None:
            self.series.append((round(now, 1), cps))
            self.window.append(cps)
            self.dose_usv += self.usv_h() / 3600.0
            with self.state_lock:
                m = self.measure
                if m["running"]:
                    m["elapsed"] += 1
                    m["counts"] += cps
                    if m["activity"] in ("background", "stats", "arrivals"):
                        self.data[m["activity"]]["samples"].append(cps)
                        appended = True
                    if m["duration"] and m["elapsed"] >= m["duration"]:
                        self._finish_measure()
                        finished = True
        self.broadcast("tick", self._tick_payload(cps, appended))
        if finished:
            self.changed()

    def cpm(self):
        n = len(self.window)
        return round(sum(self.window) * 60 / n, 1) if n else 0.0

    def usv_h(self):
        return self.cpm() * self.usv_per_cpm

    def _tick_payload(self, cps, appended=False):
        m = self.measure
        return {
            "t": time.time(), "cps": cps, "cpm": self.cpm(),
            "usvh": round(self.usv_h(), 4), "connected": self.connected,
            "measure": {"running": m["running"], "elapsed": m["elapsed"],
                        "counts": m["counts"], "duration": m["duration"]},
            "appended": appended, "version": self.version,
        }

    # ------------------------------------------------------------ actividades
    def background_rate(self):
        if self.manual_background is not None:
            return {"value": self.manual_background, "err": 0.0, "source": "manual"}
        s = self.data["background"]["samples"]
        if len(s) >= 10:
            n = sum(s)
            return {"value": n / len(s), "err": math.sqrt(max(n, 1)) / len(s), "source": "measured"}
        return {"value": simulator.BACKGROUND_CPS if self.simulated else 0.35,
                "err": 0.0, "source": "default"}

    def start_measure(self, label="", x=None, duration=0):
        with self.state_lock:
            if self.activity == "welcome":
                raise ValueError("Elige una actividad antes de medir")
            self.measure = {"running": True, "activity": self.activity, "label": label[:60],
                            "x": x, "duration": int(duration or 0), "elapsed": 0,
                            "counts": 0, "started": time.time()}
        self.changed()

    def stop_measure(self):
        with self.state_lock:
            if self.measure["running"]:
                self._finish_measure()
        self.changed()

    def _finish_measure(self):
        m = self.measure
        if m["activity"] in ("compare", "shielding", "distance") and m["elapsed"] > 0:
            self.data[m["activity"]]["points"].append({
                "label": m["label"], "x": m["x"], "counts": m["counts"],
                "seconds": m["elapsed"], "t": m["started"],
            })
        self.measure = self._idle_measure()

    def changed(self):
        with self.state_lock:
            self.version += 1
            self.save_session()
        self.broadcast("state", {"version": self.version})

    def public_state(self):
        with self.state_lock:
            return {
                "version": self.version, "activity": self.activity,
                "screen_lang": self.screen_lang, "measure": dict(self.measure),
                "data": self.data, "background_rate": self.background_rate(),
                "connected": self.connected, "simulated": self.simulated,
                "usv_per_cpm": self.usv_per_cpm, "mobile_url": self.mobile_url(), "public": bool(self.public_url),
            }

    def mobile_url(self):
        return f"{self.public_url}/view" if self.public_url else mobile_url(self.args.http_port)

    # ------------------------------------------------------------ túnel público
    def start_tunnel(self):
        """Lanza un túnel rápido de Cloudflare y publica su dirección en el QR."""
        import re
        import shutil
        import subprocess
        exe = shutil.which("cloudflared")
        if not exe:
            print("[error] No encuentro cloudflared. Instálalo con:  brew install cloudflared", flush=True)
            return
        print("[..] Abriendo túnel público con Cloudflare…", flush=True)
        proc = subprocess.Popen(
            [exe, "tunnel", "--no-autoupdate", "--url", f"http://localhost:{self.args.http_port}"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.tunnel_proc = proc
        pattern = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")

        state = {"url": None, "registered": False, "hinted": False}
        net_errors = ("dial to edge", "7844", "quic", "connection refused", "i/o timeout",
                      "unable to establish", "no such host", "context deadline exceeded")

        def hint(reason):
            if state["hinted"]:
                return
            state["hinted"] = True
            print(f"[error] {reason}\n"
                  "        Probablemente esta red bloquea el puerto 7844, que cloudflared necesita.\n"
                  "        Soluciones: conecta el Mac a la conexión compartida de un móvil y reinicia,\n"
                  "        o usa ngrok (funciona por el puerto 443): ver README, sección «Si los móviles no pueden abrir la dirección».",
                  flush=True)

        def reader():
            for line in proc.stdout:
                low = line.lower()
                if self.args.verbose:
                    print("[cloudflared]", line.rstrip(), flush=True)
                m = pattern.search(line)
                if m and not state["url"]:
                    state["url"] = m.group(0)
                    print(f"[..] Dirección asignada ({state['url']}), esperando a que Cloudflare confirme la conexión…",
                          flush=True)
                elif "registered tunnel connection" in low and state["url"] and not state["registered"]:
                    # solo ahora la dirección funciona de verdad
                    state["registered"] = True
                    self.public_url = state["url"]
                    print(f"[ok] Túnel público activo. Móviles: {self.public_url}/view", flush=True)
                    self.changed()
                elif not state["registered"] and (" err " in f" {low} " or "error" in low) \
                        and any(e in low for e in net_errors):
                    hint("cloudflared no consigue conectar con Cloudflare.")
            print("[error] El túnel se ha cerrado; el QR vuelve a la dirección local", flush=True)
            self.public_url = None
            self.changed()

        def watchdog():
            time.sleep(30)
            if proc.poll() is None and not state["registered"]:
                hint("Tras 30 s, el túnel sigue sin conexión (error 1033 en el navegador).")

        threading.Thread(target=watchdog, daemon=True).start()
        threading.Thread(target=reader, daemon=True).start()

    def start_ngrok(self):
        """Túnel con ngrok (puerto 443, pasa por redes que bloquean cloudflared). Requiere cuenta gratuita."""
        import shutil
        import subprocess
        import urllib.request
        exe = shutil.which("ngrok")
        if not exe:
            print("[error] No encuentro ngrok. Instálalo con:  brew install ngrok\n"
                  "        y registra tu token (cuenta gratuita en ngrok.com):  ngrok config add-authtoken TU_TOKEN",
                  flush=True)
            return
        print("[..] Abriendo túnel público con ngrok…", flush=True)
        proc = subprocess.Popen([exe, "http", str(self.args.http_port), "--log", "stdout"],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.tunnel_proc = proc
        log = []

        def reader():
            for line in proc.stdout:
                log.append(line)
                if self.args.verbose:
                    print("[ngrok]", line.rstrip(), flush=True)

        def waiter():
            # ngrok publica su dirección en su API local
            for _ in range(40):
                time.sleep(0.5)
                if proc.poll() is not None:
                    break
                try:
                    with urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels", timeout=1) as r:
                        tunnels = json.load(r).get("tunnels", [])
                    url = next((t["public_url"] for t in tunnels if t.get("public_url", "").startswith("https")), None)
                    if url:
                        self.public_url = url.rstrip("/")
                        print(f"[ok] Túnel público activo. Móviles: {self.public_url}/view\n"
                              "        (ngrok gratuito muestra una página de aviso la primera vez: pulsar «Visit Site»)",
                              flush=True)
                        self.changed()
                        proc.wait()
                        print("[error] El túnel de ngrok se ha cerrado; el QR vuelve a la dirección local", flush=True)
                        self.public_url = None
                        self.changed()
                        return
                except Exception:
                    pass
            text = "".join(log)
            if "authtoken" in text.lower() or "ERR_NGROK_4018" in text:
                print("[error] ngrok necesita tu token: crea una cuenta gratuita en ngrok.com y ejecuta\n"
                      "        ngrok config add-authtoken TU_TOKEN", flush=True)
            else:
                print("[error] ngrok no ha arrancado. Ejecuta con --verbose para ver su registro.", flush=True)

        threading.Thread(target=reader, daemon=True).start()
        threading.Thread(target=waiter, daemon=True).start()

    def save_session(self):
        try:
            with open(self.session_file, "w", encoding="utf-8") as f:
                json.dump({"saved": time.strftime("%Y-%m-%d %H:%M:%S"), "data": self.data,
                           "background_rate": self.background_rate()}, f, indent=1)
        except OSError:
            pass

    # ------------------------------------------------------------ difusión SSE
    def broadcast(self, event, payload):
        if event == "tick":
            self.recent_ticks.append(payload)
        msg = f"event: {event}\ndata: {json.dumps(payload)}\n\n".encode()
        with self.clients_lock:
            dead = []
            for q in self.clients:
                try:
                    q.put_nowait(msg)
                except queue.Full:
                    dead.append(q)
            for q in dead:
                self.clients.discard(q)

    # ------------------------------------------------------------ trabajos largos
    def run_job(self, name, fn):
        if not self.job["done"]:
            raise ValueError("Ya hay una operación en curso")
        self.job = {"name": name, "progress": 0, "done": False, "error": "", "result": None}

        def progress(p):
            self.job["progress"] = round(p, 3)

        def worker():
            try:
                with self.dev_lock:
                    result = fn(progress)
                # los datos binarios (historial) se guardan aparte: el estado de la tarea viaja como JSON
                if isinstance(result, (bytes, bytearray)):
                    self.history_raw = bytes(result)
                    result = {"bytes": len(result)}
                self.job["result"] = result
            except Exception as e:
                self.job["error"] = str(e)
                traceback.print_exc()
            finally:
                self.job["progress"] = 1
                self.job["done"] = True

        threading.Thread(target=worker, daemon=True).start()

    def backup_config(self, cfg=None):
        if cfg is None:
            with self.dev_lock:
                cfg = self.dev.get_config()
        name = time.strftime("config_%Y%m%d_%H%M%S.bin")
        with open(os.path.join(DATA, name), "wb") as f:
            f.write(cfg)
        return name


# ====================================================================== red
def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def mobile_url(port):
    return f"http://{local_ip()}:{port}/view"


def qr_svg(text):
    try:
        import qrcode
        import qrcode.image.svg
    except ImportError:
        return None
    img = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue()


# ====================================================================== HTTP
MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8", ".svg": "image/svg+xml",
        ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon"}

APP: App = None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if APP.args.verbose:
            super().log_message(fmt, *args)

    # ------------------------------------------------------------ utilidades
    def send_bytes(self, body, ctype, status=200, headers=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, obj, status=200):
        self.send_bytes(json.dumps(obj).encode(), "application/json", status)

    def error(self, msg, status=400):
        self.send_json({"error": msg}, status)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n))
        except json.JSONDecodeError:
            return {}

    def via_tunnel(self):
        """Peticiones reenviadas por cloudflared, ngrok u otro proxy: nunca acceden al modo profesional."""
        return any(self.headers.get(h) for h in ("Cf-Connecting-Ip", "X-Forwarded-For", "X-Forwarded-Host"))

    def authed(self, q):
        tok = self.headers.get("X-Token") or (q.get("token") or [""])[0]
        return tok in APP.tokens

    def serve_file(self, path):
        full = os.path.normpath(os.path.join(STATIC, path))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            return self.error("No encontrado", 404)
        with open(full, "rb") as f:
            self.send_bytes(f.read(), MIME.get(os.path.splitext(full)[1], "application/octet-stream"))

    # ------------------------------------------------------------ GET
    def do_GET(self):
        u = urlparse(self.path)
        p, q = u.path, parse_qs(u.query)
        try:
            if self.via_tunnel() and (p == "/pro" or p.startswith("/api/pro/")):
                return self.error("El modo profesional solo está disponible en la red local", 403)
            if p == "/":
                self.send_response(302)
                self.send_header("Location", "/view")
                self.send_header("Content-Length", "0")
                self.end_headers()
            elif p in ("/view", "/screen"):
                self.serve_file("display.html")
            elif p == "/pro":
                self.serve_file("pro.html")
            elif p == "/logo":
                for name in ("logo.svg", "logo.png"):
                    if os.path.isfile(os.path.join(STATIC, "logo", name)):
                        return self.serve_file(f"logo/{name}")
                self.serve_file("logo/placeholder.svg")
            elif p.startswith("/static/"):
                self.serve_file(p[len("/static/"):])
            elif p == "/api/stream":
                self.stream()
            elif p == "/api/ticks":
                # alternativa al streaming: los ticks posteriores a «after» (o solo el último, si after = 0)
                after = float((q.get("after") or ["0"])[0])
                ticks = list(APP.recent_ticks)
                self.send_json([x for x in ticks if x["t"] > after] if after > 0 else ticks[-1:])
            elif p == "/api/public/state":
                self.send_json(APP.public_state())
            elif p == "/api/series":
                secs = int((q.get("seconds") or ["600"])[0])
                self.send_json(list(APP.series)[-secs:])
            elif p == "/api/qr.svg":
                svg = qr_svg(APP.mobile_url())
                if svg is None:
                    return self.error("Instala el paquete qrcode", 501)
                self.send_bytes(svg, "image/svg+xml")
            elif p.startswith("/api/pro/"):
                if not self.authed(q):
                    return self.error("Sesión no válida", 401)
                self.pro_get(p[len("/api/pro/"):], q)
            else:
                self.error("No encontrado", 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            traceback.print_exc()
            self.error(str(e), 500)

    def stream(self):
        """Server-Sent Events. Cada mensaje va en su propio fragmento HTTP/1.1 (chunked):
        sin delimitar, los proxies de los túneles (Cloudflare, ngrok) retienen los datos."""
        if os.environ.get("GMC_TEST_BLOCK_SSE"):   # solo para probar el modo de consulta periódica
            time.sleep(60)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")  # no-transform: sin compresión intermedia
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        def chunk(data: bytes):
            self.wfile.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")
            self.wfile.flush()

        q = queue.Queue(maxsize=200)
        with APP.clients_lock:
            APP.clients.add(q)
        try:
            # 2 KB de relleno: algunos proxies no reenvían nada hasta acumular un mínimo
            chunk(b": " + b" " * 2048 + b"\nretry: 2000\n\n")
            while True:
                try:
                    msg = q.get(timeout=10)
                except queue.Empty:
                    msg = b": ping\n\n"
                chunk(msg)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with APP.clients_lock:
                APP.clients.discard(q)
            self.close_connection = True

    def pro_get(self, p, q):
        if p == "status":
            info = dict(APP.device_info)
            if APP.connected:
                with APP.dev_lock:
                    try:
                        info["datetime"] = APP.dev.get_datetime()
                        info["temperature"] = APP.dev.get_temperature()
                    except Exception as e:
                        info["datetime_error"] = str(e)
            self.send_json({
                "connected": APP.connected, "simulated": APP.simulated,
                "error": APP.last_error, "device": info, "dose_usv": APP.dose_usv,
                "usv_per_cpm": APP.usv_per_cpm, "ports": gmc.find_ports(),
                "sim": APP.dev.params() if APP.simulated and APP.dev else None,
                "sim_sources": list(simulator.SOURCES), "sim_materials": list(simulator.MATERIALS),
                "clients": len(APP.clients), "job": APP.job,
            })
        elif p == "config":
            if not APP.connected:
                return self.error("El contador no está conectado")
            with APP.dev_lock:
                cfg = APP.dev.get_config()
            self.send_json({"hex": cfg.hex(), "size": len(cfg), "fields": gmc.decode_config(cfg)})
        elif p == "backups":
            files = sorted(f for f in os.listdir(DATA) if f.startswith("config_"))
            self.send_json(files)
        elif p == "job":
            self.send_json(APP.job)
        elif p == "history.csv":
            rows = gmc.parse_history(APP.history_raw)
            out = "fecha,valor,unidad\n" + "\n".join(f"{a},{b},{c}" for a, b, c in rows)
            self.send_bytes(out.encode(), "text/csv", headers={
                "Content-Disposition": 'attachment; filename="historial_gmc800.csv"'})
        elif p == "history.bin":
            self.send_bytes(APP.history_raw, "application/octet-stream", headers={
                "Content-Disposition": 'attachment; filename="historial_gmc800.bin"'})
        elif p == "session.json":
            body = json.dumps(APP.public_state(), indent=1).encode()
            self.send_bytes(body, "application/json", headers={
                "Content-Disposition": 'attachment; filename="sesion_divulgacion.json"'})
        elif p == "series.csv":
            out = "unix_time,cps\n" + "\n".join(f"{t},{c}" for t, c in APP.series)
            self.send_bytes(out.encode(), "text/csv", headers={
                "Content-Disposition": 'attachment; filename="serie_cps.csv"'})
        else:
            self.error("No encontrado", 404)

    # ------------------------------------------------------------ POST
    def do_POST(self):
        u = urlparse(self.path)
        p, q = u.path, parse_qs(u.query)
        b = self.body()
        try:
            if self.via_tunnel():
                return self.error("El modo profesional solo está disponible en la red local", 403)
            if p == "/api/login":
                if secrets.compare_digest(str(b.get("password", "")), APP.password):
                    tok = secrets.token_urlsafe(16)
                    APP.tokens.add(tok)
                    return self.send_json({"token": tok})
                time.sleep(1)
                return self.error("Contraseña incorrecta", 403)
            if not p.startswith("/api/pro/"):
                return self.error("No encontrado", 404)
            if not self.authed(q):
                return self.error("Sesión no válida", 401)
            self.pro_post(p[len("/api/pro/"):], b)
        except ValueError as e:
            self.error(str(e))
        except Exception as e:
            traceback.print_exc()
            self.error(str(e), 500)

    def need_device(self):
        if not APP.connected:
            raise ValueError("El contador no está conectado")

    def pro_post(self, p, b):
        ok = {"ok": True}
        if p == "activity":
            if b.get("activity") not in ACTIVITIES:
                raise ValueError("Actividad desconocida")
            with APP.state_lock:
                if APP.measure["running"]:
                    APP._finish_measure()
                APP.activity = b["activity"]
            APP.changed()
        elif p == "screen_lang":
            APP.screen_lang = "en" if b.get("lang") == "en" else "es"
            APP.changed()
        elif p == "measure/start":
            x = b.get("x")
            APP.start_measure(str(b.get("label", "")), float(x) if x not in (None, "") else None,
                              int(b.get("duration") or 0))
        elif p == "measure/stop":
            APP.stop_measure()
        elif p == "point/delete":
            act, idx = b.get("activity"), int(b.get("index", -1))
            with APP.state_lock:
                pts = APP.data.get(act, {}).get("points")
                if pts is None or not 0 <= idx < len(pts):
                    raise ValueError("Punto no encontrado")
                pts.pop(idx)
            APP.changed()
        elif p == "activity/reset":
            act = b.get("activity")
            with APP.state_lock:
                if act not in APP.data:
                    raise ValueError("Actividad desconocida")
                if APP.measure["running"] and APP.measure["activity"] == act:
                    APP.measure = APP._idle_measure()
                APP.data[act] = App._empty_data()[act]
            APP.changed()
        elif p == "background/manual":
            v = b.get("value")
            APP.manual_background = float(v) if v not in (None, "") else None
            APP.changed()
        elif p == "settings":
            if b.get("usv_per_cpm"):
                f = float(b["usv_per_cpm"])
                if not 1e-5 < f < 1:
                    raise ValueError("Factor fuera de rango")
                APP.usv_per_cpm = f
            if b.get("reset_dose"):
                APP.dose_usv = 0.0
            APP.changed()
        elif p == "sim":
            if not APP.simulated:
                raise ValueError("Solo disponible en modo simulación")
            APP.dev.set_params(b.get("source"), b.get("distance_cm"),
                               b.get("material"), b.get("thickness_mm"))
        elif p == "device/datetime":
            self.need_device()
            with APP.dev_lock:
                ok["ok"] = APP.dev.set_datetime()
        elif p == "device/key":
            self.need_device()
            with APP.dev_lock:
                APP.dev.press_key(int(b.get("key", -1)))
        elif p in ("device/poweron", "device/poweroff", "device/reboot"):
            self.need_device()
            with APP.dev_lock:
                getattr(APP.dev, {"device/poweron": "power_on", "device/poweroff": "power_off",
                                  "device/reboot": "reboot"}[p])()
        elif p == "device/factory_reset":
            self.need_device()
            if b.get("confirm") != "BORRAR":
                raise ValueError("Escribe BORRAR para confirmar")
            ok["backup"] = APP.backup_config()
            with APP.dev_lock:
                ok["ok"] = APP.dev.factory_reset()
        elif p == "config/backup":
            self.need_device()
            ok["name"] = APP.backup_config()
        elif p == "config/write":
            self.need_device()
            changes = b.get("changes") or []  # [{offset, value}] con value 0..255
            if not changes:
                raise ValueError("No hay cambios que escribir")

            def job(progress):
                cfg = bytearray(APP.dev.get_config())
                backup = APP.backup_config(bytes(cfg))
                for c in changes:
                    off, val = int(c["offset"]), int(c["value"])
                    if not (0 <= off < len(cfg) and 0 <= val <= 255):
                        raise ValueError(f"Cambio no válido: {c}")
                    cfg[off] = val
                APP.dev.write_config(bytes(cfg), progress)
                return {"backup": backup}

            APP.run_job("config_write", job)
        elif p == "config/restore":
            self.need_device()
            name = os.path.basename(str(b.get("name", "")))
            path = os.path.join(DATA, name)
            if not name.startswith("config_") or not os.path.isfile(path):
                raise ValueError("Copia de seguridad no encontrada")
            with open(path, "rb") as f:
                cfg = f.read()
            APP.run_job("config_restore", lambda progress: APP.dev.write_config(cfg, progress))
        elif p == "history/start":
            self.need_device()
            APP.run_job("history", lambda progress: APP.dev.read_history(progress=progress))
        else:
            return self.error("No encontrado", 404)
        self.send_json(ok)


class QuietServer(ThreadingHTTPServer):
    """Ignores browsers closing connections (page reloads, closed tabs, phones going to sleep)."""
    daemon_threads = True

    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (ConnectionResetError, BrokenPipeError, ConnectionAbortedError)):
            return
        super().handle_error(request, client_address)


# ====================================================================== main
def main():
    global APP
    ap = argparse.ArgumentParser(description="Panel GMC-800 · IPARCOS-UCM")
    ap.add_argument("--sim", action="store_true", help="modo simulación (sin aparato)")
    ap.add_argument("--port", help="puerto serie (p. ej. /dev/ttyUSB0 o /dev/cu.usbserial-110)")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--http-port", type=int, default=8800)
    ap.add_argument("--password", help="contraseña del modo profesional")
    ap.add_argument("--tunnel", nargs="?", const="cloudflare", choices=["cloudflare", "ngrok"],
                    help="publica la vista móvil en internet: cloudflare (por defecto) o ngrok")
    ap.add_argument("--public-url", help="dirección pública ya existente (túnel propio, ngrok…) para el QR")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    APP = App(args)
    threading.Thread(target=APP.poll_loop, daemon=True).start()

    server = QuietServer(("0.0.0.0", args.http_port), Handler)
    ip = local_ip()
    print("\n  Panel GMC-800 · IPARCOS-UCM" + ("  [SIMULACIÓN]" if args.sim else ""))
    print(f"  Profesional: http://localhost:{args.http_port}/pro   contraseña: {APP.password}")
    print(f"  Proyección:  http://localhost:{args.http_port}/screen")
    print(f"  Móviles:     http://{ip}:{args.http_port}/view" + ("" if args.tunnel or args.public_url else "\n"))
    if APP.public_url:
        print(f"  Móviles (internet): {APP.public_url}/view\n")
    if args.tunnel == "cloudflare":
        APP.start_tunnel()
    elif args.tunnel == "ngrok":
        APP.start_ngrok()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nCerrando…")
        if APP.tunnel_proc:
            APP.tunnel_proc.terminate()
        if APP.dev:
            APP.dev.close()


if __name__ == "__main__":
    sys.exit(main())
