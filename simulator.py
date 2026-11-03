"""
Contador simulado con la misma interfaz que gmc.GMC.

Genera cuentas de Poisson a partir de un modelo sencillo:
    tasa = fondo + S · (d_ref / d)² · exp(−μ · x)
con S la tasa de la fuente a la distancia de referencia, d la distancia,
μ el coeficiente de atenuación del material y x su espesor.
Los valores son orientativos para un tubo M4011, no medidas reales.
"""

import math
import random
import struct
import time
from collections import deque

BACKGROUND_CPS = 0.35  # ≈ 21 CPM, típico del M4011 a nivel del mar
REF_DISTANCE_CM = 5.0

# Tasa neta aproximada (cps) a 5 cm del tubo
SOURCES = {
    "none": 0.0,
    "cs137": 35.0,
    "co60": 28.0,
    "na22": 22.0,
    "am241": 1.5,
    "ra226": 45.0,
    "uraninite": 60.0,
    "thorium_rod": 14.0,
    "mantle": 5.0,
    "uranium_glass": 3.0,
    "potassium_salt": 0.8,
}

# Coeficiente efectivo de atenuación (1/mm), muy simplificado
MATERIALS = {
    "none": 0.0,
    "paper": 0.004,
    "aluminium": 0.02,
    "steel": 0.05,
    "lead": 0.12,
}


def poisson(lam):
    if lam <= 0:
        return 0
    if lam > 50:
        return max(0, int(round(random.gauss(lam, math.sqrt(lam)))))
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= random.random()
        if p <= L:
            return k
        k += 1


class SimulatedGMC:
    port = "simulación"
    baudrate = 0

    def __init__(self):
        self.source = "none"
        self.distance_cm = REF_DISTANCE_CM
        self.material = "none"
        self.thickness_mm = 0.0
        self.history = deque(maxlen=60)
        self.max_cps = 0
        self.cfg = bytearray(b"\xff" * 512)
        self.cfg[0:3] = bytes([0, 0, 1])
        self.cfg[6:8] = struct.pack(">H", 1000)
        self.cfg[8:10] = struct.pack(">H", 153)
        self.cfg[10:14] = struct.pack("<f", 1.0)
        self.cfg[32] = 2

    def params(self):
        return {"source": self.source, "distance_cm": self.distance_cm,
                "material": self.material, "thickness_mm": self.thickness_mm}

    def set_params(self, source=None, distance_cm=None, material=None, thickness_mm=None):
        if source in SOURCES:
            self.source = source
        if material in MATERIALS:
            self.material = material
        if distance_cm is not None:
            self.distance_cm = max(0.5, float(distance_cm))
        if thickness_mm is not None:
            self.thickness_mm = max(0.0, float(thickness_mm))

    def rate(self):
        s = SOURCES[self.source] * (REF_DISTANCE_CM / self.distance_cm) ** 2
        s *= math.exp(-MATERIALS[self.material] * self.thickness_mm)
        return BACKGROUND_CPS + s

    # --- interfaz equivalente a GMC
    def get_cps(self):
        c = poisson(self.rate())
        self.history.append(c)
        self.max_cps = max(self.max_cps, c)
        return c

    def get_cpm(self):
        n = len(self.history)
        return int(sum(self.history) * 60 / n) if n else 0

    def get_max_cps(self):
        return self.max_cps

    def get_version(self):
        return "GMC-800Re1.00 (simulado)"

    def get_serial(self):
        return "00000000000000"

    def get_voltage(self):
        return 4.1

    def get_temperature(self):
        return None

    def get_datetime(self):
        return time.strftime("%Y-%m-%d %H:%M:%S")

    def get_config(self):
        return bytes(self.cfg)

    def set_datetime(self, t=None):
        return True

    def write_config(self, cfg, progress=None):
        time.sleep(0.5)
        self.cfg = bytearray(cfg)
        if progress:
            progress(1.0)
        return True

    def press_key(self, n):
        pass

    def power_on(self):
        pass

    def power_off(self):
        pass

    def reboot(self):
        pass

    def factory_reset(self):
        return True

    def read_history(self, max_bytes=0, page=0, progress=None):
        now = time.localtime()
        head = bytes([0x55, 0xAA, 0x00, now.tm_year % 100, now.tm_mon, now.tm_mday,
                      now.tm_hour, now.tm_min, now.tm_sec, 0x55, 0xAA, 0x02])
        body = bytes(poisson(BACKGROUND_CPS * 60) for _ in range(120))
        if progress:
            progress(1.0)
        return head + body

    def close(self):
        pass
