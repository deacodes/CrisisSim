# CrisisSim

**Simulate disasters. Compare strategies. Plan fairer responses.**

CrisisSim is a synthetic-city flood-response simulation platform for testing evacuation policies, analyzing emergency resource usage, and comparing safety, efficiency, and equity outcomes.

## Features

- Interactive 3D city and flood visualization
- Customizable flood and evacuation scenarios
- Evacuation and emergency resource analysis
- Policy comparison and equity evaluation
- Persistent simulation results and reports

## Setup

**Requirements:** Python 3.11 and a modern web browser.

### 1. Create a virtual environment

```bash
python3.11 -m venv .venv
source .venv/bin/activate
```

Skip this step if you already have a working `.venv`.

### 2. Install dependencies

```bash
python -m pip install -r requirements-backend.lock
```

### 3. Start the application

```bash
python -m uvicorn backend.api:app --host 127.0.0.1 --port 8010
```

Open **http://127.0.0.1:8010** in your browser.

## How to Use

1. **Create:** Open Scenarios and configure rainfall, warning time, resources, and response policy.
2. **Save:** Save your scenario configuration.
3. **Run:** Click **Run** to execute the simulation.
4. **Explore:** Use the Command Center to visualize evacuation and flood outcomes.
5. **Analyze:** Review resource usage, policy comparisons, and equity metrics.

## Testing

Run the following commands from the project directory:

```bash
python -m pytest -q
python -m backend run
python -m backend.verification
```

## Technical Details

- **Backend:** Python, FastAPI
- **Simulation:** Numerical flood and evacuation modeling
- **Visualization:** JavaScript, Three.js
- **Database:** SQLite
- **Execution:** Separate processes for numerical jobs
- **Storage:** Persistent metadata and checksummed results in `runtime/`

## Disclaimer

CrisisSim uses a synthetic city for educational decision support. It is not an official emergency forecast or dispatch system.

**Developed independently for the Eureka Dev Hackathon 2026
