"""Directed routing and conservative cell-transmission traffic components.

Traffic is fluid vehicle equivalents; individual agent/vehicle reconciliation
belongs to the coupled scheduler. No physical evacuation is inferred from flows.
"""
from dataclasses import dataclass
import math
import networkx as nx
import numpy as np


@dataclass
class CellLink:
    length_m: float
    cells: int
    free_speed_m_s: float = 10
    wave_speed_m_s: float = 5
    capacity_vehicles_s: float = .5
    jam_density_vehicles_m: float = .15

    def __post_init__(self):
        values = (self.length_m, self.free_speed_m_s, self.wave_speed_m_s,
                  self.capacity_vehicles_s, self.jam_density_vehicles_m)
        if self.cells < 1 or any(not math.isfinite(v) or v <= 0 for v in values):
            raise ValueError("positive finite traffic parameters required")
        self.dx = self.length_m/self.cells
        self.storage = self.dx*self.jam_density_vehicles_m
        critical_capacity = self.jam_density_vehicles_m / (
            1/self.free_speed_m_s + 1/self.wave_speed_m_s)
        if self.capacity_vehicles_s > critical_capacity + 1e-12:
            raise ValueError("capacity exceeds triangular fundamental diagram")
        self.occupancy = np.zeros(self.cells)
        self.closed = False
        self.entered = self.exited = 0.0

    @property
    def max_dt(self):
        return self.dx/max(self.free_speed_m_s, self.wave_speed_m_s)

    def sending_receiving(self, dt):
        if not math.isfinite(dt) or dt <= 0 or dt > self.max_dt + 1e-12:
            raise ValueError("traffic timestep violates CFL constraint")
        sending = np.minimum(self.occupancy*self.free_speed_m_s*dt/self.dx,
                             self.capacity_vehicles_s*dt)
        receiving = np.minimum((self.storage-self.occupancy)*self.wave_speed_m_s*dt/self.dx,
                               self.capacity_vehicles_s*dt)
        if self.closed:
            # Conservative stop-in-place rule; rescue handled externally.
            sending[:] = 0
            receiving[:] = 0
        return sending, receiving

    def advance(self, dt, requested_in=0, allowed_out=math.inf):
        if requested_in < 0 or allowed_out < 0 or not math.isfinite(requested_in):
            raise ValueError("nonnegative finite inflow and nonnegative outflow required")
        if math.isnan(allowed_out):
            raise ValueError("invalid outflow")
        send, receive = self.sending_receiving(dt)
        flows = np.minimum(send[:-1], receive[1:])
        entering, exiting = min(requested_in, receive[0]), min(allowed_out, send[-1])
        self.occupancy[:-1] -= flows
        self.occupancy[1:] += flows
        self.occupancy[0] += entering
        self.occupancy[-1] -= exiting
        self.entered += entering
        self.exited += exiting
        self.validate()
        return float(entering), float(exiting)

    def validate(self):
        if not np.isfinite(self.occupancy).all() or self.occupancy.min() < -1e-9 or self.occupancy.max() > self.storage+1e-9:
            raise ArithmeticError("traffic conservation/capacity failure")

    def travel_time(self):
        return self.length_m/self.free_speed_m_s + self.occupancy.sum()/self.capacity_vehicles_s


class RoadNetwork:
    """Bidirectional synthetic roads; each direction has independent cell storage."""
    def __init__(self, city, cell_length_m=100):
        if not math.isfinite(cell_length_m) or cell_length_m <= 0:
            raise ValueError("positive cell length required")
        self.graph = nx.DiGraph()
        self.links = {}
        self.roads = {}
        self.closed = {"vehicle": set(), "pedestrian": set()}
        self.revision = 0
        self._cache = {}
        for node in city["nodes"]:
            self.graph.add_node(node["id"], **node)
        for road in city["roads"]:
            for a, b in ((road["source"], road["target"]), (road["target"], road["source"])):
                key = (a, b)
                self.graph.add_edge(a, b, road_id=road["id"])
                self.roads[key] = road
                self.links[key] = CellLink(road["length_m"], max(1, math.ceil(road["length_m"]/cell_length_m)),
                                          road["speed_m_s"], capacity_vehicles_s=road["capacity_vehicles_s"],
                                          jam_density_vehicles_m=road["storage_vehicles"]/road["length_m"])

    def update_flood(self, sample_depth, vehicle_limit=.3, pedestrian_limit=.15, spacing_m=10):
        """sample_depth takes Nx2 points and returns current surface water depths.

        Bridge road-level depth must be supplied by the caller (water stage minus
        deck elevation). Ground/channel depth is not bridge-deck depth.
        """
        if min(vehicle_limit, pedestrian_limit, spacing_m) <= 0:
            raise ValueError("positive thresholds and spacing required")
        closed = {"vehicle": set(), "pedestrian": set()}
        for key, road in self.roads.items():
            points = []
            geometry = np.asarray(road["geometry"], dtype=float)
            for a, b in zip(geometry[:-1], geometry[1:]):
                points.extend(np.linspace(a, b, max(2, math.ceil(np.linalg.norm(b-a)/spacing_m)+1)))
            depths = np.asarray(sample_depth(road, np.asarray(points)), dtype=float)
            if depths.shape != (len(points),) or not np.isfinite(depths).all() or (depths < 0).any():
                raise ValueError("invalid road-level flood samples")
            for mode, threshold in (("vehicle", vehicle_limit), ("pedestrian", pedestrian_limit)):
                if depths.max() >= threshold:
                    closed[mode].add(key)
        self.closed = closed
        for key, link in self.links.items():
            link.closed = key in closed["vehicle"]
        self.revision += 1
        self._cache.clear()

    def route(self, source, target, mode="vehicle"):
        if mode not in self.closed:
            raise ValueError("unsupported mode")
        key = (self.revision, source, target, mode)
        if key not in self._cache:
            available = nx.subgraph_view(self.graph, filter_edge=lambda a, b: (a, b) not in self.closed[mode])
            def weight(a, b, data):
                return self.links[a, b].travel_time() if mode == "vehicle" else self.roads[a, b]["length_m"]/1.2
            try:
                result = nx.shortest_path(available, source, target, weight=weight)
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                result = None
            self._cache[key] = result
        result = self._cache[key]
        return list(result) if result else None

    def step(self, dt, turning, demand=None, exits=()):
        """Simultaneous node allocation with proportional receiving-side sharing.

        turning maps incoming directed link to {outgoing link: fraction}.
        Fractions sum to one; unspecified incoming links queue, not disappear.
        This is non-FIFO turning allocation (not lane-specific junction physics).
        Demand is admitted only into remaining receiving space. Caller retains
        unadmitted external demand. Explicit exit links drain to modeled exits.
        """
        demand = demand or {}
        for key, value in demand.items():
            if key not in self.links or not math.isfinite(value) or value < 0:
                raise ValueError("invalid external demand")
        if any(key not in self.links for key in exits):
            raise ValueError("unknown exit")
        sr = {k: link.sending_receiving(dt) for k, link in self.links.items()}
        requested = {}
        for incoming, choices in turning.items():
            if incoming not in self.links or incoming in exits:
                raise ValueError("invalid incoming junction link")
            if abs(sum(choices.values())-1) > 1e-9:
                raise ValueError("turning fractions must sum to one")
            for outgoing, fraction in choices.items():
                if outgoing not in self.links or incoming[1] != outgoing[0] or not math.isfinite(fraction) or fraction < 0:
                    raise ValueError("invalid turn")
                requested[incoming, outgoing] = sr[incoming][0][-1]*fraction
        inflow = {k: 0.0 for k in self.links}
        outflow = {k: 0.0 for k in self.links}
        for outgoing in self.links:
            contributors = [(pair, amount) for pair, amount in requested.items() if pair[1] == outgoing]
            total = sum(amount for _, amount in contributors)
            factor = min(1, sr[outgoing][1][0]/total) if total else 0
            for (incoming, _), amount in contributors:
                transfer = amount*factor
                outflow[incoming] += transfer
                inflow[outgoing] += transfer
        admitted = {}
        for key in self.links:
            admitted[key] = min(demand.get(key, 0), max(0, sr[key][1][0]-inflow[key]))
            inflow[key] += admitted[key]
            if key in exits:
                outflow[key] = float(sr[key][0][-1])
        for key, link in self.links.items():
            link.advance(dt, inflow[key], outflow[key])
        self.revision += 1
        self._cache.clear()
        return {"admitted": sum(admitted.values()),
                "exited": sum(outflow[k] for k in exits),
                "admitted_by_link": admitted}
