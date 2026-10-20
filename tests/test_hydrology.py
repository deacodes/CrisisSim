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


def test_open_boundary_flux_balance():
    model = FloodModel(config(boundary_mode="stage", boundary_stage_m=.5),
                       width=20, height=20, bed=lambda x, y: 0*x,
                       initial_depth=lambda x, y: 0*x+1)
    final = list(model.frames())[-1]
    assert final["boundary_inflow_m3"] < 0
    assert abs(final["mass_residual_m3"]) < 1e-5


def test_refinement_increases_channel_resolution():
    coarse = FloodModel(config(), width=20, height=20, bed=lambda x, y: 0*x)
    refined = FloodModel(config(channel_refinement=True), width=20, height=20, bed=lambda x, y: 0*x)
    assert len(refined.centers) > len(coarse.centers)
    inside = abs(refined.centers[:, 0]-10) < 2
    outside = abs(refined.centers[:, 0]-10) > 7
    assert refined.domain.areas[inside].mean() < refined.domain.areas[outside].mean()
    assert abs(list(refined.frames())[-1]["mass_residual_m3"]) < 1e-7


def test_dam_break_converges():
    from backend.verification import dam_break
    coarse, fine = dam_break(8), dam_break(32)
    assert fine["l1_depth_error_m"] < coarse["l1_depth_error_m"]
    assert fine["l1_depth_error_m"] < .08
    assert abs(fine["mass_residual_m3"]) < 1e-5
    assert fine["minimum_depth_m"] >= -1e-8


def test_output_interval_does_not_change_still_water():
    from backend.contracts import FloodConfig
    params = config(initial_stage_m=1).model_dump()
    results = []
    for interval in (1, 2):
        params["output_interval_s"] = interval
        model = FloodModel(FloodConfig(**params), width=20, height=20, bed=lambda x, y: x*.01)
        results.append(list(model.frames())[-1]["depth_m"])
    np.testing.assert_allclose(*results, atol=1e-8, rtol=0)


def test_dynamic_timestep_refinement():
    from backend.verification import temporal_convergence
    results = temporal_convergence()
    errors = [r["depth_difference_to_reference_m"] for r in results]
    assert errors[2] < errors[1] < errors[0]
