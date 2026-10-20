import copy
import math
import numpy as np
import pytest
from hypothesis import given, settings, strategies as st

from backend.agents import Agent, BehaviorConfig, State, generate_population
from backend.city import build_city
from backend.transport import CellLink, RoadNetwork
from backend.operations import Facility, Dispatcher, Request, Vehicle


def small_city():
    city = build_city()
    for n in city["neighborhoods"]:
        n["population"] = 20
    city["population"] = 160
    return city


def test_population_reproducible_exact_marginals():
    city = small_city()
    a = generate_population(city, config=BehaviorConfig(mobility_fraction=.2, transit_fraction=.3))
    b = generate_population(city, config=BehaviorConfig(mobility_fraction=.2, transit_fraction=.3))
    assert a == b
    assert len({p.id for p in a}) == 160
    for nid in (n["id"] for n in city["neighborhoods"]):
        group = [p for p in a if p.neighborhood == nid]
        assert len(group) == 20
        assert sum(p.mobility_impaired for p in group) == 4
        assert sum(p.transit_dependent for p in group) == 6


def test_behavior_transitions_and_exposure():
    a = Agent("a", "h", "N1", 0, 0, True, False, 10, 30)
    assert not a.update_behavior(9)
    a.update_behavior(10)
    assert a.state == State.PREPARING
    a.update_behavior(30)
    assert a.state == State.WAITING
    with pytest.raises(ValueError):
        a.transition(State.SHELTERED, 31)
    a.expose(.2, 10)
    assert a.exposure_depth_seconds == 2
    with pytest.raises(ValueError):
        a.update_behavior(29)


def test_unwarned_population_does_not_magically_depart():
    agents = generate_population(small_city(), config=BehaviorConfig(warning_receipt_fraction=0))
    for a in agents:
        a.update_behavior(86400)
        assert a.state == State.HOME


def test_ctm_conservation_spillback_and_cfl():
    link = CellLink(100, 4)
    admitted = 0
    for _ in range(300):
        entering, exiting = link.advance(1, 5, 0)
        admitted += entering
        assert exiting == 0
        assert link.occupancy.sum() == pytest.approx(admitted)
    assert link.occupancy.sum() == pytest.approx(link.storage*4)
    assert link.advance(1, 5, 0)[0] < 1e-8
    with pytest.raises(ValueError):
        link.advance(100)
    for _ in range(300):
        link.advance(1, 0)
    assert link.occupancy.sum() < 1e-8
    assert link.entered == pytest.approx(link.exited)


def test_closure_stops_existing_traffic():
    link = CellLink(100, 2)
    link.occupancy[:] = [2, 3]
    before = link.occupancy.copy()
    link.closed = True
    assert link.advance(1, 2) == (0, 0)
    np.testing.assert_equal(link.occupancy, before)


def test_routes_close_reopen_and_sample_interior():
    net = RoadNetwork(build_city())
    a, b = "v0-0", "v1-0"
    assert net.route(a, b) == [a, b]
    def flooded(road, points):
        depth = np.zeros(len(points))
        if road["source"] == a:
            depth[len(points)//2] = .5
        return depth
    net.update_flood(flooded)
    assert net.route(a, b) is None
    net.update_flood(lambda road, points: np.zeros(len(points)))
    assert net.route(a, b) == [a, b]


def test_network_junction_conservation():
    net = RoadNetwork(build_city())
    first, second = ("v0-0", "v1-0"), ("v1-0", "v2-0")
    total_in = total_out = 0
    for _ in range(200):
        result = net.step(1, {first: {second: 1}}, {first: 1}, exits=(second,))
        total_in += result["admitted"]
        total_out += result["exited"]
        assert sum(l.occupancy.sum() for l in net.links.values()) == pytest.approx(total_in-total_out)


def test_shelter_capacity_accessibility_and_activation():
    f = Facility("s", 2, 1, opens_s=10)
    f.enqueue("a", 0, True)
    f.enqueue("b", 0, True)
    f.enqueue("c", 0)
    assert f.advance(9) == []
    events = f.advance(12)
    assert [e["person"] for e in events] == ["a", "c"]
    assert len(f.occupants) == 2
    assert f.queue[0][0] == "b"
    with pytest.raises(ValueError):
        f.enqueue("a", 12)


def test_hospital_queue_is_timestep_independent():
    f = Facility("hospital", 1, 1, service_duration_s=10)
    for person in ("a", "b", "c"):
        f.enqueue(person, 0)
    g = copy.deepcopy(f)
    coarse = f.advance(35)
    fine = sum((g.advance(t) for t in range(36)), [])
    assert coarse == fine
    assert not f.occupants


def test_dispatch_capacity_budget_and_no_teleportation():
    d = Dispatcher([Vehicle("amb", "ambulance", "depot", 1)], budget=1000,
                   pickup_service_s=10, unload_service_s=10)
    d.submit(Request("r", ("p",), "home", "hospital", "ambulance", 0))
    events = d.dispatch(0, lambda v, a, b: 20)
    assert any(e["type"] == "dispatch" for e in events)
    assert d.spent == 100
    assert not d.requests["r"].completed
    assert d.advance(29) == []
    assert d.advance(30)[0]["type"] == "pickup"
    assert d.advance(60)[0]["type"] == "delivery"
    assert d.spent == pytest.approx(106)
    assert d.reserved == pytest.approx(0)
    assert d.vehicles["amb"].location == "hospital"


def test_dispatch_inaccessible_budget_and_duplicate_guard():
    d = Dispatcher([Vehicle("boat", "boat", "depot", 2)], budget=50)
    d.submit(Request("r", ("p",), "home", "shelter", "boat", 0))
    with pytest.raises(ValueError):
        d.submit(Request("r2", ("p",), "home", "shelter", "boat", 0))
    assert not d.dispatch(0, lambda *args: None)
    assert not d.dispatch(0, lambda *args: 1)
    assert d.spent == 0


def test_dispatch_prioritizes_real_assignment_and_interrupts():
    d = Dispatcher([Vehicle("boat", "boat", "depot", 2)])
    d.submit(Request("low", ("p1",), "a", "s", "boat", 0, priority=1))
    d.submit(Request("high", ("p2",), "b", "s", "boat", 0, priority=10))
    d.dispatch(0, lambda *args: 100)
    assert d.vehicles["boat"].task == "high"
    d.interrupt("boat", 10)
    d.advance(1000)
    assert not d.requests["high"].completed
    assert d.reserved == pytest.approx(0)


@given(st.lists(st.tuples(st.floats(min_value=0, max_value=2, allow_nan=False),
                         st.floats(min_value=0, max_value=2, allow_nan=False)),
                min_size=1, max_size=60))
@settings(max_examples=40, deadline=None)
def test_ctm_arbitrary_demand_preserves_mass(demands):
    link = CellLink(100, 4)
    for inflow, outflow in demands:
        link.advance(1, inflow, outflow)
        assert link.occupancy.sum() == pytest.approx(link.entered-link.exited, abs=1e-8)
        assert (link.occupancy >= -1e-9).all()
        assert (link.occupancy <= link.storage+1e-9).all()


def test_dispatch_respects_passenger_capacity_and_kind():
    d = Dispatcher([Vehicle("a", "ambulance", "depot", 1)])
    d.submit(Request("group", ("p1", "p2"), "home", "hospital", "ambulance", 0))
    d.submit(Request("water", ("p3",), "home", "shelter", "boat", 0))
    assert not d.dispatch(0, lambda *args: 10)
    assert not any(r.assigned for r in d.requests.values())
