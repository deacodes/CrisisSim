import uuid
from fastapi.testclient import TestClient
from backend.api import create_app
from backend.worker import run_job, verify_replay
from backend.experiments import experiment_job
from backend.run_contracts import ExperimentConfig
from tests.test_engine import tiny_config


def test_persistence_replay_and_reports(tmp_path):
    app = create_app(tmp_path, execute=False)
    with TestClient(app) as client:
        config = tiny_config().model_dump()
        scenario = client.post("/api/v1/scenarios", json=config).json()
        key = str(uuid.uuid4())
        payload = {"config": config, "scenario_id": scenario["id"], "request_id": key}
        created = client.post("/api/v1/runs", json=payload)
        assert created.status_code == 202
        assert client.post("/api/v1/runs", json=payload).json()["id"] == key
        store = app.state.store
        run_job(str(tmp_path), store.url, key)
        assert client.get(f"/api/v1/runs/{key}").json()["status"] == "completed"
        snapshot = client.get(f"/api/v1/runs/{key}/artifacts/snapshot-2.json").json()
        assert verify_replay(config, 2, snapshot)
        checkpoint = client.post(f"/api/v1/runs/{key}/checkpoint/2").json()
        assert checkpoint["time_s"] == 60
        report = client.get(f"/api/v1/runs/{key}/report").json()
        assert report["metrics"][-1]["population"] == 16
        assert client.get(f"/api/v1/runs/{key}/report?format=csv").status_code == 200
        assert client.get(f"/api/v1/runs/{key}/artifacts/secrets.json").status_code == 404
        assert client.post("/api/v1/scenarios", json=config, headers={"origin": "https://evil.invalid"}).status_code == 403
        html = client.get("/command-center.html").text
        assert "js/frontend.js" in html
        assert 'class="command-workspace"' in html
        assert 'src="js/state.js"' not in html
    assert create_app(tmp_path, execute=False).state.store.get(key)["status"] == "completed"


def test_actual_experiments(tmp_path):
    app = create_app(tmp_path, execute=False)
    store = app.state.store
    for kind in ("comparison", "monte_carlo", "optimization", "sensitivity"):
        spec = ExperimentConfig(kind=kind, config=tiny_config(), trials=2, evaluations=8)
        record = store.create("experiment", {"spec": spec.model_dump()}, "queued")
        experiment_job(str(tmp_path), store.url, record["id"])
        result = store.get(record["id"])
        assert result["status"] == "completed", result.get("error")
        assert len(result["evaluations"]) >= 2
        assert all(e["status"] == "completed" for e in result["evaluations"])


def test_comparison_policies_do_not_inherit_other_treatment_flags(tmp_path):
    store = create_app(tmp_path, execute=False).state.store
    config = tiny_config(policy={"temporary_shelters": True, "prioritize_vulnerable": True})
    spec = ExperimentConfig(kind="comparison", config=config)
    record = store.create("experiment", {"spec": spec.model_dump()}, "queued")
    experiment_job(str(tmp_path), store.url, record["id"])
    result = store.get(record["id"])
    assert result["status"] == "completed", result.get("error")
    policies = [e["config"]["policy"] for e in result["evaluations"]]
    assert [(p["temporary_shelters"], p["prioritize_vulnerable"]) for p in policies] == [
        (False, False), (True, False), (False, True)]
    assert all(e["config"]["seed"] == config.seed for e in result["evaluations"])


def test_comparison_budget_validated_before_scheduling(tmp_path):
    app = create_app(tmp_path, execute=False)
    with TestClient(app) as client:
        config = tiny_config(policy={"budget": 0}).model_dump()
        response = client.post("/api/v1/experiments", json={"kind": "comparison", "config": config})
        assert response.status_code == 422
        assert "1000 budget units" in response.text
        assert app.state.store.list("experiment") == []
        config["policy"]["budget"] = 1000
        assert client.post("/api/v1/experiments", json={
            "kind": "comparison", "config": config}).status_code == 202


def test_commands_branches_and_websocket(tmp_path):
    app = create_app(tmp_path, execute=False)
    with TestClient(app) as client:
        store = app.state.store
        config = tiny_config().model_dump()
        run = client.post("/api/v1/runs", json={"config": config}).json()
        rid = run["id"]
        store.update(rid, status="running")
        command_id = str(uuid.uuid4())
        payload = {"action": "pause", "request_id": command_id}
        assert client.post(f"/api/v1/runs/{rid}/commands", json=payload).status_code == 200
        assert client.post(f"/api/v1/runs/{rid}/commands", json=payload).json()["id"] == command_id
        assert store.get(rid)["status"] == "paused"
        assert client.post(f"/api/v1/runs/{rid}/commands", json={"action": "resume"}).status_code == 200
        assert client.post(f"/api/v1/runs/{rid}/commands", json={"action": "cancel"}).status_code == 200
        assert store.get(rid)["status"] == "cancelled"
        # A cancelled queued/delivered job must not execute.
        run_job(str(tmp_path), store.url, rid)
        assert store.get(rid)["status"] == "cancelled"
        record = client.post("/api/v1/runs", json={"config": config}).json()
        rid = record["id"]
        run_job(str(tmp_path), store.url, rid)
        with client.websocket_connect(f"/api/v1/runs/{rid}/stream") as socket:
            event = socket.receive_json()
            assert event["status"] == "completed"
            assert event["sequence"] == 4
        branch = client.post(f"/api/v1/runs/{rid}/branch", json={
            "sequence": 2, "prioritize_vulnerable": True}).json()
        run_job(str(tmp_path), store.url, branch["id"])
        parent_before = store.read_json(rid, "snapshot-2.json")
        child_before = store.read_json(branch["id"], "snapshot-2.json")
        assert parent_before["metrics"] == child_before["metrics"]
        assert store.get(branch["id"])["policy_events"][0]["time_s"] == 60
        assert verify_replay(config, 4, store.read_json(branch["id"], "snapshot-4.json"),
                             store.get(branch["id"])["policy_events"])


def test_revision_conflict_and_input_limits(tmp_path):
    with TestClient(create_app(tmp_path, execute=False)) as client:
        config = tiny_config().model_dump()
        scenario = client.post("/api/v1/scenarios", json=config).json()
        change = {"config": config | {"name": "Updated"}, "revision": scenario["revision"]}
        assert client.patch(f"/api/v1/scenarios/{scenario['id']}", json=change).status_code == 200
        assert client.patch(f"/api/v1/scenarios/{scenario['id']}", json=change).status_code == 409
        config["population"] = 78500
        config["flood"]["duration_s"] = 86400
        assert client.post("/api/v1/runs", json={"config": config}).status_code == 422


def test_all_production_pages_exclude_fixture_scripts(tmp_path):
    from backend.api import PAGES, ROOT
    with TestClient(create_app(tmp_path, execute=False)) as client:
        for page in PAGES:
            html = client.get("/"+page).text
            assert html == (ROOT/page).read_text()
            assert 'class="page-viewport"' in html
            assert 'src="js/frontend.js"' in html
            assert 'src="js/state.js"' not in html
            assert 'src="js/data.js"' not in html
            assert "12,480" not in html
            assert "live-app.js" not in html


def test_editor_model_is_configuration_not_simulated_results(tmp_path):
    with TestClient(create_app(tmp_path, execute=False)) as client:
        model = client.get("/api/v1/model").json()
        assert model["city"]["calibrated"] is False
        assert model["defaults"]["population"] == 800
        assert "metrics" not in model
        assert client.get("/api/v1/runs").json() == []


def test_experiment_stream_and_local_preview_origins(tmp_path):
    with TestClient(create_app(tmp_path, execute=False)) as client:
        headers = {"origin": "http://127.0.0.1:3000"}
        response = client.post("/api/v1/experiments", headers=headers, json={
            "kind": "comparison", "config": tiny_config().model_dump()})
        assert response.status_code == 202
        assert response.headers["access-control-allow-origin"] == headers["origin"]
        identifier = response.json()["id"]
        with client.websocket_connect(f"/api/v1/experiments/{identifier}/stream", headers=headers) as socket:
            record = socket.receive_json()
            assert record["id"] == identifier and record["status"] == "queued"
        assert client.post("/api/v1/scenarios", json=tiny_config().model_dump(),
                           headers={"origin": "https://untrusted.example"}).status_code == 403


def test_import_is_validated_before_any_writes(tmp_path):
    app = create_app(tmp_path, execute=False)
    with TestClient(app) as client:
        config = tiny_config().model_dump()
        bad = config | {"population": -1}
        assert client.post("/api/v1/scenarios/import", json={"configs": [config, bad]}).status_code == 422
        assert app.state.store.list("scenario") == []
        response = client.post("/api/v1/scenarios/import", json={"configs": [config, config]})
        assert response.status_code == 201
        assert len(app.state.store.list("scenario")) == 2
