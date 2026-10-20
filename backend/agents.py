"""Individual population and explicit behavior; all probabilities are assumptions."""
from dataclasses import dataclass
from enum import Enum
import hashlib
import math

import numpy as np
from pydantic import Field
from backend.contracts import Contract


class State(str, Enum):
    HOME = "at_home"
    WARNED = "warned"
    PREPARING = "preparing"
    WAITING = "waiting_for_transport"
    TRAVELLING = "travelling"
    ADMISSION = "waiting_for_admission"
    SHELTERED = "sheltered"
    STRANDED = "stranded"
    RESCUE = "awaiting_rescue"
    RESCUING = "being_rescued"


ALLOWED = {
    State.HOME: {State.WARNED, State.RESCUE},
    State.WARNED: {State.PREPARING, State.RESCUE},
    State.PREPARING: {State.WAITING, State.TRAVELLING, State.STRANDED, State.RESCUE},
    State.WAITING: {State.TRAVELLING, State.RESCUE, State.RESCUING, State.STRANDED},
    State.TRAVELLING: {State.ADMISSION, State.STRANDED, State.RESCUE},
    State.ADMISSION: {State.SHELTERED, State.TRAVELLING, State.RESCUE},
    State.STRANDED: {State.TRAVELLING, State.RESCUE, State.RESCUING},
    State.RESCUE: {State.RESCUING},
    State.RESCUING: {State.ADMISSION},
    State.SHELTERED: set(),
}


class BehaviorConfig(Contract):
    warning_start_s: float = Field(default=0, ge=0)
    warning_mean_delay_s: float = Field(default=300, gt=0)
    preparation_median_s: float = Field(default=600, gt=0)
    preparation_log_sigma: float = Field(default=.5, ge=0, le=3)
    warning_receipt_fraction: float = Field(default=.98, ge=0, le=1)
    mobility_fraction: float = Field(default=.1, ge=0, le=1)
    transit_fraction: float = Field(default=.25, ge=0, le=1)


def keyed_rng(seed, key):
    digest = hashlib.sha256(f"{seed}:{key}".encode()).digest()
    return np.random.default_rng(int.from_bytes(digest[:16], "little"))


@dataclass
class Agent:
    id: str
    household: str
    neighborhood: str
    x: float
    y: float
    mobility_impaired: bool
    transit_dependent: bool
    warning_s: float
    ready_s: float
    state: State = State.HOME
    destination: str | None = None
    arrival_s: float | None = None
    exposure_depth_seconds: float = 0
    last_behavior_s: float = -1

    def transition(self, target, time_s):
        target = State(target)
        if not math.isfinite(time_s) or time_s < 0:
            raise ValueError("invalid event time")
        if target not in ALLOWED[self.state]:
            raise ValueError(f"invalid transition {self.state} -> {target}")
        self.state = target
        if target == State.SHELTERED:
            self.arrival_s = time_s
        return {"agent": self.id, "time_s": time_s, "state": target.value}

    def update_behavior(self, time_s):
        if not math.isfinite(time_s) or time_s < self.last_behavior_s:
            raise ValueError("behavior time must be monotonic")
        self.last_behavior_s = time_s
        events = []
        if self.state == State.HOME and time_s >= self.warning_s:
            events.append(self.transition(State.WARNED, time_s))
        if self.state == State.WARNED:
            events.append(self.transition(State.PREPARING, time_s))
        if self.state == State.PREPARING and time_s >= self.ready_s:
            if self.transit_dependent or self.mobility_impaired:
                events.append(self.transition(State.WAITING, time_s))
            # Self-evacuators remain ready/preparing until routing grants departure.
        return events

    def expose(self, depth_m, duration_s):
        if not all(math.isfinite(v) and v >= 0 for v in (depth_m, duration_s)):
            raise ValueError("nonnegative finite exposure required")
        self.exposure_depth_seconds += depth_m * duration_s


def generate_population(city, seed=42, config=None):
    """Exact neighborhood counts and rounded marginals; no demographic correlations.

    Household IDs group up to four successive people but do not yet enforce
    joint travel. Finite populations use exact selected counts for marginals.
    """
    config = config or BehaviorConfig()
    agents = []
    for neighborhood in city["neighborhoods"]:
        nid, count = neighborhood["id"], neighborhood["population"]
        rng = keyed_rng(seed, f"{nid}:marginals")
        mobility = set(rng.choice(count, round(count*config.mobility_fraction), replace=False))
        transit = set(rng.choice(count, round(count*config.transit_fraction), replace=False))
        receives = set(rng.choice(count, round(count*config.warning_receipt_fraction), replace=False))
        polygon = np.asarray(neighborhood["polygon"])
        from shapely.geometry import Point, Polygon
        shape = Polygon(polygon)
        for i in range(count):
            aid = f"{nid}-p{i:06d}"
            r = keyed_rng(seed, aid)
            # Rejection sampling supports nonrectangular neighborhoods too.
            for _ in range(10000):
                x, y = r.uniform(polygon.min(axis=0), polygon.max(axis=0))
                if shape.covers(Point(x, y)):
                    break
            else:
                raise ValueError("unable to sample valid residential location")
            warning = config.warning_start_s + r.exponential(config.warning_mean_delay_s) if i in receives else math.inf
            ready = warning + r.lognormal(math.log(config.preparation_median_s), config.preparation_log_sigma)
            agents.append(Agent(aid, f"{nid}-h{i//4}", nid, float(x), float(y),
                                i in mobility, i in transit, warning, ready))
    return agents
