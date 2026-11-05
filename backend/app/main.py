"""AI Caption Studio - FastAPI application."""
from __future__ import annotations

import asyncio
import logging
import shutil
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import export, misc, projects, subtitles, transcription, videos
from .config import FRONTEND_DIST, TEMP_DIR
from .db import init_db, session_scope
from .services import fonts as font_svc
from .services.project_service import seed_presets
from .workers.manager import hub, mark_stale_jobs

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("caption-studio")


class _IgnoreClientDisconnects(logging.Filter):
    """Windows' Proactor event loop logs a scary ConnectionResetError traceback every time the browser drops a
    video Range request (seeking, switching videos). It is harmless, so hide it."""

    def filter(self, record: logging.LogRecord) -> bool:
        exc = record.exc_info[1] if record.exc_info else None
        return not isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError))


logging.getLogger("asyncio").addFilter(_IgnoreClientDisconnects())


def _cleanup_temp(max_age_hours: float = 24) -> None:
    cutoff = time.time() - max_age_hours * 3600
    for p in TEMP_DIR.iterdir():
        try:
            if p.stat().st_mtime < cutoff:
                shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)
        except OSError:
            pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    with session_scope() as db:
        seed_presets(db)
    mark_stale_jobs()
    _cleanup_temp()
    font_svc.catalog()
    hub.attach_loop(asyncio.get_running_loop())
    log.info("AI Caption Studio ready")
    yield


app = FastAPI(title="AI Caption Studio", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (projects.router, videos.router, transcription.router, subtitles.router, export.router, misc.router):
    app.include_router(r)


@app.exception_handler(Exception)
async def unhandled(_request: Request, exc: Exception):
    log.exception("Unhandled error")
    return JSONResponse({"detail": f"Internal error: {exc}"}, status_code=500)


@app.get("/api/health")
def health():
    return {"ok": True}


# Serve the built frontend (npm run build) from the same origin.
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        f = FRONTEND_DIST / full_path
        if full_path and f.is_file():
            return FileResponse(f)
        return FileResponse(FRONTEND_DIST / "index.html")
