import json
import numpy as np
import pytest
from backend.agents import State
from backend.operations import Request
from backend.engine import Simulation
from backend.run_contracts import RunConfig


def tiny_config(**overrides):
    values = {"population": 16, "flood": {"duration_s": 120, "output_interval_s": 30,
              "mesh_cells_per_axis": 4, "rainfall_mm_h": 0},
              "behavior": {"preparation_median_s": 1, "warning_mean_delay_s": 1}}
    return RunConfig.model_validate(values | overrides)


def test_coupled_repeatable():
    first = [s for s, _ in Simulation(tiny_config()).frames()]
    second = [s for s, _ in Simulation(tiny_config()).frames()]
    assert first == second
    for frame in first:
        assert sum(frame["metrics"]["state_counts"].values()) == 16
        json.dumps(frame, allow_nan=False)


def test_coupled_actual_evacuations():
    config = tiny_config(population=32, flood={"duration_s": 1800, "output_interval_s": 60,
                         "mesh_cells_per_axis": 4, "rainfall_mm_h": 0, "initial_stage_m": 0},
                         behavior={"preparation_median_s": 1, "warning_mean_delay_s": 1,
                                   "mobility_fraction": 0, "transit_fraction": 0})
    model = Simulation(config)
    frames = [s for s, _ in model.frames()]
    assert frames[-1]["metrics"]["safely_evacuated"] > 0
    assert all(len(f.occupants) <= f.capacity for f in model.facilities.values())
    assert len({a.id for a in model.agents}) == 32


@pytest.mark.parametrize("time_s,closed_edge,interrupted", [
    (72, ("v0-1", "v1-1"), False),  # Completed pickup leg.
    (72, ("v1-1", "v2-1"), True),   # Current delivery leg.
    (72, ("v2-1", "v3-1"), True),   # Future delivery leg.
    (77, ("v1-1", "v2-1"), False),  # Completed edge within delivery leg.
    (20, ("v0-1", "v1-1"), False),  # Pickup service after reaching origin.
    (20, ("v2-1", "v3-1"), True),   # Delivery route still needed after pickup.
    (90, ("v2-1", "v3-1"), False),  # Unloading after reaching destination.
])
def test_rescue_closure_checks_only_remaining_route(monkeypatch, time_s, closed_edge, interrupted):
    model = Simulation(tiny_config(policy={"buses": 1, "ambulances": 0, "rescue_boats": 0}))
    agent = model.agents[0]
    agent.state = State.WAITING
    model.dispatcher.submit(Request("trip", (agent.id,), "v1-1", "v3-1", "bus", 0))
    model.dispatcher.dispatch(0, lambda *args: 10)
    model.active_trips["bus-0"] = {
        "path": ["v0-1", "v1-1", "v2-1", "v3-1"],
        "first": ["v0-1", "v1-1"], "second": ["v1-1", "v2-1", "v3-1"], "start_s": 0}
    model.time_s = time_s
    for event in model.dispatcher.advance(model.time_s):
        model.consume_dispatch(event)
    monkeypatch.setattr(model.hydro, "sample",
                        lambda points, frame: (np.zeros(len(points)), np.zeros(len(points))))
    monkeypatch.setattr(model.network, "update_flood",
                        lambda callback: model.network.closed["vehicle"].add(closed_edge))
    model.flood_update({})
    assert (model.dispatcher.vehicles["bus-0"].state == "interrupted") == interrupted


@pytest.mark.parametrize("initial_state", [State.HOME, State.PREPARING])
@pytest.mark.parametrize("depth", [0.0, 1.0])
def test_flood_danger_overrides_warning_and_preparation(monkeypatch, initial_state, depth):
    model = Simulation(tiny_config())
    agent = model.agents[0]
    agent.state = initial_state
    agent.warning_s = agent.ready_s = float("inf")
    model.time_s = 2
    monkeypatch.setattr(model.hydro, "sample",
                        lambda points, frame: (np.full(len(points), depth), np.zeros(len(points))))
    model.update_agents(2)
    assert agent.state == (State.RESCUE if depth else initial_state)


def test_policy_change_reprioritizes_pending_requests_only():
    model = Simulation(tiny_config())
    for i, agent in enumerate(model.agents[:4]):
        agent.mobility_impaired = i != 1
        request = Request(str(i), (agent.id,), "v0-1", "v1-1", "ambulance", 0)
        model.dispatcher.submit(request)
        request.assigned = i == 2
        request.completed = i == 3
    model.apply_policy({"prioritize_vulnerable": True})
    assert [r.priority for r in model.dispatcher.requests.values()] == [5, 1, 1, 1]
    model.apply_policy({"prioritize_vulnerable": False})
    assert all(r.priority == 1 for r in model.dispatcher.requests.values())
