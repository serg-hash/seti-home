# SETI@Home Relay

Simulador educativo de un nodo de **búsqueda de señales extraterrestres** inspirado en [SETI@home](https://setiathome.berkeley.edu/). Analiza “work units” de radio, genera espectros tipo waterfall y clasifica candidatos (portadoras de banda estrecha, chirps, perfiles Wow!-like, RFI, etc.).

> **Importante:** es una **simulación**. No está afiliada a UC Berkeley ni a BOINC. No detecta señales reales.

![Python](https://img.shields.io/badge/Python-3.12-blue)
![Flask](https://img.shields.io/badge/Flask-3.x-black)
![Railway](https://img.shields.io/badge/Deploy-Railway-violet)

## Qué incluye

- **Centro de control** con objetivos celestes (Proxima, TRAPPIST-1, región del Wow!, …)
- **Espectro en vivo** + **waterfall** tiempo × frecuencia
- **Radar** de apuntado simulado
- **Work units** al estilo BOINC/SETI@home
- **Candidatos** con score, SNR, drift y clasificación
- API REST + UI dark sci‑fi
- Listo para **Railway** (Nixpacks, Docker, Procfile)

## Arranque local

```bash
cd seti-home
python -m venv .venv

# Windows PowerShell
.\.venv\Scripts\Activate.ps1

# macOS / Linux
# source .venv/bin/activate

pip install -r requirements.txt
python app.py
```

Abre [http://localhost:8080](http://localhost:8080).

Con Gunicorn (como en producción):

```bash
# Windows: set PORT=8080
$env:PORT=8080
gunicorn app:app --bind 0.0.0.0:8080
```

## Desplegar en Railway

### Opción A — desde GitHub (recomendada)

1. Sube este repo a GitHub.
2. En [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Elige el repositorio `seti-home`.
4. Railway detectará Python / `Procfile` / `railway.toml`.
5. Genera un dominio: **Settings → Networking → Generate Domain**.

### Opción B — Railway CLI

```bash
npm i -g @railway/cli
railway login
cd seti-home
railway init
railway up
railway domain
```

### Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------| 
| `PORT` | Puerto HTTP (Railway lo inyecta) | `8080` |
| `FLASK_DEBUG` | `1` solo en desarrollo | `0` |

No hace falta base de datos ni API keys.

### Healthcheck

- `GET /api/health` → `{ "status": "ok" }`

## API rápida

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/stats` | Estadísticas del nodo |
| `GET` | `/api/targets` | Objetivos celestes |
| `POST` | `/api/scan/start` | Inicia escaneo (`target_index` opcional) |
| `POST` | `/api/scan/stop` | Detiene escaneo |
| `GET` | `/api/scan/tick` | Trama de espectro + waterfall |
| `POST` | `/api/work-units` | Crea y procesa un work unit |
| `GET` | `/api/candidates` | Lista candidatos (`min_score`, `limit`) |
| `POST` | `/api/analyze` | Analiza muestras (`samples: number[]`) |

## Estructura

```
seti-home/
├── app.py              # Flask app + rutas API
├── signal_engine.py    # Motor de señales / candidatos
├── templates/index.html
├── static/css/style.css
├── static/js/app.js
├── requirements.txt
├── Procfile
├── railway.toml
├── Dockerfile
└── README.md
```

## Ciencia (contexto real)

El proyecto clásico SETI@home repartía datos de radiotelescopios (p. ej. Arecibo) para buscar:

- **Portadoras de banda estrecha** cerca de la línea de hidrógeno (21 cm ≈ **1420.4 MHz**)
- **Chirps** con corrección Doppler
- Eventos intensos de corta duración (el famoso **Wow! signal** de 1977)

Esta app reproduce la *estética y el flujo* de ese trabajo de forma lúdica y educativa.

## Licencia

Uso libre con fines educativos y de demostración. “SETI@home” es marca/proyecto de terceros; aquí solo se usa como inspiración.
