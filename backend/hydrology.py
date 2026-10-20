"""ANUGA CPU adapter. Closed synthetic basin; no real-world forecast claim."""
import os

os.environ.setdefault("MPLCONFIGDIR", "/tmp/crisissim-mpl")

import anuga
import numpy as np
from scipy.spatial import cKDTree

from backend.city import WIDTH, HEIGHT, elevation
from backend.contracts import FloodConfig


class FloodModel:
    def __init__(self, config: FloodConfig, *, width=WIDTH, height=HEIGHT, bed=elevation,
                 initial_depth=None):
        self.config = config
        n = config.mesh_cells_per_axis
        self.domain = d = anuga.rectangular_cross_domain(n, n, len1=width, len2=height)
        d.set_store(False)
        d.set_flow_algorithm("DE0")
        d.set_quantity("elevation", bed)
        d.set_quantity("friction", config.manning_n)
        z = d.quantities["elevation"].centroid_values
        if initial_depth is None:
            d.set_quantity("stage", lambda x, y: np.maximum(bed(x, y), config.initial_stage_m))
        else:
            d.set_quantity("stage", lambda x, y: bed(x, y) + initial_depth(x, y))
        d.set_boundary({tag: anuga.Reflective_boundary(d) for tag in d.get_boundary_tags()})
        # Sequential operators add stationary rainfall, then remove available
        # water with proportionate momentum reduction (ANUGA Rate_operator).
        self.sources = {
            "rain": anuga.Rate_operator(d, rate=config.rainfall_mm_h / 3_600_000),
            "infiltration": anuga.Rate_operator(d, rate=-config.infiltration_mm_h / 3_600_000),
            "drainage": anuga.Rate_operator(d, rate=-config.drainage_mm_h / 3_600_000),
        }
        self.initial_volume = float(np.dot(d.quantities["stage"].centroid_values - z, d.areas))
        self.centers = d.centroid_coordinates.copy()
        self.tree = cKDTree(self.centers)
        self.max_depth = np.zeros(len(z))
        self.arrival_s = np.full(len(z), np.nan)

    def frames(self):
        c = self.config
        for time in self.domain.evolve(yieldstep=c.output_interval_s, finaltime=c.duration_s):
            d = self.domain
            bed = d.quantities["elevation"].centroid_values.copy()
            stage = d.quantities["stage"].centroid_values.copy()
            depth = stage - bed
            momentum = np.column_stack([d.quantities[q].centroid_values for q in ("xmomentum", "ymomentum")])
            if not np.isfinite(depth).all() or not np.isfinite(momentum).all() or depth.min() < -1e-8:
                raise ArithmeticError("nonfinite state or negative depth beyond roundoff tolerance")
            velocity = np.divide(momentum, depth[:, None], out=np.zeros_like(momentum),
                                 where=depth[:, None] >= c.wet_threshold_m)
            self.max_depth = np.maximum(self.max_depth, depth)
            arrived = np.isnan(self.arrival_s) & (depth >= c.wet_threshold_m)
            self.arrival_s[arrived] = time
            volumes = {name: float(op.cumulative_influx) for name, op in self.sources.items()}
            volume = float(np.dot(depth, d.areas))
            residual = volume - self.initial_volume - sum(volumes.values())
            yield {
                "time_s": float(time), "depth_m": depth, "stage_m": stage,
                "velocity_m_s": velocity, "bed_m": bed, "volume_m3": volume,
                "source_volumes_m3": volumes, "mass_residual_m3": residual,
                "max_depth_m": self.max_depth.copy(), "arrival_s": self.arrival_s.copy(),
            }

    def sample(self, points, frame):
        """Nearest centroid sampling; outside-domain queries fail, never extrapolate."""
        points = np.asarray(points, dtype=float)
        boundary = self.domain.get_nodes()
        if points.ndim != 2 or points.shape[1] != 2 or not np.isfinite(points).all():
            raise ValueError("finite Nx2 query points required")
        if (points < boundary.min(axis=0)).any() or (points > boundary.max(axis=0)).any():
            raise ValueError("query outside modeled domain")
        _, indices = self.tree.query(points)
        return frame["depth_m"][indices], frame["velocity_m_s"][indices]
