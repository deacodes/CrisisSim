import numpy as np
import pytest
from pydantic import ValidationError

from backend.city import build_city, validate_city, elevation
from backend.contracts import Scenario
from backend.metrics import weighted_gini, summarize_agents


def test_city_deterministic_and_valid():
    city = build_city()
    assert city == build_city()
    assert validate_city(city)["valid"]
    assert city["population"] == 78500
    assert np.isfinite(elevation(np.array([0, 1200]), np.array([0, 1000]))).all()


def test_gini_matches_pairwise_reference():
    rng = np.random.default_rng(42)
    for _ in range(20):
        x, w = rng.random(30), rng.random(30)
        reference = np.sum(w[:, None] * w[None, :] * abs(x[:, None] - x[None, :])) / (
            2 * w.sum() * np.dot(x, w))
        assert weighted_gini(x, w) == pytest.approx(reference)


def test_equal_failure_is_not_success():
    agents = [{"state": "stranded", "neighborhood": n, "warning_s": 0} for n in ("N1", "N2")]
    result = summarize_agents(agents, 600)
    assert result["success_rate_gap"] == 0
    assert result["worst_group_success"] == 0
    assert result["equity_score"] is None
    assert result["mean_completed_evacuation_s"] is None


def test_invalid_parameters_fail_closed():
    for values in ({"flood": {"rainfall_mm_h": -1}},
                   {"flood": {"duration_s": 86400, "output_interval_s": 1}},
                   {"flood": {"rainfall_mm_h": float("nan")}},
                   {"unknown_parameter": True}):
        with pytest.raises(ValidationError):
            Scenario.model_validate(values)


def test_zero_burden_is_undefined():
    assert weighted_gini([0, 0], [1, 1]) is None
    with pytest.raises(ValueError):
        weighted_gini([1], [0])
