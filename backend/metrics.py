"""Population-weighted summaries; None denotes an undefined statistic."""
import numpy as np


def weighted_gini(values, weights):
    x, w = np.asarray(values, dtype=float), np.asarray(weights, dtype=float)
    if x.ndim != 1 or w.shape != x.shape or len(x) == 0:
        raise ValueError("nonempty matching vectors required")
    if not np.isfinite(x).all() or not np.isfinite(w).all() or (x < 0).any() or (w < 0).any():
        raise ValueError("finite nonnegative values and weights required")
    total = w.sum()
    if total <= 0:
        raise ValueError("positive population required")
    order = np.argsort(x, kind="stable")
    x, w = x[order], w[order]
    burden = np.dot(w, x)
    if burden == 0:
        return None
    before_weight = np.cumsum(w) - w
    before_burden = np.cumsum(w * x) - w * x
    return float(np.sum(w * (x * before_weight - before_burden)) / (total * burden))


def summarize_agents(agents, elapsed_s):
    if not agents:
        raise ValueError("population is empty")
    counts, groups, completed_times = {}, {}, []
    for a in agents:
        state = a["state"]
        counts[state] = counts.get(state, 0) + 1
        g = groups.setdefault(a["neighborhood"], {"population": 0, "safe": 0,
            "mobility_impaired": 0, "transit_dependent": 0})
        g["population"] += 1
        g["mobility_impaired"] += int(a.get("mobility_impaired", False))
        g["transit_dependent"] += int(a.get("transit_dependent", False))
        if state == "sheltered":
            g["safe"] += 1
            origin = a["warning_s"] if np.isfinite(a["warning_s"]) else 0
            completed_times.append(max(0, a["arrival_s"] - origin))
    rates = []
    for g in groups.values():
        g["success_rate"] = g["safe"] / g["population"]
        rates.append(g["success_rate"])
    safe = counts.get("sheltered", 0)
    # A finite-horizon burden, NOT an estimate of eventual evacuation time.
    burden = [max(0, (a["arrival_s"] if a["state"] == "sheltered" else elapsed_s) -
                  (a["warning_s"] if np.isfinite(a["warning_s"]) else 0)) for a in agents]
    return {
        "population": len(agents), "state_counts": counts, "safely_evacuated": safe,
        "completion_fraction": safe / len(agents),
        "incomplete_count": len(agents) - safe,
        "mean_completed_evacuation_s": float(np.mean(completed_times)) if completed_times else None,
        "p90_completed_evacuation_s": float(np.quantile(completed_times, .9)) if completed_times else None,
        "neighborhoods": groups, "success_rate_gap": max(rates) - min(rates),
        "worst_group_success": min(rates),
        "finite_horizon_wait_gini": weighted_gini(burden, np.ones(len(agents))),
        "equity_score": None,
        "notes": ["Completed-only times exclude right-censored evacuations.",
                  "No composite equity score is defined."],
    }
