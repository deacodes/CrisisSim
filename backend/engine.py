"""Deterministic, one-way-coupled flood/agent/traffic/resource scheduler.

Checkpoint restore recomputes from immutable input and command history. It is
deliberately not a partial ANUGA state masquerading as an exact restart.
"""
from collections import deque
from dataclasses import asdict
import math

import networkx as nx
import numpy as np
from scipy.spatial import cKDTree

from backend.agents import State, generate_population
from backend.city import build_city, elevation
from backend.hydrology import FloodModel
from backend.metrics import summarize_agents
from backend.operations import Dispatcher, Facility, Request, Vehicle
from backend.run_contracts import RunConfig, Policy
from backend.transport import RoadNetwork


def population_city(population):
    city = build_city()
    weights = np.array([n["population"] for n in city["neighborhoods"]], dtype=float)
    raw = weights/weights.sum()*(population-8)
    counts = np.floor(raw).astype(int)+1
    for i in np.argsort(-(raw-np.floor(raw)), kind="stable")[:population-int(counts.sum())]:
        counts[i] += 1
    for n, count in zip(city["neighborhoods"], counts):
        n["population"] = int(count)
    city["population"] = population
    city["reference_population"] = 78500
    city["population_note"] = "Individual synthetic residents; no extrapolation to reference population."
    scale = population/78500
    for facility in city["facilities"]:
        facility["capacity"] = max(1, round(facility["capacity"]*scale))
    # Deck elevations are separate from channel terrain.
    for road in city["roads"]:
        road["deck_elevation_m"] = (
            float(max(elevation(*p) for p in road["geometry"]))+.5 if road["bridge"] else None)
    return city


class PacketTraffic:
    """Integer person-vehicle packets with CTM-derived sending credits.

    One self-driving person is one vehicle. Cells have FIFO queues, receiving
    rate credits, finite storage and a one-tick transfer delay. Credits are
    bounded to prevent unused capacity accumulating indefinitely.
    """
    def __init__(self, network):
        self.network = network
        self.queues = {k: [deque() for _ in range(l.cells)] for k, l in network.links.items()}
        self.send = {k: np.zeros(l.cells) for k, l in network.links.items()}
        self.receive = {k: np.zeros(l.cells) for k, l in network.links.items()}
        self.paths = {}
        self.index = {}
        self.positions = {}

    def enter(self, aid, path):
        if aid in self.paths or len(path) < 2:
            return False
        key = (path[0], path[1])
        link = self.network.links[key]
        if link.closed or len(self.queues[key][0]) >= math.floor(link.storage) or self.receive[key][0] < 1:
            return False
        self.receive[key][0] -= 1
        self.queues[key][0].append(aid)
        self.paths[aid], self.index[aid] = path, 0
        self.positions[aid] = (key, 0)
        return True

    def step(self, dt):
        completed = []
        for key, link in self.network.links.items():
            link.occupancy[:] = [len(q) for q in self.queues[key]]
            sending, receiving = link.sending_receiving(dt)
            self.send[key] = np.minimum(1, self.send[key]+sending)
            self.receive[key] = np.minimum(1, self.receive[key]+receiving)
            self.send[key][link.occupancy == 0] = 0
            if link.closed:
                self.send[key][:] = self.receive[key][:] = 0
        moved = set()
        for key in sorted(self.queues):
            link = self.network.links[key]
            if link.closed:
                continue
            for cell in reversed(range(link.cells)):
                q = self.queues[key][cell]
                if not q or self.send[key][cell] < 1 or q[0] in moved:
                    continue
                aid = q[0]
                if cell+1 < link.cells:
                    target, target_cell = key, cell+1
                else:
                    path, index = self.paths[aid], self.index[aid]
                    if index+2 >= len(path):
                        q.popleft()
                        completed.append(aid)
                        self.send[key][cell] -= 1
                        del self.paths[aid], self.index[aid], self.positions[aid]
                        continue
                    target, target_cell = (path[index+1], path[index+2]), 0
                target_link = self.network.links[target]
                if (target_link.closed or self.receive[target][target_cell] < 1 or
                        len(self.queues[target][target_cell]) >= math.floor(target_link.storage)):
                    continue
                q.popleft()
                self.queues[target][target_cell].append(aid)
                self.send[key][cell] -= 1
                self.receive[target][target_cell] -= 1
                self.positions[aid] = (target, target_cell)
                if target != key:
                    self.index[aid] += 1
                moved.add(aid)
        for key, link in self.network.links.items():
            link.occupancy[:] = [len(q) for q in self.queues[key]]
            link.validate()
        self.network.revision += 1
        self.network._cache.clear()
        return completed

    def reroute(self):
        for aid, (key, cell) in sorted(self.positions.items()):
            if cell != self.network.links[key].cells-1 or self.network.links[key].closed:
                continue
            path = self.network.route(key[1], self.paths[aid][-1])
            if path:
                self.paths[aid], self.index[aid] = [key[0]]+path, 0


class Simulation:
    def __init__(self, config: RunConfig):
        self.config = config
        self.city = population_city(config.population)
        self.hydro = FloodModel(config.flood)
        self.agents = generate_population(self.city, config.seed, config.behavior)
        self.city["buildings"] = [{"id": a.household, "x": a.x, "y": a.y}
                                 for a in self.agents[::max(1, len(self.agents)//100)]]
        self.by_id = {a.id: a for a in self.agents}
        self.network = RoadNetwork(self.city)
        self.traffic = PacketTraffic(self.network)
        self.nodes = {n["id"]: n for n in self.city["nodes"]}
        self.node_ids = list(self.nodes)
        self.node_tree = cKDTree([[n["x"], n["y"]] for n in self.nodes.values()])
        self.facilities = {}
        self.facility_nodes = {}
        for f in self.city["facilities"]:
            if f["kind"] == "depot":
                continue
            self.facilities[f["id"]] = Facility(f["id"], f["capacity"], max(1, f["capacity"]//3),
                service_duration_s=900 if f["kind"] == "hospital" else None)
            self.facility_nodes[f["id"]] = f["node"]
        self.policy = config.policy
        self.fixed_cost = 0
        self.events = []
        self.time_s = 0.0
        self.frame = None
        self.access = {}
        self.reservations = {}
        self.requested = set()
        self.active_trips = {}
        self.boat_graph = nx.Graph()
        self.apply_initial_policy()
        vehicles = ([Vehicle(f"bus-{i}", "bus", "v0-1", 12) for i in range(self.policy.buses)] +
                    [Vehicle(f"ambulance-{i}", "ambulance", "v0-1", 1) for i in range(self.policy.ambulances)] +
                    [Vehicle(f"boat-{i}", "boat", "v3-0", 4) for i in range(self.policy.rescue_boats)])
        self.dispatcher = Dispatcher(vehicles, budget=max(0, self.policy.budget-self.fixed_cost))

    def apply_initial_policy(self):
        if self.policy.temporary_shelters:
            cost = 1000
            if cost > self.policy.budget:
                raise ValueError("temporary shelter activation exceeds budget")
            self.fixed_cost += cost
            capacity = max(10, self.config.population//3)
            self.facilities["shelter-temporary"] = Facility("shelter-temporary", capacity, capacity//2, opens_s=300)
            self.facility_nodes["shelter-temporary"] = "v6-4"
            n = self.nodes["v6-4"]
            self.city["facilities"].append({"id": "shelter-temporary", "node": "v6-4",
                "kind": "shelter", "capacity": capacity, "x": n["x"], "y": n["y"], "provenance": "assumed"})

    def event(self, kind, **data):
        self.events.append({"type": kind, "time_s": self.time_s, **data})

    def apply_policy(self, changes):
        self.policy = Policy.model_validate(self.policy.model_dump() | changes)
        for request in self.dispatcher.requests.values():
            if not request.assigned and not request.completed:
                vulnerable = any(self.by_id[aid].mobility_impaired for aid in request.persons)
                request.priority = 5 if self.policy.prioritize_vulnerable and vulnerable else 1

    def road_depth(self, road, points):
        depth, _ = self.hydro.sample(points, self.frame)
        if road["bridge"]:
            _, ids = self.hydro.tree.query(points)
            return np.maximum(0, self.frame["stage_m"][ids]-road["deck_elevation_m"])
        return np.maximum(0, depth)

    def flood_update(self, frame):
        self.frame = frame
        before = self.network.closed["vehicle"].copy()
        self.network.update_flood(self.road_depth)
        reported = set()
        for edge in sorted(before ^ self.network.closed["vehicle"]):
            rid = self.network.roads[edge]["id"]
            if rid in reported:
                continue
            reported.add(rid)
            self.event("road_closed" if edge in self.network.closed["vehicle"] else "road_reopened",
                       road_id=rid)
        self.traffic.reroute()
        # Boat access uses inundated road corridors only, an explicit approximation.
        self.boat_graph = nx.Graph()
        for edge, road in self.network.roads.items():
            points = np.linspace(*np.asarray(road["geometry"]), 15)
            depths, _ = self.hydro.sample(points, frame)
            if np.min(depths) >= .15:
                self.boat_graph.add_edge(*edge, weight=road["length_m"]/3)
        for vid, trip in list(self.active_trips.items()):
            vehicle = self.dispatcher.vehicles[vid]
            if vehicle.task and vehicle.state != "interrupted":
                graph = self.boat_graph if vehicle.kind == "boat" else self.network.graph
                invalid = any(not graph.has_edge(a, b) or
                              (vehicle.kind != "boat" and (a, b) in self.network.closed["vehicle"])
                              for a, b in self.remaining_resource_edges(vehicle))
                if invalid:
                    trip["stopped_position"] = self.resource_position(vehicle)
                    for event in self.dispatcher.interrupt(vid, self.time_s):
                        self.consume_dispatch(event)
        for fid, facility in self.facilities.items():
            node = self.nodes[self.facility_nodes[fid]]
            depth, _ = self.hydro.sample([[node["x"], node["y"]]], frame)
            unsafe = depth[0] >= .3
            # Prevent new admissions; occupied facilities remain flagged exposed.
            facility.opens_s = math.inf if unsafe else (300 if fid == "shelter-temporary" else 0)

    def route_for(self, origin, destination, kind="bus"):
        if kind == "boat":
            try:
                return nx.shortest_path(self.boat_graph, origin, destination, weight="weight")
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                return None
        return self.network.route(origin, destination)

    def choose_facility(self, origin, kind="shelter", mode="bus"):
        candidates = []
        for fid, facility in self.facilities.items():
            if not fid.startswith(kind) or facility.opens_s > self.time_s:
                continue
            reserved = sum(target == fid for target in self.reservations.values())
            if len(facility.occupants)+len(facility.queue)+reserved >= facility.capacity:
                continue
            route = self.route_for(origin, self.facility_nodes[fid], mode)
            if route:
                length = sum(self.network.roads[a, b]["length_m"] for a, b in zip(route[:-1], route[1:]))
                candidates.append((length, fid, route))
        return min(candidates, default=None)

    def enqueue(self, agent, time_s):
        if agent.state in (State.TRAVELLING, State.RESCUING):
            agent.transition(State.ADMISSION, time_s)
        fid = agent.destination
        self.reservations.pop(agent.id, None)
        self.facilities[fid].enqueue(agent.id, time_s, agent.mobility_impaired)
        node = self.nodes[self.facility_nodes[fid]]
        agent.x, agent.y = node["x"], node["y"]

    def consume_dispatch(self, event):
        self.events.append(event)
        request = self.dispatcher.requests.get(event.get("request"))
        if request is None:
            return
        for aid in request.persons:
            agent = self.by_id[aid]
            if event["type"] == "pickup":
                if agent.state in (State.WAITING, State.STRANDED, State.RESCUE):
                    agent.transition(State.RESCUING, event["time_s"])
            elif event["type"] == "delivery":
                self.enqueue(agent, event["time_s"])
                self.requested.discard(agent.id)

    def travel_time(self, vehicle, origin, destination):
        path = self.route_for(origin, destination, vehicle.kind)
        if path is None:
            return None
        return sum(self.boat_graph[a][b]["weight"] if vehicle.kind == "boat" else
                   self.network.links[a, b].travel_time()
                   for a, b in zip(path[:-1], path[1:]))

    def update_agents(self, dt):
        time = self.time_s
        depth, _ = self.hydro.sample([[a.x, a.y] for a in self.agents], self.frame)
        for agent, water in zip(self.agents, depth):
            agent.expose(max(0, float(water)), dt)
            agent.update_behavior(time)
            # Immediate danger overrides warning receipt and preparation delays.
            if water >= .15 and agent.state in (State.HOME, State.WARNED, State.PREPARING):
                agent.transition(State.RESCUE, time)
                self.access.pop(agent.id, None)
                self.event("resident_needs_rescue", agent=agent.id)
            if agent.state == State.SHELTERED and water >= .3:
                if agent.destination in self.facilities:
                    self.facilities[agent.destination].occupants.pop(agent.id, None)
                agent.transition(State.RESCUE, time)
                self.access.pop(agent.id, None)
                self.event("refuge_became_unsafe", agent=agent.id)
            if agent.id in self.traffic.paths or agent.id in self.requested or agent.state in (
                    State.SHELTERED, State.ADMISSION, State.RESCUING):
                continue
            if agent.state == State.PREPARING and time < agent.ready_s:
                continue
            if agent.state not in (State.PREPARING, State.WAITING, State.STRANDED, State.RESCUE):
                continue
            _, index = self.node_tree.query([agent.x, agent.y])
            origin = self.node_ids[index]
            node = self.nodes[origin]
            # Off-network access is explicit pedestrian travel, not teleportation.
            if agent.id not in self.access:
                distance = math.hypot(node["x"]-agent.x, node["y"]-agent.y)
                self.access[agent.id] = {"start": time, "duration": distance/1.2,
                    "x": agent.x, "y": agent.y, "node": origin}
            access = self.access[agent.id]
            origin = access["node"]
            node = self.nodes[origin]
            if water >= .15:
                if agent.state != State.RESCUE:
                    agent.transition(State.RESCUE, time)
                # No invented boat pickup far from navigable corridor.
                if math.hypot(node["x"]-agent.x, node["y"]-agent.y) > 30:
                    continue
            else:
                progress = min(1, (time-access["start"])/max(access["duration"], 1e-9))
                agent.x = access["x"]+(node["x"]-access["x"])*progress
                agent.y = access["y"]+(node["y"]-access["y"])*progress
                if progress < 1:
                    continue
            assistance = agent.mobility_impaired or agent.transit_dependent or agent.state == State.RESCUE
            mode = "boat" if agent.state == State.RESCUE else "ambulance" if agent.mobility_impaired else "bus"
            destination_type = "hospital" if mode == "ambulance" else "shelter"
            choice = self.choose_facility(origin, destination_type, mode if assistance else "bus")
            if not choice:
                if agent.state in (State.PREPARING, State.WAITING):
                    agent.transition(State.STRANDED, time)
                continue
            _, fid, path = choice
            agent.destination = fid
            if assistance:
                priority = 5 if self.policy.prioritize_vulnerable and agent.mobility_impaired else 1
                self.dispatcher.submit(Request(f"{agent.id}@{time}", (agent.id,), origin, self.facility_nodes[fid],
                    mode, time, priority=priority, accessible=agent.mobility_impaired))
                self.requested.add(agent.id)
                self.reservations[agent.id] = fid
            elif len(path) == 1:
                agent.transition(State.TRAVELLING, time)
                self.enqueue(agent, time)
            elif self.traffic.enter(agent.id, path):
                agent.transition(State.TRAVELLING, time)
                self.reservations[agent.id] = fid

    def tick(self, dt):
        self.time_s += dt
        for event in self.dispatcher.advance(self.time_s):
            self.consume_dispatch(event)
        for aid in self.traffic.step(dt):
            self.enqueue(self.by_id[aid], self.time_s)
        for aid, (edge, cell) in self.traffic.positions.items():
            a, b = self.nodes[edge[0]], self.nodes[edge[1]]
            fraction = (cell+.5)/self.network.links[edge].cells
            self.by_id[aid].x = a["x"]+(b["x"]-a["x"])*fraction
            self.by_id[aid].y = a["y"]+(b["y"]-a["y"])*fraction
        self.update_agents(dt)
        if round(self.time_s/self.config.traffic_dt_s) % max(1, round(30/self.config.traffic_dt_s)) == 0:
            for event in self.dispatcher.dispatch(self.time_s, self.travel_time):
                self.consume_dispatch(event)
                if event["type"] == "dispatch":
                    v = self.dispatcher.vehicles[event["vehicle"]]
                    r = self.dispatcher.requests[event["request"]]
                    first = self.route_for(v.location, r.origin, v.kind)
                    second = self.route_for(r.origin, r.destination, v.kind)
                    self.active_trips[v.id] = {"path": first+second[1:], "first": first, "second": second,
                                              "start_s": self.time_s}
        for vehicle in self.dispatcher.vehicles.values():
            if vehicle.task:
                x, y = self.resource_position(vehicle)
                for aid in self.dispatcher.requests[vehicle.task].persons:
                    if self.by_id[aid].state == State.RESCUING:
                        self.by_id[aid].x, self.by_id[aid].y = x, y
        for fid, facility in self.facilities.items():
            for event in facility.advance(self.time_s):
                self.events.append({**event, "facility": fid})
                if event["type"] == "admission":
                    agent = self.by_id[event["person"]]
                    agent.transition(State.SHELTERED, event["time_s"])
        if len(self.traffic.paths) != sum(len(q) for qs in self.traffic.queues.values() for q in qs):
            raise ArithmeticError("traffic packet conservation failed")

    def resource_leg(self, vehicle):
        """Use the same progress calculation for rendering and hazard checks."""
        trip = self.active_trips[vehicle.id]
        if vehicle.state == "to_pickup":
            path = trip["first"]
            duration = vehicle.pickup_s-trip["start_s"]-self.dispatcher.pickup_service_s
            fraction = min(1, max(0, (self.time_s-trip["start_s"])/max(duration, 1e-9)))
        else:
            path = trip["second"]
            duration = vehicle.delivery_s-vehicle.pickup_s-self.dispatcher.unload_service_s
            fraction = min(1, max(0, (self.time_s-vehicle.pickup_s)/max(duration, 1e-9)))
        return path, fraction

    def remaining_resource_edges(self, vehicle):
        path, fraction = self.resource_leg(vehicle)
        edges = list(zip(path[:-1], path[1:]))
        lengths = [self.network.roads[edge]["length_m"] for edge in edges]
        distance = sum(lengths)*fraction
        remaining = []
        for i, length in enumerate(lengths):
            if distance < length-1e-8:
                remaining = edges[i:]
                break
            distance -= length
        if vehicle.state == "to_pickup":
            second = self.active_trips[vehicle.id]["second"]
            remaining += list(zip(second[:-1], second[1:]))
        return remaining

    def resource_position(self, vehicle):
        trip = self.active_trips.get(vehicle.id)
        if not trip or not vehicle.task:
            node = self.nodes[vehicle.location]
            return node["x"], node["y"]
        if vehicle.state == "interrupted":
            return trip["stopped_position"]
        path, fraction = self.resource_leg(vehicle)
        lengths = [self.network.roads[a, b]["length_m"] for a, b in zip(path[:-1], path[1:])]
        distance = sum(lengths)*fraction
        for i, length in enumerate(lengths):
            if distance <= length:
                a, b = self.nodes[path[i]], self.nodes[path[i+1]]
                f = distance/max(length, 1e-9)
                return a["x"]+(b["x"]-a["x"])*f, a["y"]+(b["y"]-a["y"])*f
            distance -= length
        node = self.nodes[path[-1]]
        return node["x"], node["y"]

    def snapshot(self):
        raw = [asdict(a) for a in self.agents]
        metrics = summarize_agents(raw, self.time_s)
        metrics["cost"] = self.fixed_cost+self.dispatcher.spent
        metrics["reserved_cost"] = self.dispatcher.reserved
        metrics["closed_roads"] = len({self.network.roads[k]["id"] for k in self.network.closed["vehicle"]})
        metrics["mean_exposure_depth_seconds"] = float(np.mean([a.exposure_depth_seconds for a in self.agents]))
        metrics["max_depth_m"] = float(np.max(self.frame["depth_m"]))
        metrics["water_volume_m3"] = float(np.dot(self.frame["depth_m"], self.hydro.domain.areas))
        metrics["facilities"] = {fid: {"occupancy": len(f.occupants), "capacity": f.capacity,
                                      "queued": len(f.queue), "open": f.opens_s <= self.time_s}
                                  for fid, f in self.facilities.items()}
        sample = self.agents[::max(1, math.ceil(len(self.agents)/max(1, self.config.visual_agents)))][:self.config.visual_agents]
        return {"time_s": self.time_s, "metrics": metrics,
                "agents": [{"id": a.id, "x": a.x, "y": a.y, "state": a.state.value,
                            "neighborhood": a.neighborhood} for a in sample],
                "roads": [{"id": r["id"], "closed": (r["source"], r["target"]) in self.network.closed["vehicle"]}
                          for r in self.city["roads"]],
                "routes": [{"agent": aid, "nodes": path} for aid, path in list(sorted(self.traffic.paths.items()))[:100]],
                "resources": [{"id": v.id, "kind": v.kind, "state": v.state,
                               "node": v.location, "request": v.task,
                               "x": self.resource_position(v)[0], "y": self.resource_position(v)[1]}
                              for v in self.dispatcher.vehicles.values()],
                "events": self.events.copy(),
                "mass_residual_m3": self.frame["mass_residual_m3"]}

    def frames(self):
        for frame in self.hydro.frames():
            target = frame["time_s"]
            if self.frame is None:
                self.flood_update(frame)
            else:
                # Hold last known hazard between updates: no future knowledge.
                while self.time_s < target-1e-8:
                    self.tick(min(self.config.traffic_dt_s, target-self.time_s))
                self.flood_update(frame)
            yield self.snapshot(), frame
