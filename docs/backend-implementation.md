# Backend implementation ledger

## Repository assessment

The initial checkout is a static HTML/CSS/JavaScript application with local
Three.js and OBJ assets. No API, worker, database, dependency manifest, or tests
exist. `js/state.js` generates metrics with fixed policy offsets and a sigmoid;
scenario storage is localStorage. `js/data.js` contains synthetic fixtures.
The 3D renderer subscribes to this illustrative state. Preserve this frontend
until a verified backend adapter is ready; do not silently present it as computed.

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

- [ ] A: dependency proof, contracts and validated canonical city
- [ ] B: verified flood adapter and standalone CLI
- [ ] C: coupled population, transport, dispatch and facilities
- [ ] D: persistence, workers, controls, replay, APIs
- [ ] E: all-page and both-map integration
- [ ] F: equity, comparisons, uncertainty and optimization
- [ ] G: reports, operations, benchmarks and model card

Each item requires tests, not only code. Track incomplete capabilities explicitly.
