"""SI-unit contracts. Reject unknown parameters instead of silently ignoring them."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class FloodConfig(Contract):
    duration_s: float = Field(default=600, gt=0, le=86400)
    output_interval_s: float = Field(default=30, gt=0, le=600)
    rainfall_mm_h: float = Field(default=60, ge=0, le=300)
    infiltration_mm_h: float = Field(default=5, ge=0, le=100)
    drainage_mm_h: float = Field(default=2, ge=0, le=100)
    initial_stage_m: float = Field(default=0, ge=0, le=20)
    manning_n: float = Field(default=0.035, gt=0, le=0.3)
    mesh_cells_per_axis: int = Field(default=16, ge=4, le=128)
    wet_threshold_m: float = Field(default=0.01, gt=0, le=1)

    @model_validator(mode="after")
    def limit_outputs(self):
        if self.output_interval_s > self.duration_s:
            raise ValueError("output interval exceeds duration")
        if self.duration_s / self.output_interval_s > 3000:
            raise ValueError("at most 3000 output intervals are allowed")
        return self


class Scenario(Contract):
    name: str = Field(default="Riverton verification scenario", min_length=1, max_length=120)
    city_version: Literal["riverton-local-v1"] = "riverton-local-v1"
    seed: int = Field(default=42, ge=0, le=2**32 - 1)
    flood: FloodConfig = Field(default_factory=FloodConfig)


DISCLAIMER = (
    "CrisisSim uses a synthetic city for educational decision support. "
    "It is not an official emergency forecast or dispatch system."
)
