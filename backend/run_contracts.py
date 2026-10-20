"""Immutable run/experiment contracts, with explicit resource budgets."""
from typing import Literal
from pydantic import Field, model_validator
from backend.contracts import Contract, FloodConfig
from backend.agents import BehaviorConfig


class Policy(Contract):
    temporary_shelters: bool = False
    buses: int = Field(default=2, ge=0, le=30)
    ambulances: int = Field(default=2, ge=0, le=30)
    rescue_boats: int = Field(default=1, ge=0, le=20)
    prioritize_vulnerable: bool = False
    budget: float = Field(default=100000, ge=0, le=10000000)


class RunConfig(Contract):
    name: str = Field(default="Riverton flood evacuation", min_length=1, max_length=120)
    seed: int = Field(default=42, ge=0, le=2**32-1)
    population: int = Field(default=800, ge=8, le=78500)
    flood: FloodConfig = Field(default_factory=lambda: FloodConfig(
        duration_s=1800, output_interval_s=30, mesh_cells_per_axis=8))
    behavior: BehaviorConfig = Field(default_factory=BehaviorConfig)
    policy: Policy = Field(default_factory=Policy)
    traffic_dt_s: float = Field(default=2, gt=0, le=2)
    visual_agents: int = Field(default=400, ge=0, le=2000)

    @model_validator(mode="after")
    def bound_work(self):
        if self.policy.temporary_shelters and self.policy.budget < 1000:
            raise ValueError("temporary shelter activation requires at least 1000 budget units")
        estimated_cells = 4*self.flood.mesh_cells_per_axis**2*(4 if self.flood.channel_refinement else 1)
        if estimated_cells*(1+self.flood.duration_s/self.flood.output_interval_s) > 8_000_000:
            raise ValueError("field artifact budget exceeded; reduce mesh resolution or output frequency")
        if self.flood.duration_s / self.traffic_dt_s * self.population > 50_000_000:
            raise ValueError("run exceeds 50 million agent ticks; reduce population or duration")
        if self.flood.output_interval_s % self.traffic_dt_s > 1e-8:
            raise ValueError("output interval must be a multiple of traffic timestep")
        if self.flood.duration_s % self.flood.output_interval_s > 1e-8:
            raise ValueError("duration must be a multiple of output interval")
        return self


class ExperimentConfig(Contract):
    kind: Literal["comparison", "monte_carlo", "optimization", "sensitivity"]
    config: RunConfig
    trials: int = Field(default=4, ge=2, le=50)
    evaluations: int = Field(default=12, ge=8, le=48)

    @model_validator(mode="after")
    def bounded_batch(self):
        if self.kind == "comparison" and self.config.policy.budget < 1000:
            raise ValueError("policy comparison requires at least 1000 budget units for the Shelter-first alternative")
        if self.config.population > 2000 or self.config.flood.duration_s > 7200:
            raise ValueError("interactive experiments limited to 2000 agents and two hours")
        return self
