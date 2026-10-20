"""Coupled-engine benchmark; writes evidence, not performance promises."""
import json
import platform
import resource
import time
from pathlib import Path
from backend.run_contracts import RunConfig
from backend.engine import Simulation


def main():
    profiles = []
    for population, duration in ((32, 600), (800, 1800)):
        config = RunConfig(population=population,
                           flood={"duration_s": duration, "output_interval_s": 60, "mesh_cells_per_axis": 8})
        started = time.perf_counter()
        samples = []
        for snapshot, _ in Simulation(config).frames():
            samples.append(snapshot)
        profiles.append({"population": population, "duration_s": duration,
            "runtime_s": time.perf_counter()-started, "snapshots": len(samples),
            "snapshot_bytes": sum(len(json.dumps(s).encode()) for s in samples),
            "final_metrics": samples[-1]["metrics"]})
    report = {"platform": platform.platform(), "python": platform.python_version(), "profiles": profiles,
              "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if platform.system()=="Darwin" else 1024),
              "notes": "Single process; excludes HTTP and rendering. RSS includes imports and both profiles."}
    path = Path("runtime/verification")
    path.mkdir(parents=True, exist_ok=True)
    (path/"coupled-benchmark.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
