# Coupled backend: operation and limitations

## Local startup

Python 3.11 is required for the tested numerical environment. Install the pinned
dependency set in `requirements-backend.lock`, then:

```sh
.venv/bin/python -m uvicorn backend.api:app --host 127.0.0.1 --port 8010
```

Visit `/new-scenario.html`, save a scenario, and run it from `/scenarios.html`.
The default profile is 800 actual individual residents, not 78,500 extrapolated
residents. The server rejects configurations above 50 million agent ticks.
Two local numerical worker processes execute at most two jobs concurrently.
At most four jobs may be pending through the ordinary single-user workflow.

The service is local single-user software. Do not expose it publicly. Host and
Origin checks protect local usage; they are not account authentication. A remote
deployment requires an authenticated gateway and an ownership model first.

## Computation

The ANUGA generator advances to the next output boundary; agent/traffic ticks
then advance using the previously known hazard field. Future hydrodynamic data
is not consulted for evacuation decisions. Boundary conditions and synthetic
assumptions are documented in `engine-stages-1-4.md`.

Private self-evacuators are individual vehicle packets in FIFO traffic cells.
Packets consume integer sending/receiving credits derived from the CTM supply
and demand bounds. One person is one private vehicle. This intentionally differs
from the continuous-vehicle-equivalent component tests from stage 3.

Access to road nodes takes walking time and is blocked by local flood conditions.
Off-road path geometry is a straight access segment, not a sidewalk network.
Emergency trips use current road travel-time estimates, and interruptions stop
them when a required path becomes unavailable. Busy interrupted resources
remain unresolved rather than silently teleporting or redispatching passengers.
Boats use inundated road corridors and require nearby pickup access. They are
not a complete navigable-waterway search model.

Public transport requests are currently individual; vehicle capacities are
enforced but compatible passengers are not pooled into optimized shared trips.
Medical assistance is a modeled accessibility service, not a medical triage
or injury forecast. Hospital admission counts as safe. If a refuge floods while
an agent remains there, its safety state returns to rescue-needed.

## Pause, replay and branches

Pause/cancel requests take effect at saved output boundaries. They do not alter
past snapshots. WebSocket notifications provide sequence numbers and URLs for
authoritative full snapshots; reconnect fetches the latest snapshot. This is
bounded/coalesced notification delivery, not per-agent frame-rate networking.

Replay fetches immutable recorded frames. Checkpoints contain an input recipe,
model version, policy history and snapshot checksum. Restore recomputes from
the beginning; this is tested against saved results. It is NOT a binary ANUGA
restart. Changing prioritization is supported as a branch at a saved boundary.
Other hazard/resource edits require a new scenario/run, not a retroactive edit.

The renderer uses saved positions; it does not invent smooth travel between
snapshots that could cut across roads. Terrain, depth, facilities and routes use
the same metric city in both map modes. A six-hour forecast or demographic
vulnerability layer is not fabricated.

## Persistence and experiments

SQLAlchemy stores versioned records and immutable run inputs. Local SQLite
bootstraps the schema; Alembic provides the deployment migration. PostgreSQL is
supported, with PostGIS enabled by the migration, but current geometry artifacts
are JSON rather than spatially indexed tables. Do not claim spatial SQL queries.

Artifacts are atomically published local JSON files with SHA-256 checksums.
Large geospatial binary/chunked storage and an S3 adapter are not implemented.
The current small profiles use separately fetched mesh/field files, not repeated
fields in WebSocket messages. Object storage is a future scaling change.

Policy comparison uses matched seeds. Monte Carlo uses Latin hypercube sampling
over independent rainfall and warning-delay distributions, plus varied behavior
seeds. It reports empirical 5/50/95% quantiles, not confidence intervals.
Morris screening uses its required sampling design and a fixed behavior seed.
NSGA-II searches integer/binary policy variables, retains a frontier and evaluates
up to two finalists using a held-out seed. Its frontier is approximate.

Experiment inputs are limited to 2,000 residents and two hours; evaluation
counts and a ten-minute wall-clock budget are bounded. Failed evaluations are
recorded and fail the job rather than being silently omitted from statistics.

## Recovery, backups and retention

Stop work or pause runs before backing up `runtime/`. Preserve both the database
and artifact tree. Never delete the artifact directory independently of metadata.
Completed outputs have checksums in each run's manifest. Runtime artifacts are
ignored by Git. There is no automatic retention deletion.

After a local API restart, previously active jobs become `interrupted`. Retry
explicitly recomputes from immutable inputs. Atomic queued→running claims stop
duplicate delivery executing the same job twice. If a Celery worker dies, a
running claim may need operator recovery after confirming that worker is dead;
automatic lease expiry is not implemented.

Each run records heartbeat, error, timing, package versions, source revision and
engine file checksums. `/api/v1/health` confirms API availability, not numerical
validation or a fully healthy remote worker cluster.

## Docker / PostgreSQL / Celery

Docker is not installed on the development host. These deployment files are
provided but have not been executed here:

```sh
cp .env.example .env
# Replace the placeholder password before starting.
docker compose up --build
```

The Compose port binds only to loopback. Database and Redis have no published
ports. Alembic runs before API startup; Celery starts after API health succeeds.
The shared artifact volume is required. Do not use this configuration as an
unauthenticated public service.

## Verification commands

```sh
.venv/bin/python -m pytest -q
.venv/bin/python -m backend.verification
.venv/bin/python -m backend run
# With the service running; requires Playwright and local Google Chrome:
.venv/bin/python tests/browser_smoke.py http://127.0.0.1:8010 --allow-browser
```

No empirical calibration, official safety thresholds, clinical conclusions or
real-world accuracy claims are made. The application is educational decision
support using a synthetic city.

Browser testing requires explicit permission. The earlier local Chrome attempt
did not complete and disrupted the user's browser. Following explicit permission,
the successful test used a separate Playwright-managed headless browser and a
temporary profile, not installed Chrome. The script requires an opt-in flag.
Its workflow covered scenario creation, a completed run, both map modes, map
controls, checkpoint/replay, 12 page visits and a mobile layout without horizontal
overflow. No uncaught browser errors were recorded. This is a smoke test, not
exhaustive accessibility or cross-browser certification.
