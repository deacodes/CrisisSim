import numpy as np
import pytest
from backend.contracts import FloodConfig
from backend.hydrology import FloodModel


def config(**overrides):
    return FloodConfig(duration_s=10, output_interval_s=2, mesh_cells_per_axis=4,
                       **({"rainfall_mm_h": 0, "infiltration_mm_h": 0,
                           "drainage_mm_h": 0} | overrides))


def test_lake_at_rest_over_slope():
    model = FloodModel(config(initial_stage_m=2), width=20, height=20, bed=lambda x, y: x * .01)
    frames = list(model.frames())
    assert np.max(abs(frames[-1]["velocity_m_s"])) < 1e-8
    assert np.max(abs(frames[-1]["stage_m"] - frames[0]["stage_m"])) < 1e-8
    assert abs(frames[-1]["mass_residual_m3"]) < 1e-6


def test_uniform_rainfall_volume():
    model = FloodModel(config(rainfall_mm_h=36), width=20, height=20, bed=lambda x, y: 0*x)
    final = list(model.frames())[-1]
    assert final["volume_m3"] == pytest.approx(400 * 36 / 3_600_000 * 10, abs=1e-7)
    assert abs(final["mass_residual_m3"]) < 1e-7


def test_sinks_do_not_remove_unavailable_water():
    model = FloodModel(config(infiltration_mm_h=100, drainage_mm_h=100),
                       width=20, height=20, bed=lambda x, y: 0*x,
                       initial_depth=lambda x, y: 0*x + .0001)
    final = list(model.frames())[-1]
    assert final["depth_m"].min() >= -1e-8
    assert abs(final["mass_residual_m3"]) < 1e-7
    assert final["volume_m3"] < 1e-7


def test_sampling_rejects_outside_domain():
    model = FloodModel(config(), width=20, height=20, bed=lambda x, y: 0*x)
    frame = next(model.frames())
    with pytest.raises(ValueError):
        model.sample([[-1, 0]], frame)
