"""Background job manager: thread pool + DB-persisted progress + WebSocket broadcast + cancellation."""
from __future__ import annotations

import asyncio
import logging
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from fastapi import WebSocket

from ..config import MAX_WORKERS
from ..db import session_scope
from ..models import Job
from ..utils.proc import Cancelled

log = logging.getLogger(__name__)


class Hub:
    """WebSocket subscribers per project ('*' receives everything)."""

    def __init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self.clients: dict[str, set[WebSocket]] = {}

    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    def add(self, key: str, ws: WebSocket) -> None:
        self.clients.setdefault(key, set()).add(ws)

    def remove(self, key: str, ws: WebSocket) -> None:
        self.clients.get(key, set()).discard(ws)

    async def _send(self, key: str, payload: dict) -> None:
        targets = list(self.clients.get(key, set())) + list(self.clients.get("*", set()))
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:
                self.remove(key, ws)
                self.remove("*", ws)

    def publish(self, key: str | None, payload: dict) -> None:
        if self.loop is None or self.loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(self._send(key or "*", payload), self.loop)


hub = Hub()


def job_to_dict(job: Job) -> dict:
    return {
        "id": job.id,
        "projectId": job.project_id,
        "type": job.type,
        "status": job.status,
        "progress": round(job.progress, 4),
        "stage": job.stage,
        "message": job.message,
        "params": job.params,
        "result": job.result,
        "error": job.error,
        "createdAt": job.created_at.isoformat() if job.created_at else None,
        "updatedAt": job.updated_at.isoformat() if job.updated_at else None,
    }


class JobContext:
    def __init__(self, job_id: str, project_id: str | None, job_type: str):
        self.job_id = job_id
        self.project_id = project_id
        self.type = job_type
        self.cancel = threading.Event()
        self._last_write = 0.0
        self._state = {"progress": 0.0, "stage": "", "message": ""}

    def update(self, progress: float | None = None, stage: str | None = None, message: str | None = None,
               force: bool = False) -> None:
        if self.cancel.is_set():
            raise Cancelled()
        stage_changed = stage is not None and stage != self._state["stage"]
        if progress is not None:
            self._state["progress"] = max(0.0, min(1.0, progress))
        if stage is not None:
            self._state["stage"] = stage
        if message is not None:
            self._state["message"] = message
        now = time.monotonic()
        # throttle DB writes; websocket gets more frequent updates
        if force or stage_changed or now - self._last_write > 0.25:
            self._last_write = now
            with session_scope() as db:
                job = db.get(Job, self.job_id)
                if job:
                    job.progress = self._state["progress"]
                    job.stage = self._state["stage"]
                    job.message = self._state["message"]
                    job.status = "running"
            hub.publish(self.project_id, {"event": "job", "job": {
                "id": self.job_id, "projectId": self.project_id, "type": self.type, "status": "running",
                **self._state}})

    def sub(self, lo: float, hi: float, stage: str) -> Callable[[float], None]:
        """Progress callback mapping 0..1 into [lo, hi] of the overall job."""
        return lambda f, *_: self.update(lo + (hi - lo) * f, stage)


class JobManager:
    def __init__(self) -> None:
        self.pool = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="job")
        self.contexts: dict[str, JobContext] = {}

    def submit(self, job_type: str, project_id: str | None, params: dict,
               fn: Callable[[JobContext, dict], dict | None]) -> dict:
        with session_scope() as db:
            job = Job(type=job_type, project_id=project_id, params=params, status="queued", stage="Queued")
            db.add(job)
            db.flush()
            data = job_to_dict(job)
        ctx = JobContext(data["id"], project_id, job_type)
        self.contexts[ctx.job_id] = ctx
        hub.publish(project_id, {"event": "job", "job": data})
        self.pool.submit(self._run, ctx, params, fn)
        return data

    def _finish(self, ctx: JobContext, status: str, result: dict | None = None, error: str | None = None) -> None:
        with session_scope() as db:
            job = db.get(Job, ctx.job_id)
            if job:
                job.status = status
                if status == "done":
                    job.progress = 1.0
                    job.stage = "Done"
                elif status == "cancelled":
                    job.stage = "Cancelled"
                else:
                    job.stage = "Failed"
                job.result = result or {}
                job.error = error
                data = job_to_dict(job)
            else:
                data = {"id": ctx.job_id, "status": status}
        hub.publish(ctx.project_id, {"event": "job", "job": data})
        self.contexts.pop(ctx.job_id, None)

    def _run(self, ctx: JobContext, params: dict, fn: Callable) -> None:
        try:
            ctx.update(0.0, "Starting", force=True)
            result = fn(ctx, params) or {}
            self._finish(ctx, "done", result)
        except Cancelled:
            self._finish(ctx, "cancelled", error="Cancelled by user")
        except Exception as e:  # surface a readable message to the UI
            log.error("Job %s failed:\n%s", ctx.job_id, traceback.format_exc())
            self._finish(ctx, "error", error=friendly_error(e))

    def cancel(self, job_id: str) -> bool:
        ctx = self.contexts.get(job_id)
        if not ctx:
            return False
        ctx.cancel.set()
        return True


def friendly_error(e: Exception) -> str:
    msg = str(e) or e.__class__.__name__
    low = msg.lower()
    if "no such file" in low and "ffmpeg" in low:
        return "FFmpeg was not found. Install FFmpeg and make sure it is on your PATH."
    if "out of memory" in low or isinstance(e, MemoryError):
        return "Ran out of memory. Try a smaller Whisper model (e.g. 'small' or 'base')."
    if "connection" in low and ("huggingface" in low or "hf" in low):
        return "Could not download the speech model. Check your internet connection (first run only)."
    return msg[:1500]


def mark_stale_jobs() -> None:
    """Jobs left running when the server stopped can't resume; mark them failed on startup."""
    from sqlalchemy import update

    with session_scope() as db:
        db.execute(update(Job).where(Job.status.in_(["queued", "running"]))
                   .values(status="error", error="Server restarted while the job was running."))


manager = JobManager()
