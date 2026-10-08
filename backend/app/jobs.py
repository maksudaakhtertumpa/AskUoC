"""Background jobs for the admin console (uploads, re-embedding, restores). One at a time, progress is pollable."""

from __future__ import annotations

import asyncio
import secrets
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field


@dataclass
class Job:
    id: str
    kind: str
    title: str
    actor: str
    status: str = "queued"  # queued | running | done | failed
    done: int = 0
    total: int = 0
    message: str = ""
    log: list[str] = field(default_factory=list)
    error: str | None = None
    result: dict = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None

    def progress(self, done: int, total: int, message: str = "") -> None:
        self.done, self.total = done, total
        if message:
            self.message = message

    def note(self, line: str) -> None:
        self.log.append(line[:300])
        del self.log[:-200]

    def public(self) -> dict:
        return {
            k: getattr(self, k)
            for k in (
                "id",
                "kind",
                "title",
                "actor",
                "status",
                "done",
                "total",
                "message",
                "log",
                "error",
                "result",
                "created_at",
                "finished_at",
            )
        }


class JobManager:
    def __init__(self, keep: int = 50) -> None:
        self.jobs: OrderedDict[str, Job] = OrderedDict()
        self._lock, self._keep = asyncio.Lock(), keep  # one job at a time protects free-tier API quotas
        self._tasks: set[asyncio.Task] = set()

    def submit(self, kind: str, title: str, actor: str, runner: Callable[[Job], Awaitable[None]]) -> Job:
        job = Job(id=secrets.token_urlsafe(6), kind=kind, title=title, actor=actor)
        self.jobs[job.id] = job
        while len(self.jobs) > self._keep:
            self.jobs.popitem(last=False)
        task = asyncio.create_task(self._run(job, runner))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return job

    async def _run(self, job: Job, runner: Callable[[Job], Awaitable[None]]) -> None:
        async with self._lock:
            job.status = "running"
            try:
                await runner(job)
                job.status = "done"
            except Exception as e:  # noqa: BLE001
                job.status, job.error = "failed", f"{type(e).__name__}: {e}"[:400]
            job.finished_at = time.time()

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def recent(self) -> list[dict]:
        return [j.public() for j in reversed(self.jobs.values())]

    async def wait_all(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
