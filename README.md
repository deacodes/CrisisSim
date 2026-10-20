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

## Original static frontend demo

The 3D Command Center loads local OBJ assets through browser modules, so open the project through a local server rather than double-clicking an HTML file.

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/command-center.html`.

This static server cannot run the backend. Its pages are explicitly labeled
illustrative; use the backend command above for actual calculations.

## Map modes

Choose the default map renderer in **Settings → Map Rendering Mode**:

- **3D City Simulation** — original Riverton OBJ assets, flood expansion, moving evacuation agents, and orbit/pan/zoom controls.
- **2D Operations Map** — the existing tactical SVG overview for faster, lower-overhead review.

The original OBJ models and shared material file live in `assets/riverton-obj-assets/`.
