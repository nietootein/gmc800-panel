"""
Driver para contadores GQ Electronics (probado para GMC-800, protocolo GQ RFC1801).

Todas las órdenes tienen la forma <ORDEN>> y se envían por un puerto serie USB
(chip CH340, 115200 baudios en el GMC-800). Este módulo no mantiene ningún hilo
propio: el servidor serializa el acceso con un cerrojo.

ATENCIÓN: GQ no publica el mapa de configuración del GMC-800. La lectura y
escritura en bruto de la configuración funcionan con el protocolo estándar,
pero la interpretación de los campos (CONFIG_FIELDS) procede de modelos
anteriores (GMC-300/320/500) y debe verificarse con el aparato.
"""

import math
import struct
import time
import threading

try:
    import serial
    import serial.tools.list_ports
except ImportError:  # el modo simulación funciona sin pyserial
    serial = None

ACK = b"\xaa"

# Campos de configuración conocidos en modelos GQ anteriores.
# (nombre, desplazamiento, tipo, descripción). Tipos: u8, u16be, f32le
CONFIG_FIELDS = [
    ("power_on", 0, "u8", "Encendido (0 = encendido, 1 = apagado)"),
    ("alarm_on", 1, "u8", "Alarma activada"),
    ("speaker_on", 2, "u8", "Clics del altavoz activados"),
    ("backlight_timeout", 4, "u8", "Retroiluminación (índice de opción)"),
    ("alarm_cpm", 6, "u16be", "Umbral de alarma en CPM"),
    ("cal_cpm_0", 8, "u16be", "Calibración: CPM punto 0"),
    ("cal_usv_0", 10, "f32le", "Calibración: µSv/h punto 0"),
    ("cal_cpm_1", 14, "u16be", "Calibración: CPM punto 1"),
    ("cal_usv_1", 16, "f32le", "Calibración: µSv/h punto 1"),
    ("cal_cpm_2", 20, "u16be", "Calibración: CPM punto 2"),
    ("cal_usv_2", 22, "f32le", "Calibración: µSv/h punto 2"),
    ("alarm_usv", 27, "f32le", "Umbral de alarma en µSv/h"),
    ("alarm_type", 31, "u8", "Tipo de alarma (0 = CPM, 1 = µSv/h)"),
    ("save_data_type", 32, "u8", "Registro de historial (0 = no, 1 = CPS, 2 = CPM, 3 = CPM/h…)"),
]


def decode_config(cfg: bytes):
    """Interpreta los campos conocidos. Devuelve una lista de diccionarios."""
    out = []
    for name, off, typ, desc in CONFIG_FIELDS:
        try:
            if typ == "u8":
                val = cfg[off]
            elif typ == "u16be":
                val = struct.unpack(">H", cfg[off:off + 2])[0]
            elif typ == "f32le":
                val = struct.unpack("<f", cfg[off:off + 4])[0]
                val = round(val, 6) if math.isfinite(val) else None
            else:
                val = None
        except (IndexError, struct.error):
            val = None
        out.append({"name": name, "offset": off, "type": typ, "desc": desc, "value": val})
    return out


def find_ports():
    """Lista los puertos serie, marcando los que parecen un contador GQ (CH340)."""
    if serial is None:
        return []
    # USB-serial chips: STM32 native USB used by the GMC-800 (0483), WCH CH340/CH9102 (1A86),
    # Silicon Labs CP210x (10C4), FTDI (0403), Prolific (067B)
    known_vids = {0x0483, 0x1A86, 0x10C4, 0x0403, 0x067B}
    names = ("usbserial", "usbmodem", "wchusbserial", "SLAB_USBtoUART", "ttyUSB", "ttyACM")
    ports = []
    for p in serial.tools.list_ports.comports():
        likely = (p.vid in known_vids) or any(n in p.device for n in names)
        ports.append({"device": p.device, "description": p.description, "likely_gq": bool(likely)})
    ports.sort(key=lambda x: not x["likely_gq"])
    return ports


class GMCError(Exception):
    pass


class GMC:
    def __init__(self, port=None, baudrate=115200, timeout=1.0, gap=0.05):
        if serial is None:
            raise GMCError("Falta pyserial. Instálalo con: pip install pyserial")
        if port is None:
            candidates = [p for p in find_ports() if p["likely_gq"]]
            if not candidates:
                raise GMCError("No se ha encontrado ningún contador GQ. Indica el puerto con --port")
            port = candidates[0]["device"]
        self.port = port
        self.baudrate = baudrate
        self.lock = threading.RLock()
        self.gap = gap            # minimum pause between commands (s); 50 ms is enough on the GMC-800
        self.unsupported = set()  # commands the model never answers (GMC-800: GETVOLT, GETMAXCPS, GETTEMP)
        self._last_cmd = 0.0
        self.ser = serial.Serial(port, baudrate=baudrate, timeout=timeout)
        time.sleep(0.2)
        self._flush()

    # ------------------------------------------------------------ bajo nivel
    def _flush(self):
        self.ser.reset_input_buffer()

    def _send(self, cmd: bytes):
        """Respeta la pausa mínima entre órdenes, vacía la entrada y envía <cmd>>."""
        wait = self.gap - (time.monotonic() - self._last_cmd)
        if wait > 0:
            time.sleep(wait)
        self._flush()
        self.ser.write(b"<" + cmd + b">>")
        self.ser.flush()

    def _cmd(self, cmd: bytes, nbytes: int = 0, timeout: float = 1.0) -> bytes:
        """Envía <cmd>> y lee exactamente nbytes (o lo que llegue antes del timeout)."""
        with self.lock:
            try:
                self._send(cmd)
                if nbytes == 0:
                    return b""
                self.ser.timeout = timeout
                return self.ser.read(nbytes)
            finally:
                self._last_cmd = time.monotonic()

    def _cmd_exact(self, cmd: bytes, nbytes: int, timeout: float = 1.0) -> bytes:
        """Como _cmd, pero lanza GMCError con detalles si la respuesta no está completa."""
        t0 = time.monotonic()
        d = self._cmd(cmd, nbytes, timeout)
        if len(d) != nbytes:
            raise GMCError(f"Respuesta incompleta a {cmd.decode()}: {len(d)} de {nbytes} bytes "
                           f"({d.hex() or 'nada'}) en {time.monotonic() - t0:.2f} s")
        return d

    def _cmd_until_idle(self, cmd: bytes, maxbytes: int = 1024, idle: float = 0.3) -> bytes:
        """Para respuestas de longitud variable: lee hasta que el puerto queda en silencio."""
        with self.lock:
            try:
                self._send(cmd)
                data = b""
                self.ser.timeout = idle
                t0 = time.monotonic()
                while len(data) < maxbytes and time.monotonic() - t0 < 5:
                    chunk = self.ser.read(maxbytes - len(data))
                    if not chunk:
                        break
                    data += chunk
                return data
            finally:
                self._last_cmd = time.monotonic()

    def _cmd_ack(self, cmd: bytes, timeout: float = 2.0) -> bool:
        return self._cmd(cmd, 1, timeout) == ACK

    # ------------------------------------------------------------ lectura
    def get_version(self) -> str:
        return self._cmd_until_idle(b"GETVER", 32).decode("ascii", "replace").strip("\x00 ")

    def get_serial(self) -> str:
        return self._cmd(b"GETSERIAL", 7).hex().upper()

    def get_cps(self) -> int:
        return struct.unpack(">I", self._cmd_exact(b"GETCPS", 4))[0] & 0x3FFFFFFF

    def get_cpm(self) -> int:
        return struct.unpack(">I", self._cmd_exact(b"GETCPM", 4))[0] & 0x3FFFFFFF

    def _optional(self, cmd: bytes, read):
        """Optional command: if it does not answer once, it is not sent again
        (each unanswered command blocks the port until its timeout)."""
        if cmd in self.unsupported:
            return None
        val = read()
        if val is None:
            self.unsupported.add(cmd)
        return val

    def get_max_cps(self):
        def read():
            d = self._cmd(b"GETMAXCPS", 4, timeout=0.5)
            return struct.unpack(">I", d)[0] & 0x3FFFFFFF if len(d) == 4 else None
        return self._optional(b"GETMAXCPS", read)

    def get_voltage(self):
        def read():
            d = self._cmd_until_idle(b"GETVOLT", 8)
            if len(d) == 1:
                return d[0] / 10.0
            try:
                return float(d.decode("ascii").lower().replace("v", "").strip("\x00 "))
            except ValueError:
                return None
        return self._optional(b"GETVOLT", read)

    def get_temperature(self):
        def read():
            d = self._cmd(b"GETTEMP", 4, timeout=0.5)
            if len(d) != 4:
                return None
            val = d[0] + d[1] / 10.0
            return -val if d[2] else val
        return self._optional(b"GETTEMP", read)

    def get_datetime(self):
        d = self._cmd(b"GETDATETIME", 7)
        if len(d) != 7:
            return None
        y, mo, da, h, mi, s = d[:6]
        return f"20{y:02d}-{mo:02d}-{da:02d} {h:02d}:{mi:02d}:{s:02d}"

    def get_config(self) -> bytes:
        cfg = self._cmd_until_idle(b"GETCFG", 512)
        if len(cfg) < 256:
            raise GMCError(f"Configuración incompleta ({len(cfg)} bytes)")
        return cfg

    # ------------------------------------------------------------ escritura
    def set_datetime(self, t=None) -> bool:
        t = time.localtime() if t is None else t
        payload = bytes([t.tm_year % 100, t.tm_mon, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec])
        return self._cmd_ack(b"SETDATETIME" + payload)

    def write_config(self, cfg: bytes, progress=None) -> bool:
        """Borra la configuración y la reescribe entera (procedimiento estándar de GQ)."""
        two_byte_addr = len(cfg) > 256
        with self.lock:
            if not self._cmd_ack(b"ECFG", 3):
                raise GMCError("El aparato no confirmó el borrado de la configuración (ECFG)")
            for i, b in enumerate(cfg):
                addr = struct.pack(">H", i) if two_byte_addr else bytes([i])
                if not self._cmd_ack(b"WCFG" + addr + bytes([b]), 1):
                    raise GMCError(f"Fallo al escribir el byte {i}")
                if progress and i % 32 == 0:
                    progress(i / len(cfg))
            ok = self._cmd_ack(b"CFGUPDATE", 3)
            if progress:
                progress(1.0)
            return ok

    def press_key(self, n: int) -> None:
        if n not in (0, 1, 2, 3):
            raise GMCError("Tecla no válida")
        self._cmd(b"KEY" + bytes([n]))

    def power_on(self):
        self._cmd(b"POWERON")

    def power_off(self):
        self._cmd(b"POWEROFF")

    def reboot(self):
        self._cmd(b"REBOOT")

    def factory_reset(self) -> bool:
        return self._cmd_ack(b"FACTORYRESET", 5)

    # ------------------------------------------------------------ historial
    def read_history(self, max_bytes=1 << 20, page=4096, progress=None) -> bytes:
        """Lee la memoria flash de historial hasta encontrar una página vacía (0xFF)."""
        data = b""
        addr = 0
        while addr < max_bytes:
            cmd = b"SPIR" + struct.pack(">I", addr)[1:] + struct.pack(">H", page)
            chunk = self._cmd(cmd, page, timeout=5)
            if not chunk:
                break
            data += chunk
            addr += page
            if progress:
                progress(addr / max_bytes)
            if chunk.count(0xFF) == len(chunk):
                break
        return data.rstrip(b"\xff")

    def close(self):
        try:
            self.ser.close()
        except Exception:
            pass


def parse_history(raw: bytes):
    """
    Convierte el historial en bruto en filas (fecha, cuentas, unidad).
    Formato GQ: cada byte es un dato; 55 AA 00 marca fecha/hora y modo,
    55 AA 01 indica un dato de dos bytes, 55 AA 02 una nota de texto.
    Interpretación experimental: compárala con GQ Data Viewer.
    """
    import datetime as dt
    rows = []
    i = 0
    stamp = None
    step = 1
    unit = "CPS"
    steps = {0: (0, "off"), 1: (1, "CPS"), 2: (60, "CPM"), 3: (3600, "CPM/h"),
             4: (1, "CPS"), 5: (60, "CPM"), 6: (3600, "CPM/h")}
    n = len(raw)
    while i < n:
        if raw[i] == 0x55 and i + 2 < n and raw[i + 1] == 0xAA:
            kind = raw[i + 2]
            if kind == 0x00 and i + 12 <= n:
                y, mo, d, h, mi, s = raw[i + 3:i + 9]
                mode = raw[i + 11]
                try:
                    stamp = dt.datetime(2000 + y, mo, d, h, mi, s)
                except ValueError:
                    stamp = None
                step, unit = steps.get(mode, (1, "?"))
                i += 12
                continue
            if kind == 0x01 and i + 5 <= n:
                val = (raw[i + 3] << 8) | raw[i + 4]
                rows.append((stamp.isoformat() if stamp else "", val, unit))
                if stamp and step:
                    stamp += dt.timedelta(seconds=step)
                i += 5
                continue
            if kind == 0x02 and i + 4 <= n:
                length = raw[i + 3]
                i += 4 + length
                continue
        rows.append((stamp.isoformat() if stamp else "", raw[i], unit))
        if stamp and step:
            stamp += dt.timedelta(seconds=step)
        i += 1
    return rows
