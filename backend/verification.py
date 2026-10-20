"""Reproducible numerical checks and timing. Not empirical flood validation."""
import json
import platform
import resource
import time
from pathlib import Path

import numpy as np
from backend.contracts import FloodConfig
from backend.hydrology import FloodModel


def ritter_depth(x, time_s, left_depth=1, dam_x=50, gravity=9.8):
    """Analytic frictionless, dry-bed dam break before boundary interaction."""
    c = np.sqrt(gravity*left_depth)
    xi = (np.asarray(x)-dam_x)/time_s
    return np.where(xi <= -c, left_depth,
                    np.where(xi < 2*c, (2*c-xi)**2/(9*gravity), 0))


def dam_break(cells):
    config = FloodConfig(duration_s=2, output_interval_s=1, mesh_cells_per_axis=cells,
                         rainfall_mm_h=0, infiltration_mm_h=0, drainage_mm_h=0, manning_n=0)
    model = FloodModel(config, width=100, height=20, bed=lambda x, y: 0*x,
                       initial_depth=lambda x, y: np.where(x < 50, 1., 0.))
    started = time.perf_counter()
    final = list(model.frames())[-1]
    exact = ritter_depth(model.centers[:, 0], 2)
    error = np.average(abs(final["depth_m"]-exact), weights=model.domain.areas)
    return {"cells_per_axis": cells, "triangles": len(model.centers),
            "l1_depth_error_m": float(error), "mass_residual_m3": final["mass_residual_m3"],
            "minimum_depth_m": float(final["depth_m"].min()),
            "runtime_s": time.perf_counter()-started}


def benchmark(cells, duration_s=60):
    config = FloodConfig(duration_s=duration_s, output_interval_s=10,
                         mesh_cells_per_axis=cells)
    started = time.perf_counter()
    model = FloodModel(config)
    frames = list(model.frames())
    return {"cells_per_axis": cells, "triangles": len(model.centers),
            "duration_s": duration_s, "frames": len(frames),
            "runtime_s": time.perf_counter()-started,
            "max_abs_mass_residual_m3": max(abs(f["mass_residual_m3"]) for f in frames)}


def temporal_convergence():
    fields = []
    for cfl in (.9, .45, .225, .1125):
        config = FloodConfig(duration_s=2, output_interval_s=1, mesh_cells_per_axis=16,
                             rainfall_mm_h=0, infiltration_mm_h=0, drainage_mm_h=0,
                             manning_n=0, cfl=cfl)
        model = FloodModel(config, width=100, height=20, bed=lambda x, y: 0*x,
                           initial_depth=lambda x, y: 1+.1*np.exp(-((x-50)/10)**2))
        fields.append(list(model.frames())[-1]["depth_m"])
    reference = fields[-1]
    return [{"cfl": cfl, "depth_difference_to_reference_m": float(np.mean(abs(field-reference)))}
            for cfl, field in zip((.9, .45, .225), fields[:-1])]


def main():
    report = {
        "platform": platform.platform(), "python": platform.python_version(),
        "dam_break": [dam_break(n) for n in (8, 16, 32)],
        "temporal_convergence": temporal_convergence(),
        "profiles": [benchmark(n) for n in (8, 32)],
        "limitations": ["Synthetic verification, not empirical validation",
                        "Peak RSS includes Python/dependency overhead and earlier tests",
                        "Profiles measure hydrodynamics only, not coupled-system performance"],
    }
    report["peak_rss_bytes"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (
        1 if platform.system() == "Darwin" else 1024)
    folder = Path("runtime/verification")
    folder.mkdir(parents=True, exist_ok=True)
    (folder/"report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
