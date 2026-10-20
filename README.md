# CrisisSim

CrisisSim is a synthetic-city flood-response prototype for comparing evacuation policies, resource load, and equity outcomes.

## Run the functioning local backend

Use the existing isolated environment, or create a Python 3.11 environment and
install `requirements-backend.lock` (the pinned dependency set).

```bash
.venv/bin/python -m uvicorn backend.api:app --host 127.0.0.1 --port 8010
```

Open `http://127.0.0.1:8010`. Create a scenario, save it, and click **Run**.
The backend-served pages use computed results only. The local default is a
SQLite database with numerical jobs in separate processes. Metadata and
checksummed results persist in `runtime/`.

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m backend run
.venv/bin/python -m backend.verification
```

API documentation: `http://127.0.0.1:8010/docs`.

See `docs/backend-operations.md` for controls, model limitations, Docker,
backup/recovery and verification status.

## Frontend previews

The original HTML pages now bind directly to the numerical backend. The API
serves the same files unchanged; there is no alternate dashboard or mock-data
fallback. Open through HTTP rather than double-clicking an HTML file.

You can also use an editor preview or a static server while the backend runs:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/command-center.html`.

On local preview ports 3000, 5500, 8000 and 8001, the frontend connects to the
backend at `http://127.0.0.1:8010`. CORS and WebSocket origins are explicitly
restricted to local development origins. If the backend is offline, pages show
a connection error—not illustrative outcomes. Prefer the backend URL for the
simplest single-origin setup.

## Map modes

Choose the default map renderer in **Settings → Map Rendering Mode**:

- **3D City Simulation** — Riverton OBJ assets placed on the numerical terrain,
  recorded water surfaces and agent/resource positions, with orbit/pan/zoom controls.
- **2D Operations Map** — an SVG rendering of the same computed snapshot.

The original OBJ models and shared material file live in `assets/riverton-obj-assets/`.

Policy Lab and Uncertainty follow experiment-specific WebSocket updates, with
HTTP polling if WebSockets fail. Completed jobs use saved results without
opening a socket. Configuration and reports are backend-persisted; only display
preferences and selected record IDs are stored in the browser.
