"""Local-first API. Use an authenticated reverse proxy for remote multi-user use."""
import asyncio
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager
import csv
import io
import json
import os
from pathlib import Path
import re
import uuid

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import Field
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.cors import CORSMiddleware

from backend.contracts import Contract, DISCLAIMER
from backend.run_contracts import RunConfig, ExperimentConfig
from backend.storage import Store
from backend.worker import run_job, checkpoint
from backend.experiments import experiment_job

ROOT = Path(__file__).resolve().parent.parent
PAGES = {"index.html", "scenarios.html", "new-scenario.html", "command-center.html",
         "city-model.html", "equity-analysis.html", "system-dynamics.html", "policy-lab.html",
         "uncertainty.html", "reports.html", "methodology.html", "settings.html"}
LOCAL_FRONTENDS = {f"http://{host}:{port}" for host in ("localhost", "127.0.0.1")
                   for port in (3000, 5500, 8000, 8001, 8010, 8011)}


class ScenarioUpdate(Contract):
    config: RunConfig
    revision: int = Field(ge=1)


class StartRun(Contract):
    config: RunConfig
    scenario_id: str | None = None
    request_id: uuid.UUID = Field(default_factory=uuid.uuid4)


class Command(Contract):
    action: str
    request_id: uuid.UUID = Field(default_factory=uuid.uuid4)


class Branch(Contract):
    sequence: int = Field(ge=0)
    prioritize_vulnerable: bool


class ScenarioImport(Contract):
    configs: list[RunConfig] = Field(min_length=1, max_length=50)


def create_app(root=None, execute=True):
    store = Store(root or os.getenv("CRISIS_RUNTIME", ROOT/"runtime"))
    executor = None

    @asynccontextmanager
    async def lifespan(app):
        nonlocal executor
        if execute and os.getenv("CRISIS_QUEUE", "process") == "process":
            executor = ProcessPoolExecutor(max_workers=2)
        # No silent reruns after a restart. Explicit retry is required.
        for kind in ("run", "experiment"):
            for record in store.list(kind):
                if record["status"] in ("running", "paused", "queued") and os.getenv("CRISIS_QUEUE", "process") == "process":
                    store.update(record["id"], {"error": "Service restarted; retry explicitly."}, "interrupted")
        yield
        if executor:
            executor.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(title="CrisisSim", version="1.0", lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver"])
    app.add_middleware(CORSMiddleware, allow_origins=sorted(LOCAL_FRONTENDS),
                       allow_methods=["GET", "POST", "PATCH", "DELETE"],
                       allow_headers=["Content-Type"])
    app.state.store = store

    @app.middleware("http")
    async def protect(request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if origin and origin != str(request.base_url).rstrip("/") and origin not in LOCAL_FRONTENDS:
                return Response("Cross-origin writes rejected", status_code=403)
            try:
                length = int(request.headers.get("content-length", "0"))
            except ValueError:
                return Response("Invalid content length", status_code=400)
            if length > 1_000_000:
                return Response("Request too large", status_code=413)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        return response

    def get(identifier, kind=None):
        try:
            return store.get(identifier, kind)
        except KeyError:
            raise HTTPException(404, "Not found")

    def submit(identifier, kind):
        if not execute:
            return
        if os.getenv("CRISIS_QUEUE", "process") == "celery":
            from backend.tasks import execute_job
            execute_job.delay(str(store.root), store.url, identifier, kind)
        elif executor:
            executor.submit(run_job if kind == "run" else experiment_job, str(store.root), store.url, identifier)
        else:
            raise HTTPException(503, "Worker not initialized")

    def capacity():
        pending = sum(r["status"] in ("queued", "running", "paused")
                      for kind in ("run", "experiment") for r in store.list(kind))
        if pending >= 4:
            raise HTTPException(429, "Four jobs already active; finish or cancel one")

    @app.get("/api/v1/health")
    def health():
        return {"status": "ok", "mode": "local-single-user", "queue": os.getenv("CRISIS_QUEUE", "process"),
                "disclaimer": DISCLAIMER}

    @app.get("/api/v1/scenarios")
    def scenarios():
        return [s for s in store.list("scenario") if s["status"] != "archived"]

    @app.get("/api/v1/model")
    def model():
        """Configuration/geometry for the editor, without executing a simulation."""
        from backend.city import build_city
        return {"defaults": RunConfig().model_dump(), "city": build_city(),
                "disclaimer": DISCLAIMER}

    @app.post("/api/v1/scenarios", status_code=201)
    def create_scenario(config: RunConfig):
        return store.create("scenario", {"config": config.model_dump()})

    @app.post("/api/v1/scenarios/import", status_code=201)
    def import_scenarios(payload: ScenarioImport):
        # Pydantic validates the entire batch before any records are inserted.
        return store.create_scenarios([c.model_dump() for c in payload.configs])

    @app.patch("/api/v1/scenarios/{identifier}")
    def edit_scenario(identifier: str, update: ScenarioUpdate):
        old = get(identifier, "scenario")
        store.create("scenario_version", {"scenario_id": identifier, "config": old["config"], "revision": old["revision"]})
        try:
            return store.update(identifier, {"config": update.config.model_dump()}, expected_revision=update.revision)
        except ValueError as error:
            raise HTTPException(409, str(error))

    @app.delete("/api/v1/scenarios/{identifier}")
    def archive_scenario(identifier: str):
        get(identifier, "scenario")
        return store.update(identifier, status="archived")

    @app.post("/api/v1/scenarios/{identifier}/duplicate", status_code=201)
    def duplicate(identifier: str):
        source = get(identifier, "scenario")
        config = source["config"] | {"name": source["config"]["name"][:115]+" copy"}
        return store.create("scenario", {"config": config})

    @app.get("/api/v1/runs")
    def runs():
        return store.list("run")

    @app.post("/api/v1/runs", status_code=202)
    def start_run(payload: StartRun):
        identifier = str(payload.request_id)
        try:
            existing = store.get(identifier, "run")
            if existing["config"] != payload.config.model_dump():
                raise HTTPException(409, "Idempotency key already used with different input")
            return existing
        except KeyError:
            pass
        capacity()
        if payload.scenario_id:
            get(payload.scenario_id, "scenario")
        record = store.create("run", {"config": payload.config.model_dump(), "scenario_id": payload.scenario_id,
                                    "sequence": -1, "time_s": 0, "progress": 0}, "queued", identifier)
        submit(identifier, "run")
        return record

    @app.get("/api/v1/runs/{identifier}")
    def run(identifier: str):
        return get(identifier, "run")

    @app.post("/api/v1/runs/{identifier}/commands")
    def command(identifier: str, command: Command):
        record = get(identifier, "run")
        command_id = str(command.request_id)
        try:
            old = store.get(command_id, "command")
            if old["run_id"] != identifier or old["action"] != command.action:
                raise HTTPException(409, "Command key conflict")
            return old
        except KeyError:
            pass
        transition = {"pause": ("running", "paused"), "resume": ("paused", "running")}
        if command.action in transition:
            expected, target = transition[command.action]
            if record["status"] != expected:
                raise HTTPException(409, f"Cannot {command.action} a {record['status']} run")
        elif command.action == "cancel" and record["status"] in ("running", "paused", "queued"):
            target = "cancelled"
        elif command.action == "retry" and record["status"] in ("failed", "interrupted"):
            capacity()
            target = "queued"
        else:
            raise HTTPException(409, "Command is invalid for this run")
        store.update(identifier, status=target)
        result = store.create("command", {"run_id": identifier, "action": command.action,
                            "effective_after_s": record["time_s"],
                            "semantics": "Applied at the next output checkpoint"}, identifier=command_id)
        if command.action == "retry":
            submit(identifier, "run")
        return result

    @app.get("/api/v1/runs/{identifier}/artifacts/{name}")
    def artifact(identifier: str, name: str):
        get(identifier, "run")
        if not re.fullmatch(r"(city|mesh|metrics|manifest|snapshot-\d+|field-\d+|checkpoint-\d+)\.json", name):
            raise HTTPException(404, "Unknown artifact")
        path = store.artifact(identifier, name)
        if not path.is_file():
            raise HTTPException(404, "Artifact not yet available")
        return FileResponse(path, media_type="application/json")

    @app.post("/api/v1/runs/{identifier}/checkpoint/{sequence}")
    def save_checkpoint(identifier: str, sequence: int):
        get(identifier, "run")
        try:
            return checkpoint(store, identifier, sequence)
        except FileNotFoundError:
            raise HTTPException(404, "Snapshot not yet available")

    @app.post("/api/v1/runs/{identifier}/branch", status_code=202)
    def branch(identifier: str, branch: Branch):
        old = get(identifier, "run")
        try:
            recipe = checkpoint(store, identifier, branch.sequence)
        except FileNotFoundError:
            raise HTTPException(404, "Snapshot not yet available")
        capacity()
        events = [e for e in old.get("policy_events", []) if e["time_s"] < recipe["time_s"]]
        events.append({"time_s": recipe["time_s"], "policy": {"prioritize_vulnerable": branch.prioritize_vulnerable}})
        record = store.create("run", {"config": old["config"], "parent_run": identifier,
                              "policy_events": events, "sequence": -1, "time_s": 0, "progress": 0}, "queued")
        submit(record["id"], "run")
        return record

    @app.websocket("/api/v1/runs/{identifier}/stream")
    async def stream(socket: WebSocket, identifier: str):
        origin = socket.headers.get("origin")
        if origin and origin.split("://", 1)[-1] != socket.headers.get("host") and origin not in LOCAL_FRONTENDS:
            await socket.close(code=1008)
            return
        await socket.accept()
        last = -2
        try:
            while True:
                record = get(identifier, "run")
                if record["sequence"] != last or record["status"] != getattr(socket, "_last_status", None):
                    await socket.send_json({"protocol_version": 1, "type": "run",
                        "run_id": identifier, "sequence": record["sequence"], "status": record["status"],
                        "time_s": record["time_s"], "error": record.get("error"),
                        "snapshot_url": f"/api/v1/runs/{identifier}/artifacts/snapshot-{record['sequence']}.json"})
                    last = record["sequence"]
                    socket._last_status = record["status"]
                if record["status"] in ("completed", "failed", "cancelled", "interrupted"):
                    break
                await asyncio.sleep(.5)
        except (WebSocketDisconnect, HTTPException):
            pass
        finally:
            try:
                await socket.close()
            except RuntimeError:
                pass

    @app.post("/api/v1/experiments", status_code=202)
    def experiment(spec: ExperimentConfig):
        capacity()
        record = store.create("experiment", {"spec": spec.model_dump(), "evaluations": []}, "queued")
        submit(record["id"], "experiment")
        return record

    @app.get("/api/v1/experiments")
    def experiments():
        return store.list("experiment")

    @app.get("/api/v1/experiments/{identifier}")
    def experiment_status(identifier: str):
        return get(identifier, "experiment")

    @app.websocket("/api/v1/experiments/{identifier}/stream")
    async def experiment_stream(socket: WebSocket, identifier: str):
        origin = socket.headers.get("origin")
        if origin and origin.split("://", 1)[-1] != socket.headers.get("host") and origin not in LOCAL_FRONTENDS:
            await socket.close(code=1008)
            return
        await socket.accept()
        revision = -1
        try:
            while True:
                record = get(identifier, "experiment")
                if record["revision"] != revision:
                    # Announce metadata revisions; large evaluation records use HTTP.
                    await socket.send_json({"id": identifier, "revision": record["revision"],
                                            "status": record["status"]})
                    revision = record["revision"]
                if record["status"] in ("completed", "failed", "cancelled", "interrupted"):
                    break
                await asyncio.sleep(.5)
        except (WebSocketDisconnect, HTTPException):
            pass
        finally:
            try:
                await socket.close()
            except RuntimeError:
                pass

    @app.post("/api/v1/experiments/{identifier}/cancel")
    def cancel_experiment(identifier: str):
        record = get(identifier, "experiment")
        if record["status"] not in ("running", "queued"):
            raise HTTPException(409, "Experiment is not active")
        return store.update(identifier, status="cancelled")

    @app.get("/api/v1/runs/{identifier}/report")
    def report(identifier: str, format: str = "json"):
        record = get(identifier, "run")
        try:
            manifest = store.read_json(identifier, "manifest.json")
            series = store.read_json(identifier, "metrics.json")
        except FileNotFoundError:
            raise HTTPException(409, "No computed results yet")
        if format == "json":
            return {"run": record, "manifest": manifest, "metrics": series, "disclaimer": DISCLAIMER}
        if format != "csv":
            raise HTTPException(422, "Choose json or csv")
        output = io.StringIO()
        fields = ["time_s", "population", "safely_evacuated", "incomplete_count", "cost", "success_rate_gap"]
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(series)
        return Response(output.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="run-{identifier}.csv"'})

    for folder in ("js", "css", "assets"):
        app.mount("/"+folder, StaticFiles(directory=ROOT/folder), name=folder)

    @app.get("/", response_class=HTMLResponse)
    @app.get("/{page}", response_class=HTMLResponse)
    def page(page: str = "index.html"):
        if page not in PAGES:
            raise HTTPException(404)
        # Serve the exact same frontend as a static preview. No replacement UI.
        return (ROOT/page).read_text()

    return app


app = create_app()
