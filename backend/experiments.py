"""Actual engine evaluations with matched seeds and bounded search budgets."""
import time
import numpy as np
from scipy.stats import qmc

from backend.run_contracts import ExperimentConfig, RunConfig
from backend.storage import Store
from backend.worker import now


class Cancelled(Exception):
    pass


def experiment_job(root, database_url, experiment_id):
    from backend.engine import Simulation
    store = Store(root, database_url)
    record = store.get(experiment_id, "experiment")
    if not store.claim(experiment_id):
        return
    spec = ExperimentConfig.model_validate(record["spec"])
    store.update(experiment_id, {"heartbeat": now(), "evaluations": []}, "running")
    evaluations = []
    started = time.perf_counter()

    def evaluate(config, label):
        if store.get(experiment_id)["status"] == "cancelled":
            raise Cancelled()
        if time.perf_counter()-started > 600:
            raise TimeoutError("experiment exceeded ten-minute compute budget")
        entry = {"label": label, "config": config.model_dump()}
        try:
            last = None
            for last, _ in Simulation(config).frames():
                if store.get(experiment_id)["status"] == "cancelled":
                    raise Cancelled()
            entry.update(status="completed", metrics=last["metrics"])
        except Cancelled:
            raise
        except Exception as error:
            entry.update(status="failed", error=f"{type(error).__name__}: {error}")
        evaluations.append(entry)
        store.update(experiment_id, {"evaluations": evaluations, "heartbeat": now()})
        if entry["status"] == "failed":
            raise RuntimeError(entry["error"])
        m = entry["metrics"]
        return np.array([m["incomplete_count"], m["mean_exposure_depth_seconds"],
                         m["cost"], m["success_rate_gap"]], dtype=float)

    try:
        result = {}
        if spec.kind == "comparison":
            for name, changes in (
                ("Baseline", {"temporary_shelters": False, "prioritize_vulnerable": False}),
                ("Shelter-first", {"temporary_shelters": True, "prioritize_vulnerable": False}),
                ("Vulnerability-prioritized", {"temporary_shelters": False, "prioritize_vulnerable": True}),
            ):
                config = spec.config.model_copy(deep=True)
                config.policy = config.policy.model_copy(update=changes)
                evaluate(config, name)
            result["matched_seed"] = spec.config.seed
        elif spec.kind == "monte_carlo":
            samples = qmc.LatinHypercube(2, seed=spec.config.seed).random(spec.trials)
            outcomes = []
            for i, sample in enumerate(samples):
                config = spec.config.model_copy(deep=True)
                config.seed = spec.config.seed+i
                config.flood.rainfall_mm_h = 30+sample[0]*90
                config.behavior.warning_mean_delay_s = 100+sample[1]*500
                outcomes.append(evaluate(config, f"Trial {i+1}"))
            array = np.asarray(outcomes)
            result.update(quantiles=np.quantile(array, [.05, .5, .95], axis=0).tolist(),
                          quantile_levels=[.05, .5, .95],
                          variables=["incomplete", "exposure", "cost", "success_gap"],
                          distributions={"rainfall_mm_h": "Uniform(30,120)",
                                         "warning_mean_delay_s": "Uniform(100,600)"},
                          interpretation="Empirical outcome quantiles, not confidence intervals; independent inputs.",
                          completion_probability=float(np.mean(array[:, 0] == 0)))
        elif spec.kind == "sensitivity":
            from SALib.sample.morris import sample
            from SALib.analyze.morris import analyze
            problem = {"num_vars": 2, "names": ["rainfall_mm_h", "warning_mean_delay_s"],
                       "bounds": [[30, 120], [100, 600]]}
            samples = sample(problem, N=min(spec.trials, 8), seed=spec.config.seed)
            outcomes = []
            for i, point in enumerate(samples):
                config = spec.config.model_copy(deep=True)
                config.flood.rainfall_mm_h, config.behavior.warning_mean_delay_s = point
                outcomes.append(evaluate(config, f"Morris {i+1}")[0])
            indices = analyze(problem, samples, np.asarray(outcomes), seed=spec.config.seed)
            result = {"names": problem["names"],
                      "mu_star": indices["mu_star"].tolist(), "sigma": indices["sigma"].tolist(),
                      "output": "incomplete population", "assumptions": "Independent inputs; fixed behavioral seed"}
        else:
            from pymoo.algorithms.moo.nsga2 import NSGA2
            from pymoo.core.problem import ElementwiseProblem
            from pymoo.core.repair import Repair
            from pymoo.optimize import minimize

            class RoundRepair(Repair):
                def _do(self, problem, X, **kwargs):
                    return np.rint(X).astype(int)

            def candidate(x, seed):
                config = spec.config.model_copy(deep=True)
                config.seed = seed
                config.policy = config.policy.model_copy(update={
                    "temporary_shelters": bool(round(x[0])),
                    "buses": int(round(x[1])), "ambulances": int(round(x[2])),
                    "prioritize_vulnerable": bool(round(x[3]))})
                return config

            class Problem(ElementwiseProblem):
                def __init__(self):
                    super().__init__(n_var=4, n_obj=4, n_ieq_constr=1,
                                     xl=np.array([0, 0, 0, 0]), xu=np.array([1, 4, 4, 1]))

                def _evaluate(self, x, out, *args, **kwargs):
                    config = candidate(x, spec.config.seed)
                    out["G"] = [1000*int(config.policy.temporary_shelters)-config.policy.budget]
                    if out["G"][0] > 0:
                        out["F"] = [1e12]*4
                        return
                    out["F"] = evaluate(config, "NSGA-II candidate")

            population = 8
            generations = max(1, spec.evaluations//population)
            optimized = minimize(Problem(), NSGA2(pop_size=population, repair=RoundRepair(),
                                eliminate_duplicates=True), ("n_gen", generations),
                                seed=spec.config.seed, verbose=False)
            result = {"objectives": ["incomplete", "exposure", "cost", "success_gap"],
                      "pareto": [], "held_out": [], "guarantee": "Approximate frontier, not global optimality"}
            if optimized.X is not None:
                for x, f in zip(np.atleast_2d(optimized.X), np.atleast_2d(optimized.F)):
                    result["pareto"].append({"variables": x.tolist(), "objectives": f.tolist()})
                for x in np.atleast_2d(optimized.X)[:2]:
                    f = evaluate(candidate(x, spec.config.seed+1000), "Held-out seed")
                    result["held_out"].append({"variables": x.tolist(), "objectives": f.tolist()})
        store.update(experiment_id, {"result": result, "runtime_s": time.perf_counter()-started,
                     "failed_trials": sum(e["status"] == "failed" for e in evaluations)}, "completed")
    except Cancelled:
        return
    except Exception as error:
        store.update(experiment_id, {"error": f"{type(error).__name__}: {error}",
                     "failed_trials": sum(e["status"] == "failed" for e in evaluations)}, "failed")
