"""Capacity-constrained facilities and rolling-horizon dispatch.

Travel times are supplied from current feasible routes. No straight-line fallback.
Monetary units are synthetic accounting units, not real-world price estimates.
"""
from dataclasses import dataclass, field
import math
from ortools.sat.python import cp_model


@dataclass
class Facility:
    id: str
    capacity: int
    accessible_capacity: int
    opens_s: float = 0
    admission_interval_s: float = 1
    service_duration_s: float | None = None
    occupants: dict = field(default_factory=dict)
    queue: list = field(default_factory=list)
    next_admission_s: float = 0
    last_time_s: float = -1

    def __post_init__(self):
        if not 0 <= self.accessible_capacity <= self.capacity or self.capacity < 1:
            raise ValueError("invalid capacity")
        if not math.isfinite(self.opens_s) or self.opens_s < 0 or not math.isfinite(self.admission_interval_s) or self.admission_interval_s <= 0:
            raise ValueError("invalid admission timing")
        if self.service_duration_s is not None and (not math.isfinite(self.service_duration_s) or self.service_duration_s <= 0):
            raise ValueError("invalid service duration")

    def enqueue(self, person_id, time_s, accessible=False):
        if not math.isfinite(time_s) or time_s < max(0, self.last_time_s):
            raise ValueError("invalid arrival time")
        if person_id in self.occupants or any(item[0] == person_id for item in self.queue):
            raise ValueError("person already present")
        self.queue.append((person_id, time_s, accessible))
        self.queue.sort(key=lambda item: (item[1], item[0]))

    def advance(self, time_s):
        if not math.isfinite(time_s) or time_s < self.last_time_s:
            raise ValueError("facility time must be monotonic")
        events = []
        # Process historical departures/admissions in chronological order, so
        # large output intervals do not create instantaneous admissions.
        cursor = max(0, self.last_time_s)
        while cursor <= time_s:
            for person, entry in sorted(list(self.occupants.items())):
                if entry["release_s"] <= cursor:
                    del self.occupants[person]
                    events.append({"type": "discharge", "person": person, "time_s": cursor})
            accessible_used = sum(item["accessible"] for item in self.occupants.values())
            candidates = [item for item in self.queue if item[1] <= cursor and
                          (not item[2] or accessible_used < self.accessible_capacity)]
            if (cursor >= self.opens_s and cursor >= self.next_admission_s and
                    len(self.occupants) < self.capacity and candidates):
                person, arrival, accessible = candidates[0]
                self.queue.remove(candidates[0])
                release = cursor+self.service_duration_s if self.service_duration_s else math.inf
                self.occupants[person] = {"admitted_s": cursor, "release_s": release, "accessible": accessible}
                events.append({"type": "admission", "person": person, "time_s": cursor, "waiting_s": cursor-arrival})
                self.next_admission_s = cursor+self.admission_interval_s
            future = [e["release_s"] for e in self.occupants.values() if e["release_s"] > cursor]
            future += [item[1] for item in self.queue if item[1] > cursor]
            future += [t for t in (self.opens_s, self.next_admission_s) if t > cursor]
            if not future or min(future) > time_s:
                break
            cursor = min(future)
        self.last_time_s = time_s
        return events


@dataclass
class Request:
    id: str
    persons: tuple[str, ...]
    origin: str
    destination: str
    kind: str
    created_s: float
    priority: int = 1
    accessible: bool = False
    assigned: bool = False
    completed: bool = False


@dataclass
class Vehicle:
    id: str
    kind: str
    location: str
    capacity: int
    accessible: bool = True
    deployment_cost: float = 100
    cost_per_second: float = .1
    state: str = "available"
    deployed: bool = False
    task: str | None = None
    pickup_s: float | None = None
    delivery_s: float | None = None


class Dispatcher:
    def __init__(self, vehicles, budget=100000, pickup_service_s=60, unload_service_s=30):
        self.vehicles = {v.id: v for v in vehicles}
        if len(self.vehicles) != len(vehicles):
            raise ValueError("duplicate vehicles")
        if any(not math.isfinite(x) or x < 0 for x in (budget, pickup_service_s, unload_service_s)):
            raise ValueError("invalid budget or service duration")
        for v in vehicles:
            if v.capacity < 1 or any(not math.isfinite(x) or x < 0 for x in (v.deployment_cost, v.cost_per_second)):
                raise ValueError("invalid vehicle")
        self.budget = budget
        self.spent = 0.0
        self.reserved = 0.0
        self.requests = {}
        self.person_ids = set()
        self.trips = {}
        self.pickup_service_s, self.unload_service_s = pickup_service_s, unload_service_s
        self.last_time_s = 0

    def submit(self, request):
        if (request.id in self.requests or not request.persons or
                len(set(request.persons)) != len(request.persons) or
                any(p in self.person_ids for p in request.persons) or
                not math.isfinite(request.created_s) or request.created_s < self.last_time_s or
                not isinstance(request.priority, int) or request.priority < 1):
            raise ValueError("duplicate/invalid request")
        self.requests[request.id] = request
        self.person_ids.update(request.persons)

    def dispatch(self, time_s, travel_time, horizon_s=7200):
        """CP-SAT maximizes served priority, then minimizes travel/service time.

        A request is indivisible. travel_time(vehicle, origin, destination) must
        return a finite nonnegative duration or None for inaccessible paths.
        Routes are fixed for the assignment horizon; dynamic interruption is
        explicit via interrupt(), not hidden teleportation.
        """
        if not math.isfinite(horizon_s) or horizon_s <= 0:
            raise ValueError("invalid horizon")
        events = self.advance(time_s)
        model, candidates = cp_model.CpModel(), {}
        for vid, vehicle in sorted(self.vehicles.items()):
            if vehicle.state != "available":
                continue
            for rid, request in sorted(self.requests.items()):
                if request.assigned or request.completed or request.created_s > time_s:
                    continue
                if request.kind != vehicle.kind or len(request.persons) > vehicle.capacity or (request.accessible and not vehicle.accessible):
                    continue
                outbound = travel_time(vehicle, vehicle.location, request.origin)
                inbound = travel_time(vehicle, request.origin, request.destination)
                if outbound is None or inbound is None:
                    continue
                if any(not math.isfinite(t) or t < 0 for t in (outbound, inbound)):
                    raise ValueError("invalid routed travel time")
                duration = outbound + inbound + self.pickup_service_s + self.unload_service_s
                if duration > horizon_s:
                    continue
                deploy = 0 if vehicle.deployed else vehicle.deployment_cost
                cost = deploy + duration*vehicle.cost_per_second
                candidates[vid, rid] = (model.new_bool_var(f"{vid}/{rid}"), duration, outbound, cost, deploy)
        for vid in self.vehicles:
            model.add(sum(v[0] for (v_id, _), v in candidates.items() if v_id == vid) <= 1)
        for rid in self.requests:
            model.add(sum(v[0] for (_, r_id), v in candidates.items() if r_id == rid) <= 1)
        available_cents = max(0, math.floor((self.budget-self.spent-self.reserved)*100 + 1e-8))
        model.add(sum(math.ceil(v[3]*100)*v[0] for v in candidates.values()) <= available_cents)
        # This multiplier makes priority dominate all duration tie-breakers.
        multiplier = math.ceil(horizon_s)*max(1, len(self.vehicles))+1
        model.maximize(sum(v[0]*(self.requests[rid].priority*len(self.requests[rid].persons)*multiplier -
                                math.ceil(v[1])) for (_, rid), v in candidates.items()))
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 2
        solver.parameters.num_search_workers = 1
        solver.parameters.random_seed = 42
        status = solver.solve(model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return events
        for (vid, rid), (variable, duration, outbound, cost, deploy) in candidates.items():
            if not solver.value(variable):
                continue
            v, r = self.vehicles[vid], self.requests[rid]
            r.assigned = True
            v.deployed = True
            v.state, v.task = "to_pickup", rid
            v.pickup_s = time_s+outbound+self.pickup_service_s
            v.delivery_s = time_s+duration
            self.spent += deploy
            reserve = cost-deploy
            self.reserved += reserve
            self.trips[vid] = {"start_s": time_s, "charged_until_s": time_s, "remaining_cost": reserve}
            events.append({"type": "dispatch", "vehicle": vid, "request": rid, "time_s": time_s})
        return events

    def advance(self, time_s):
        if not math.isfinite(time_s) or time_s < self.last_time_s:
            raise ValueError("dispatch clock must be monotonic")
        events = []
        for vid, v in sorted(self.vehicles.items()):
            if v.task is None or v.state == "interrupted":
                continue
            trip, request = self.trips[vid], self.requests[v.task]
            through = min(time_s, v.delivery_s)
            cost = max(0, through-trip["charged_until_s"])*v.cost_per_second
            self.spent += cost
            self.reserved -= cost
            trip["remaining_cost"] -= cost
            trip["charged_until_s"] = through
            if time_s >= v.pickup_s and v.state == "to_pickup":
                v.state = "to_destination"
                events.append({"type": "pickup", "request": request.id, "time_s": v.pickup_s})
            if time_s >= v.delivery_s:
                events.append({"type": "delivery", "request": request.id, "time_s": v.delivery_s})
                request.completed = True
                self.person_ids.difference_update(request.persons)
                v.location, v.state, v.task = request.destination, "available", None
                del self.trips[vid]
        self.last_time_s = time_s
        if self.spent+self.reserved > self.budget+1e-6 or self.reserved < -1e-6:
            raise ArithmeticError("budget accounting invariant failed")
        return sorted(events, key=lambda e: (e["time_s"], e["request"]))

    def interrupt(self, vehicle_id, time_s):
        events = self.advance(time_s)
        v = self.vehicles[vehicle_id]
        if v.task is None or v.state == "interrupted":
            raise ValueError("vehicle has no active trip")
        self.reserved -= self.trips[vehicle_id]["remaining_cost"]
        self.trips[vehicle_id]["remaining_cost"] = 0
        v.state = "interrupted"
        # Keep request assigned: passengers cannot be dispatched twice.
        events.append({"type": "trip_interrupted", "vehicle": vehicle_id, "time_s": time_s})
        return events
