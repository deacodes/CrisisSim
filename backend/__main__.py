"""Run with python -m backend validate-city or python -m backend flood."""
import argparse
import json
import hashlib
from pathlib import Path

from backend.city import build_city, validate_city
from backend.contracts import Scenario, DISCLAIMER


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["validate-city", "flood"])
    parser.add_argument("--scenario", type=Path)
    parser.add_argument("--output", type=Path, default=Path("runtime"))
    args = parser.parse_args()
    city = build_city()
    result = validate_city(city)
    if args.command == "validate-city":
        print(json.dumps(result))
        return
    import numpy as np
    from backend.hydrology import FloodModel
    from tempfile import mkdtemp
    from importlib.metadata import version
    from backend import __version__

    scenario = Scenario.model_validate_json(args.scenario.read_text()) if args.scenario else Scenario()
    args.output.mkdir(parents=True, exist_ok=True)
    destination = Path(mkdtemp(prefix="flood-", dir=args.output))
    model = FloodModel(scenario.flood)
    manifest = {
        "status": "running", "model_version": __version__, "anuga": version("anuga"),
        "scenario": scenario.model_dump(), "city": city["version"], "disclaimer": DISCLAIMER,
        "limitations": [f"Boundary mode: {scenario.flood.boundary_mode}",
                        f"Channel refinement: {scenario.flood.channel_refinement}",
                        "Nearest-centroid spatial sampling", "No evacuation coupling yet",
                        "Arrival/maxima sampled at output times; not substep extrema"],
    }
    manifest_path = destination / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    try:
        records = []
        for index, frame in enumerate(model.frames()):
            filename = destination / f"frame-{index:05d}.npz"
            arrays = {k: v for k, v in frame.items() if isinstance(v, np.ndarray)}
            np.savez_compressed(filename, centers=model.centers, **arrays)
            records.append({k: v for k, v in frame.items() if not isinstance(v, np.ndarray)} |
                           {"artifact": filename.name, "sha256": hashlib.sha256(filename.read_bytes()).hexdigest()})
        manifest.update(status="completed", frames=records)
    except Exception as exc:
        manifest.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        manifest_path.write_text(json.dumps(manifest, indent=2, allow_nan=False))
    print(json.dumps({"directory": str(destination), "frames": len(records),
                      "final_mass_residual_m3": records[-1]["mass_residual_m3"]}))


if __name__ == "__main__":
    main()
