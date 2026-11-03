# Panel GMC-800 · IPARCOS-UCM

Interfaz para el contador Geiger GQ GMC-800 con tres vistas:

| Vista | Dirección | Para qué |
|---|---|---|
| Profesional | `http://localhost:8800/pro` | Datos en directo, control de actividades, aparato y configuración. Con contraseña. |
| Proyección | `http://localhost:8800/screen` | Pantalla del aula: detector animado, actividad y código QR. |
| Móviles | `http://IP-DEL-ORDENADOR:8800/view` | Lo que ven los participantes al escanear el QR. Solo lectura. |

## Instalación (una sola vez)

Necesitas Python 3.9 o posterior (en macOS: `brew install python` o el instalador de python.org).

```bash
cd gmc800-panel
python3 -m pip install -r requirements.txt
```

### Solo en Linux
1. Permiso para usar el puerto serie (luego cierra sesión y vuelve a entrar):
   `sudo usermod -aG dialout $USER`
2. En Ubuntu, el servicio de braille `brltty` secuestra el chip USB del contador (CH340). Desinstálalo si no lo usas:
   `sudo apt remove brltty`

## Uso

```bash
python3 server.py --password MiClave          # con el contador conectado por USB
python3 server.py --sim --password MiClave    # simulación, sin aparato
```

Al arrancar se muestran en la terminal las tres direcciones. Si no indicas `--password`, se genera una al azar y aparece ahí.

Otras opciones: `--port /dev/ttyUSB0` (o `/dev/cu.usbserial-XXXX` en Mac) si no detecta el contador solo, `--http-port 8800`, `--baud 115200`.

### Durante la actividad
1. Abre `/pro` en tu ordenador y `/screen` en el proyector (pantalla completa con F11 o Ctrl+Cmd+F).
2. Los participantes escanean el QR de la proyección.
3. En `/pro` → Actividad, eliges qué se muestra y lanzas cada medida. Proyección y móviles cambian a la vez.

Los datos de cada sesión se guardan automáticamente en `data/`.

## Actividades

- **Presentación:** medida en directo, sin guardar datos.
- **Fondo:** mide sin fuentes. Su media se resta en las demás actividades (o fija un valor a mano).
- **Comparar muestras:** una barra por muestra con su incertidumbre.
- **Blindaje:** mide primero con espesor 0 y después con láminas. Ajuste exponencial y capa hemirreductora por material.
- **Distancia:** ajuste a 1/r² y exponente libre en escala log-log.
- **Estadística:** histograma comparado con la distribución de Poisson. Usa una fuente débil (1–5 cps) y mide al menos 5 minutos.

Consejos: con la uraninita y la fuente de radio no acerques demasiado el tubo, porque puede saturarse. El americio-241 apenas se detecta (el tubo M4011 no ve las alfa).

## El logo

Copia el logo del IPARCOS como `static/logo/logo.svg` o `static/logo/logo.png` (mejor con fondo transparente). Aparece solo, sin reiniciar.

## Si los móviles no pueden abrir la dirección

Muchas redes (eduroam, redes de centros) aíslan los dispositivos entre sí, y los móviles con datos nunca ven la red local. La solución es publicar la vista móvil en internet con un túnel de Cloudflare (gratuito, sin cuenta):

```bash
brew install cloudflared                      # una sola vez
python3 server.py --password MiClave --tunnel
```

En unos segundos aparece en la terminal una dirección `https://….trycloudflare.com/view`, y el QR de la proyección cambia solo a ella. Funciona desde cualquier móvil, con wifi o con datos.

- Por el túnel solo se puede **ver**: el modo profesional responde «solo disponible en la red local». Tú sigues usando `http://localhost:8800/pro`.
- La dirección cambia cada vez que arrancas el servidor; el QR se actualiza solo.
- El ordenador necesita internet. El QR solo cambia cuando Cloudflare confirma la conexión.
- **Error 1033 o aviso «cloudflared no consigue conectar»:** la red bloquea el puerto 7844 que usa cloudflared (frecuente en redes universitarias). Dos salidas:
  - Usar **ngrok**, que va por el puerto 443. Una sola vez: `brew install ngrok`, crea una cuenta gratuita en ngrok.com y ejecuta `ngrok config add-authtoken TU_TOKEN`. Después: `python3 server.py --password MiClave --tunnel ngrok`. La versión gratuita muestra a cada visitante una página de aviso la primera vez («Visit Site»).
  - Conectar el Mac a la conexión compartida de un móvil y usar Cloudflare.
- Si un proxy retiene el tiempo real, cada pantalla lo detecta y pasa sola a consultar al servidor cada segundo (tarda unos 6 s en cambiar). No hay que hacer nada.
- El error 1033 también aparece si abres una dirección de una sesión anterior: la dirección cambia en cada arranque.
- Si ya tienes otro túnel (ngrok, un túnel propio de Cloudflare…), indica su dirección con `--public-url https://…`.

Si prefieres no usar internet, crea un punto de acceso desde el ordenador y pide a los participantes que se conecten a él:
- **macOS:** Ajustes → General → Compartir → Compartir Internet.
- **Linux (GNOME):** Ajustes → Wi-Fi → menú ⋮ → Activar punto de acceso.

Antes de descartar la red local, comprueba también el cortafuegos de macOS (Ajustes → Red → Cortafuegos): si al arrancar el servidor pulsaste «Denegar» en el aviso de conexiones entrantes, ningún dispositivo podrá conectarse.

## Primera conexión con el aparato real: qué comprobar

El código se ha probado en simulación. Con el GMC-800 delante, comprueba en este orden:

1. Que en `/pro` → Aparato aparezcan modelo, número de serie, batería y hora.
2. Que los CPS de la interfaz coincidan con la pantalla del contador.
3. A qué tecla física corresponde cada botón de «Teclas a distancia».
4. **Antes de escribir nada en la configuración:** pulsa «Guardar copia». Los nombres de los campos proceden de modelos anteriores de GQ y pueden no coincidir en el GMC-800; si alguno no cuadra, ajusta la tabla `CONFIG_FIELDS` en `gmc.py`.
5. Lee el historial y compáralo con GQ Data Viewer.

## Estructura

```
server.py       servidor web, actividades y tiempo real
gmc.py          comunicación con el contador (protocolo GQ)
simulator.py    contador simulado
static/         interfaz web (sin dependencias externas: funciona sin internet)
data/           sesiones y copias de configuración
```
