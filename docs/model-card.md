# CrisisSim 0.2 model card

**Intended use:** educational comparison of modeled flood response policies.
**Not intended for:** emergency forecasting, live dispatch, clinical decisions,
insurance, zoning or claims of real-world safety.

## Data

Riverton is synthetic local Cartesian geometry. Elevations, population locations,
road capacities, facility resources, costs and behavioral parameters are
generated or assumed. No Census/USGS calibration is claimed. Small profiles
simulate fewer actual people; they do not extrapolate to the reference city.

## Model and numerical verification

ANUGA DE0 hydrodynamics, explicit source operators and sampled flood/road access;
seeded individual warning/preparation behavior; capacity-constrained FIFO vehicle
packets; CP-SAT rolling-horizon response assignment; capacity-limited admission.
Benchmarks cover still water, water balances, a Ritter dam break and mesh/CFL
refinement. These are numerical checks, not real-world predictive validation.

## Equity

Neighborhood success gaps, worst-neighborhood success and finite-horizon burden
Gini are reported separately. There is no composite fairness score. Costs and
burdens are not moral valuations. Demographic intersectional fairness is not
established by these neighborhood summaries.

## Limitations

- No calibrated rainfall/runoff/river hydrograph.
- Flood states are held between output updates; smaller intervals improve
  coupling fidelity at a computational/storage cost.
- Access paths are straight off-network segments, not detailed sidewalks.
- One person per private vehicle; public transport is not pooled.
- Boat paths are restricted to inundated road corridors, not a waterway mesh.
- Interrupted rescue trips await resolution; no automatic recovery planning.
- Hospital use is an assistance abstraction, not clinical triage.
- No injury/death probabilities.
- No universal monotonic benefit from any policy is assumed.
- Optimization frontiers are approximate; uncertainty intervals omit structural
  model error and depend on explicitly chosen input distributions.

## Reproducibility

Run inputs, seed, environment, engine source checksums, per-frame checksums and
policy events are retained. Replay uses saved snapshots; checkpoint restore
recomputes. Exact equality is tested within the installed environment, not
promised across platforms, solvers or dependency changes.
