"""Worker entrypoints. Local process pool or Celery; numerical work never in HTTP."""
import hashlib
import json
import os
import time
import platform
import subprocess
from datetime import datetime, timezone
from importlib.metadata import version

import numpy as np

from backend import __version__
from backend.run_contracts import RunConfig
from backend.storage import Store


def now():
    return datetime.now(timezone.utc).isoformat()


def run_job(root, database_url, run_id):
    from backend.engine import Simulation
    store = Store(root, database_url)
    record = store.get(run_id, "run")
    if not store.claim(run_id):
        return
    attempt = record.get("attempt", 0)+1
    store.update(run_id, {"attempt": attempt, "heartbeat": now(), "error": None})
    started = time.perf_counter()
    try:
        config = RunConfig.model_validate(record["config"])
        simulation = Simulation(config)
        store.write_json(run_id, "city.json", simulation.city)
        # Mesh is authoritative for the rendered terrain and flood surface.
        mesh = {"vertices": simulation.hydro.domain.get_nodes().tolist(),
                "triangles": simulation.hydro.domain.triangles.tolist(),
                "vertex_bed_m": simulation.hydro.domain.quantities["elevation"].vertex_values.tolist(),
                "centers": simulation.hydro.centers.tolist(),
                "bed_m": simulation.hydro.domain.quantities["elevation"].centroid_values.tolist()}
        store.write_json(run_id, "mesh.json", mesh)
        manifest = {"model_version": __version__, "anuga_version": version("anuga"),
                    "config": config.model_dump(), "city_version": simulation.city["version"],
                    "attempt": attempt, "frames": [],
                    "checkpoint_strategy": "deterministic recomputation from immutable configuration and policy events",
                    "limitations": ["Synthetic uncalibrated city", "Flood extrema sampled at output times",
                     "Individual vehicle packets; no shared private-car occupancy",
                     "Boats restricted to inundated road corridors; no arbitrary overland rescue",
                     "Hospital admission counts as safe; no mortality model"]}
        manifest["environment"] = {"python": platform.python_version(), "platform": platform.platform(),
            "dependencies": {p: version(p) for p in ("numpy", "scipy", "anuga", "ortools", "networkx")}}
        try:
            manifest["source_revision"] = subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=__import__("pathlib").Path(__file__).resolve().parent,
                text=True, stderr=subprocess.DEVNULL).strip()
        except (OSError, subprocess.SubprocessError):
            manifest["source_revision"] = "unavailable"
        manifest["engine_source_sha256"] = {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in __import__("pathlib").Path(__file__).resolve().parent.glob("*.py")}
        series = []
        for sequence, (snapshot, flood) in enumerate(simulation.frames()):
            if time.perf_counter()-started > 600:
                raise TimeoutError("run exceeded ten-minute worker budget")
            latest = store.get(run_id, "run")
            while latest["status"] == "paused":
                time.sleep(.2)
                latest = store.get(run_id, "run")
            if latest["status"] == "cancelled":
                return
            # Branch priority commands change future behavior only.
            for command in record.get("policy_events", []):
                if snapshot["time_s"] >= command["time_s"] and not command.get("applied"):
                    simulation.apply_policy(command["policy"])
                    command["applied"] = True
                    simulation.event("policy_changed", policy=command["policy"])
            snapshot.update(run_id=run_id, sequence=sequence, protocol_version=1)
            # GPU-ready per-cell fields, separately fetched, not sent on every WS event.
            field = {"time_s": snapshot["time_s"], "depth_m": flood["depth_m"].tolist(),
                     "stage_m": flood["stage_m"].tolist(), "velocity_m_s": flood["velocity_m_s"].tolist()}
            field_hash = store.write_json(run_id, f"field-{sequence}.json", field)
            snap_hash = store.write_json(run_id, f"snapshot-{sequence}.json", snapshot)
            series.append({"time_s": snapshot["time_s"], **snapshot["metrics"]})
            store.write_json(run_id, "metrics.json", series)
            manifest["frames"].append({"sequence": sequence, "time_s": snapshot["time_s"],
                                      "snapshot_sha256": snap_hash, "field_sha256": field_hash})
            store.write_json(run_id, "manifest.json", manifest)
            store.update(run_id, {"sequence": sequence, "time_s": snapshot["time_s"],
                                  "heartbeat": now(), "progress": snapshot["time_s"]/config.flood.duration_s})
        if store.get(run_id)["status"] != "cancelled":
            store.update(run_id, {"runtime_s": time.perf_counter()-started, "heartbeat": now()}, "completed")
    except Exception as error:
        store.update(run_id, {"error": f"{type(error).__name__}: {error}", "heartbeat": now()}, "failed")
        raise


def checkpoint(store, run_id, sequence):
    record = store.get(run_id, "run")
    snapshot = store.read_json(run_id, f"snapshot-{sequence}.json")
    recipe = {"config": record["config"], "policy_events": record.get("policy_events", []),
              "sequence": sequence, "time_s": snapshot["time_s"],
              "snapshot_sha256": hashlib.sha256(json.dumps(
                  snapshot, allow_nan=False, separators=(",", ":")).encode()).hexdigest(),
              "model_version": __version__, "strategy": "deterministic recomputation"}
    store.write_json(run_id, f"checkpoint-{sequence}.json", recipe)
    return recipe


def verify_replay(config, target_sequence, expected, policy_events=()):
    """Engine-level restore verifier; callers can compare with a saved checkpoint."""
    from backend.engine import Simulation
    model = Simulation(RunConfig.model_validate(config))
    applied = set()
    for sequence, (snapshot, _) in enumerate(model.frames()):
        if sequence == target_sequence:
            return snapshot["metrics"] == expected["metrics"] and snapshot["agents"] == expected["agents"]
        for i, event in enumerate(policy_events):
            if i not in applied and snapshot["time_s"] >= event["time_s"]:
                model.apply_policy(event["policy"])
                applied.add(i)
    return False
