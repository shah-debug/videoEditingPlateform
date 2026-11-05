from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import EXPORT_DIR
from ..db import get_db
from ..models import Job
from ..services import project_service as ps
from ..utils.proc import check_binaries
from ..workers.jobs import export_job
from ..workers.manager import job_to_dict, manager

router = APIRouter(prefix="/api/export", tags=["export"])

MEDIA = {"mp4": "video/mp4", "srt": "application/x-subrip", "vtt": "text/vtt", "ass": "text/x-ssa"}


class ExportRequest(BaseModel):
    projectId: str
    renderVideo: bool = True
    burnCaptions: bool = True
    resolution: str = "original"  # original | 720p | 1080p | 4k
    fps: str = "original"  # original | 24 | 25 | 30 | 60
    codec: str = "h264"  # h264 | h265
    quality: str = "high"  # high | medium | low
    subtitleFormats: list[str] = []
    filename: str | None = None


@router.post("/start")
def start(body: ExportRequest, db: Session = Depends(get_db)):
    p = ps.get_project(db, body.projectId)
    if not p:
        raise HTTPException(404, "Project not found")
    if not p.video or p.video.status != "ready":
        raise HTTPException(400, "The video is not ready yet.")
    if body.resolution not in ("original", "720p", "1080p", "4k"):
        raise HTTPException(422, "Invalid resolution")
    if body.codec not in ("h264", "h265"):
        raise HTTPException(422, "Invalid codec")
    if body.codec == "h265" and not check_binaries().get("libx265"):
        raise HTTPException(400, "This FFmpeg build has no H.265 (libx265) encoder. Use H.264.")
    if not body.renderVideo and not body.subtitleFormats:
        raise HTTPException(422, "Nothing to export")
    return manager.submit("export", p.id, body.model_dump(), export_job)


@router.get("/{job_id}/status")
def status(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job or job.type != "export":
        raise HTTPException(404, "Export not found")
    return job_to_dict(job)


@router.get("/{job_id}/download")
def download(job_id: str, file: str = "mp4", inline: int = 0, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job or job.type != "export" or job.status != "done":
        raise HTTPException(404, "Export not available")
    name = (job.result or {}).get("files", {}).get(file)
    if not name:
        raise HTTPException(404, f"No {file} file in this export")
    path = (EXPORT_DIR / job_id / name).resolve()
    if EXPORT_DIR.resolve() not in path.parents or not path.exists():
        raise HTTPException(404, "File missing")
    return FileResponse(path, media_type=MEDIA.get(file, "application/octet-stream"),
                        filename=None if inline else Path(name).name,
                        content_disposition_type="inline" if inline else "attachment")
