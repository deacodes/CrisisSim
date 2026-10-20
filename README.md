# CrisisSim

CrisisSim is a synthetic-city flood-response prototype for comparing evacuation policies, resource load, and equity outcomes.

## Run locally

The 3D Command Center loads local OBJ assets through browser modules, so open the project through a local server rather than double-clicking an HTML file.

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/command-center.html`.

## Map modes

Choose the default map renderer in **Settings → Map Rendering Mode**:

- **3D City Simulation** — original Riverton OBJ assets, flood expansion, moving evacuation agents, and orbit/pan/zoom controls.
- **2D Operations Map** — the existing tactical SVG overview for faster, lower-overhead review.

The original OBJ models and shared material file live in `assets/riverton-obj-assets/`.
