# Backend implementation ledger

## Repository assessment

The initial checkout was a static HTML/CSS/JavaScript application with local
Three.js and OBJ assets. It originally generated metrics with fixed policy
offsets and a sigmoid, and stored scenarios in localStorage. Those fixture
modules have now been retired. The original pages bind to backend records
through `js/app.js`; there is no server-side replacement dashboard.
See `docs/frontend-integration.md` for authoritative sources and verification.

## Integration inventory

| Surface | Required authoritative source |
|---|---|
| Scenarios / New Scenario | Persistent, versioned scenario CRUD |
| Dashboard / Command Center | Run snapshot, commands, metric series |
| Both map modes / City Model | One versioned metric geometry and object IDs |
| Equity Analysis | Full-population group aggregations, not visual samples |
| System Dynamics | Computed events and series |
| Policy Lab | Persisted multi-run experiments and optimization evaluations |
| Uncertainty | Batch jobs, seeds, distributions and failure counts |
| Reports | Immutable run configuration, metrics and artifacts |
| Settings | Local appearance; validated backend engine defaults |

## Decisions

1. Modular Python engine; numerical computation outside request handlers.
2. Prove ANUGA on the local architecture before building dependent features.
   Python 3.11 is the initial compatibility target; installed system Python 3.14
   is not assumed compatible. Docker is not installed on this host.
3. Use synthetic local meters, never the fixture's geographic bounds as genuine
   coordinates. Visual asset geometry is not authoritative terrain.
4. Verification is not empirical validation. No predictive-accuracy claims.
5. Production results must never fall back to the frontend's fixed outcomes.

## Mathematical specification

Depth h [m], velocity u [m/s], bed z [m], gravity g [m/s²]:

    ∂h/∂t + ∇·(h u) = R - I - D
    ∂(h u)/∂t + ∇·(h u⊗u + g h²/2 I₂)
      = -g h ∇z - τ_b/ρ + S_m

Rainfall, infiltration and drainage use m/s. ANUGA supplies finite-volume
shallow-water integration, bed/friction treatment and stable internal steps.
Each supported forcing must have explicit volume/momentum bookkeeping.
Road access samples computed depth along its geometry, with assumed,
configurable thresholds. Traffic/dispatch cannot use future hazard information.
Exclusive agent-state counts conserve population; facility admissions conserve
capacity. Policies alter mechanisms, never final metrics.

## Acceptance ledger

- [x] A: dependency proof, contracts and validated canonical city
- [x] B: verified flood adapter and standalone CLI
- [x] C: coupled population, transport, dispatch and facilities (documented approximations)
- [x] D: local persistence, process workers, controls, replay, APIs
- [x] E: all-page and both-map integration with browser smoke test
- [x] F: equity, comparisons, uncertainty and optimization
- [x] G: local reports, operations, benchmarks and model card
- [ ] PostgreSQL/Celery container deployment execution (Docker unavailable)
- [ ] Empirical calibration / real-world validation (not claimed)

Each item requires tests, not only code. Track incomplete capabilities explicitly.

## Stages 1–4 component delivery

The user's subsequent scope is independent flood verification, agents,
transportation and emergency operations, before coupling or services.
See `engine-stages-1-4.md` for implemented equations, contracts, tests,
assumptions and remaining coupling responsibilities.

- Implemented: reflective/open/stage boundaries and static local mesh refinement.
- Verified: still water, rainfall, sink accounting, boundary flux, dry-bed dam
  break, mesh and temporal refinement; small/standard hydrodynamic benchmarks.
- Implemented: individual population generation, warning/preparation behavior,
  explicit transitions and exposure bookkeeping.
- Implemented: conservative cell-transmission links/junctions, current-state
  routing and sampled road-level closure updates.
- Implemented: facility queues, accessible admissions, hospital service,
  constrained dispatch and budget accounting.
- At that delivery: combined coupling and D–G were pending. See below for the
  subsequent local implementation; empirical validation remains unavailable.

## Stages 5–9: local integration verification

- 35 Python tests passed, including coupled reproducibility, replay, branch
  prehistory, command idempotency, API persistence, WebSockets, experiments,
  revision conflicts and exclusion of demo scripts from every production page.
- Alembic upgrade succeeded against the local SQLite database.
- Separate Playwright-managed headless browser smoke test: 12 page visits,
  2D/3D map rendering, replay/checkpoint controls, no uncaught browser errors,
  no mobile horizontal overflow. Installed Chrome was not used for the successful
  test. Mechanical UI detector returned no findings for the changed JS/CSS.
- Coupled benchmark: 32 people / 600 simulated seconds in 0.35 wall seconds;
  800 people / 1,800 simulated seconds in 3.68 wall seconds. Peak process RSS
  about 232 MB including dependencies. These measurements exclude HTTP and UI.
- Docker, PostgreSQL and Celery deployment files exist but have not been run.
- Public multi-user authentication, S3/binary field storage and automatic
  distributed lease recovery are not implemented. Local operation does not
  require these; do not represent the deployment as a public production service.
- See `backend-operations.md` and `model-card.md` for assumptions and limitations.
