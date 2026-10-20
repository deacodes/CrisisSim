# Engine stages 1–4

These are independently tested computational components. No API, combined
scheduler, database or frontend wiring is included in this stage.

Verification on 2026-10-20: 28 tests passed, including 40 generated traffic
demand cases. Full population generation returned 78,500 unique individual
IDs in approximately 1.00 seconds on the local arm64 machine. The default
600-second flood CLI run produced 21 saved frames with a final water-balance
residual of 2.67e-8 m³. Timings are observations, not service-level guarantees.

## Reproduce

Use the existing Python 3.11 environment:

```sh
.venv/bin/python -m pytest -q
.venv/bin/python -m backend validate-city
.venv/bin/python -m backend flood
.venv/bin/python -m backend.verification
```

For a fresh Python 3.11 environment, install `requirements-engine.txt`. This pins
direct dependencies, not a cross-platform transitive lock. Verification writes
machine-readable results under ignored `runtime/verification/report.json`.

## 1. Flood calculation

`FloodModel` supports reflective, fully transmissive and prescribed-stage
top/bottom boundaries. Stage boundaries prescribe zero boundary momentum;
they are not a calibrated river discharge hydrograph. The refinement option
uses smaller triangles in a central strip. This is static local refinement,
not adaptive remeshing. On the synthetic Riverton domain it covers the channel;
arbitrary domains require their own region specification in a later extension.

The solver uses ANUGA DE0, adaptive internal timesteps, Manning friction,
rainfall, capacity-limited infiltration and drainage. Source order is rainfall,
infiltration, drainage. ANUGA removes momentum proportionally when removing
water. Drainage exits the modeled domain; there is no sewer network.

The residual is:

    final volume − initial volume − source integrals − boundary inflow integral

Output extrema and arrival times are sampled at output intervals, not every
solver substep. Queries use nearest centroids. The default city remains a
synthetic basin; selecting a different boundary is an explicit modeling choice.

Verification includes still water over sloping bed, dry-bed rainfall,
water-limited sinks, open-boundary mass balance, refinement, and a dry-bed
Ritter dam break. The latter is frictionless and observed before reflections
reach the dam. Refinement from 256 to 4,096 triangles reduced area-weighted
depth error from 0.04638 m to 0.01186 m on the tested environment.

The still-water tolerance is 1e-8 m / m/s; closed/open test-domain volume
tolerances are 1e-7 / 1e-5 m³. These are absolute small-domain regression
thresholds, not universal field-model accuracy claims. Dam-break depth error
must decrease and fall below 0.08 m; the observed error is substantially lower.
The output-interval test checks still-water invariance. A separate smooth-wave
test reduces CFL from 0.9 through 0.45 and 0.225 against a 0.1125 reference on a
fixed mesh and requires decreasing depth differences. This is numerical
evidence for that benchmark, not a universal convergence proof.

Small (256 triangles) and standard (4,096 triangles) 60-second hydrodynamic
profiles are measured by the verification command. They exclude agents and
transport and do not establish full-system real-time performance.

## 2. Evacuation agents

Individuals retain exact neighborhood population totals, seeded locations,
household IDs, mobility/transit attributes, warning/preparation times and
explicit state transitions. Marginal counts are rounded once per neighborhood,
sampled without replacement, and independent of each other. These probabilities
are assumptions, not demographic evidence.

Warnings use exponential receipt delays and preparation uses lognormal delays.
Some residents may never receive a warning. Random streams are keyed by agent
ID so adding unrelated agents does not shift existing agents' random draws.
Marginal assignment changes if a neighborhood's size changes.

Household IDs are provided, but household-coordinated routing is not implemented;
this stage selects the individual-agent representation. Self-evacuators remain
ready until the subsequent scheduler obtains a valid route. Exposure records
depth×time only—no unsupported injury or mortality inference.

## 3. Transportation

`CellLink` implements a triangular-fundamental-diagram cell-transmission model:

    sending = min(n v Δt/Δx, Q Δt)
    receiving = min((Njam − n) w Δt/Δx, Q Δt)
    interface flow = min(upstream sending, downstream receiving)

The CFL constraint is enforced. Storage limits cause spillback, rather than
merely adding an arbitrary travel-time penalty. `RoadNetwork.step` conserves
vehicle equivalents across internal junctions, admits external demand subject
to receiving space and removes traffic only at explicit exits.

Junction allocation is proportional receiving-side sharing, non-FIFO by turn.
Unspecified turns queue. Unadmitted external demand is returned to the caller's
responsibility. Vehicles are continuous equivalents; reconciling individual
travellers with these aggregate flows is part of stage 5.

Routing is a current-state shortest-path/receding-horizon approximation, not
future-perfect dynamic assignment. Road changes and traffic steps invalidate
the cache. Pedestrians use a separate assumed speed and closure threshold;
pedestrian congestion is not modeled. Flood checks sample entire polylines.
For bridges, callers must supply water depth above the deck, not channel depth.
Closed links stop existing traffic in place pending an explicit rescue/reroute
decision; they do not teleport occupants to the next intersection.

## 4. Emergency operations

Facilities provide delayed activation, bounded total and accessible capacity,
admission intervals and queues. Hospital service durations release occupied
capacity. A large clock advance processes events in chronological order.

Rolling-horizon CP-SAT dispatch respects vehicle kind (ambulance, boat, bus or
other explicit matching kinds), capacity, accessibility, feasible routed times,
priority and budget. Requests are indivisible passenger groups. Assignment
maximizes passenger-weighted priority, then minimizes time. One vehicle cannot
take two simultaneous requests and passengers cannot be submitted twice while
pending. Unreachable trips are excluded.

Deployment is charged once; operating costs accrue during travel and service.
Future trip cost is reserved against budget. Interrupted trips release unused
reservation but remain assigned, requiring the subsequent controller to resolve
them. Vehicles finish at the destination and the next assignment routes from
there; no automatic return-to-depot trip is invented.

Trip timing is based on supplied feasible routes, not geometric straight-line
distance. Callers must interrupt affected trips when conditions invalidate those
routes. This is a static travel-time approximation within a rolling horizon,
not a globally optimal dynamic vehicle-routing solver.

Facility admissions and trip delivery are separate events. The coupled
scheduler must enqueue delivered people and change their safety state only
after actual admission. A delivery alone does not imply a safe shelter place.

## Not part of this delivery

Stages 5–9: coupled scheduler/checkpoints/replay, persistence and API workers,
frontend/map integration, policy optimization/uncertainty, production reports,
security/deployment and full-system benchmarks. No component is empirically
calibrated or approved for operational emergency decisions.
