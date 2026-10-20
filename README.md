# CrisisSim: A Fairness-Aware Emergency-Response Digital Twin

> **Primary Product Statement:**  
> *Test fairer emergency-response strategies before disasters happen.*

> **Official Notice & Disclaimer:**  
> *CrisisSim uses a synthetic, data-calibrated city for educational decision support. It is not an official emergency forecast or dispatch system.*

---

## 🌊 Overview

**CrisisSim** is a professional emergency operations and climate-resilience digital twin designed for municipal decision-makers, emergency planners, and climate resilience researchers. The flagship scenario models a high-severity riverine flood evacuation across the synthetic metropolitan area of **Riverton**.

Unlike conventional evacuation tools that measure only aggregate speed and cost, CrisisSim incorporates **spatial demographic equity**. It exposes critical bottlenecks—such as structural bridge closures that disproportionately trap transit-dependent, elderly, or low-income residents—and allows operators to test targeted interventions (auxiliary shelter activation, pontoon bypasses, prioritized amphibious rescue boats, and dedicated municipal transit shuttles).

---

## 🚀 Quick Start (Zero Build Friction)

CrisisSim is built with clean, modern, zero-dependency HTML5, CSS3, and JavaScript. It runs immediately in any modern browser without needing complex npm builds, heavy bundlers, or external API keys.

### Option 1: Direct Browser Launch
Simply double-click or open `index.html` in Chrome, Safari, Firefox, or Edge.

### Option 2: Local HTTP Server (Recommended)
```bash
# Using Python 3
python3 -m http.server 3000

# Or using Node npx
npx serve .
```
Then navigate to: **`http://localhost:3000`**

---

## 🗺️ Application Architecture & Multi-Page Navigation

CrisisSim features a persistent left navigation rail and top header with synchronized simulation states across 12 distinct operational pages:

| Page Route | File | Key Functions |
|---|---|---|
| **Dashboard** | `index.html` | High-level situational awareness, 4 primary KPIs, compact city map preview, 24h progress trend chart, critical incident alerts. |
| **Scenarios Library** | `scenarios.html` | Full case management with search, hazard filters, duplicate, rename, delete, and launch actions for 5 pre-calibrated cases. |
| **New Scenario Wizard** | `new-scenario.html` | 4-step guided configuration (Hazard & Severity, City Model, Resources & Policies, Review & Launch). Includes locked modules for Wildfire, Epidemic, and Heatwave. |
| **Command Center** | `command-center.html` | **Visual centerpiece:** Real-time operational interface with weather/hazard sliders, simulation playback (1×, 5×, 20×), interactive Riverton city map with live flood expansion and moving agents, shelter gauges, and policy comparison strip. |
| **City Model** | `city-model.html` | Digital twin spatial inspector with 7 selectable layers, neighborhood demographic drawer, infrastructure inventory, and USGS/census calibration documentation. |
| **Policy Lab** | `policy-lab.html` | Strategy builder comparing Baseline, Shelter-First, Cost-Constrained, Equity-First, and AI-Optimized options with Pareto cost-vs-safety and equity-vs-time charts. |
| **Equity Analysis** | `equity-analysis.html` | Deep-dive into spatial disparity: Gini-parity index (0.82), Bridge 3 bottleneck findings, and bar chart comparing evacuation success by vulnerability tier. |
| **System Dynamics** | `system-dynamics.html` | Temporal causal analysis: 4 synchronized charts (river gauge, road operability, shelter occupancy, hospital ICU surge), milestone event log, and corridor flow diagram. |
| **Uncertainty Analysis** | `uncertainty.html` | 100-run Monte Carlo Latin Hypercube ensemble, 95% Confidence Interval badge, bell curve distribution, Sobol sensitivity tornado diagram, and tri-scenario outcome cards. |
| **Reports** | `reports.html` | Formal executive policy brief and decision scorecard with scenario selector, embedded analytical charts, and browser print export (`Ctrl+P` / `Cmd+P`). |
| **Methodology** | `methodology.html` | Scholarly technical documentation detailing hydrodynamic 2D flow approximations, bounded rationality agent behavior, Dijkstra route impedance, and ethical use guidelines. |
| **Settings** | `settings.html` | EOC dark / light theme switcher, high-contrast mode, reduced-motion controls, larger map labels, simulation defaults, and scenario JSON export/import. |

---

## 🏙️ Synthetic Digital Twin Specifications: Riverton

- **Total Population:** 78,500 residents across 8 heterogeneous neighborhoods.
- **Topography:** Digital Elevation Model (DEM) ranging from 2.7m ASL (Canal Basin floodplain) to 16.0m ASL (Crestview Meadows).
- **Hydrology:** Riverton Meander and North Canal with a 2.8m peak projected flood crest.
- **Critical Arterial Bottleneck:** Bridge 3 (Canal Bottleneck), which approaches deck inundation at Hour 4.2, severing the sole evacuation corridor for 9,800 residents in Neighborhood 5.
- **Key Infrastructure:**
  - **North Shelter (Civic Arena):** 3,500 capacity, 3 backup generators, medical triage.
  - **West Shelter (High School):** 2,800 capacity, elevated dry ground access.
  - **East Shelter (Pavilion):** 2,200 capacity, neighborhood staging.
  - **Riverside General Hospital:** 420 beds, 45 ICU capacity, active sandbag perimeter.

---

## 🎨 Visual Design & Accessibility Compliance

- **Calm, High-Trust Emergency Ops Palette:** Deep charcoal/navy background (`#090e17`, `#0e1626`), flood blue (`#0284c7`), safe teal (`#10b981`), warning amber (`#f59e0b`), and restrained danger red (`#ef4444`).
- **Strict Anti-Generic Constraints:**
  - Consistent 4–8px border radii (strictly no oversized bubble pills or soft card styling).
  - No decorative gradients, glowing meshes, or generic floating AI blobs.
  - No cartoon mascots, avatars, or playful gamified elements.
- **Accessibility:**
  - Meets WCAG contrast standards with sharp typography and tabular mono figures.
  - Supports `theme-dark`, `theme-light`, and `high-contrast` modes.
  - Full support for `reduced-motion` (pauses animated agent dots and transitions).

---

## 🔒 Privacy & Local State

- **Zero External Telemetry:** All simulation parameters and custom scenarios are saved locally in the browser’s `localStorage`.
- **JSON Import / Export:** Operators can back up scenario suites or import custom parameter files directly from the **Settings** page.

---

*CrisisSim — Designed for high-school hackathon presentation and professional decision-support demonstrations.*
