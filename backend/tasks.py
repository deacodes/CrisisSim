import os
from celery import Celery

celery = Celery("crisissim", broker=os.getenv("REDIS_URL", "redis://localhost:6379/0"))
celery.conf.update(worker_prefetch_multiplier=1, task_acks_late=True, task_reject_on_worker_lost=True)


@celery.task(name="crisissim.execute")
def execute_job(root, database_url, identifier, kind):
    from backend.worker import run_job
    from backend.experiments import experiment_job
    (run_job if kind == "run" else experiment_job)(root, database_url, identifier)
