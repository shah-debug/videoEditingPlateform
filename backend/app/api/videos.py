from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..config import SUPPORTED_VIDEO_EXTENSIONS, TEMP_DIR, UPLOAD_DIR
from ..db import get_db
from ..models import Video, new_id
from ..services import project_service as ps
from ..workers.jobs import process_video_job
from ..workers.manager import manager

router = APIRouter(prefix="/api/videos", tags=["videos"])

MEDIA_TYPES = {".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
               ".mkv": "video/x-matroska", ".avi": "video/x-msvideo"}


@router.post("/upload")
async def upload_video(request: Request, projectId: str = Query(...), filename: str = Query(...),
                       model: str | None = Query(None), db: Session = Depends(get_db)):
    """Raw streaming upload: the request body is the file itself (no multipart buffering), written to disk
    in chunks so multi-GB files never sit in memory on either side."""
    project = ps.get_project(db, projectId)
    if not project:
        raise HTTPException(404, "Project not found")
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_VIDEO_EXTENSIONS:
        raise HTTPException(415, f"Unsupported format '{ext or '?'}'. Supported: MP4, MOV, AVI, MKV, WEBM.")

    video_id = new_id("vid")
    folder = UPLOAD_DIR / video_id
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"original{ext}"
    size = 0
    try:
        with dest.open("wb") as f:
            async for chunk in request.stream():
                f.write(chunk)
                size += len(chunk)
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(400, "Upload interrupted.")
    if size == 0:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(400, "The uploaded file is empty.")

    # replacing a video: remove the previous one (captions are kept so they can be reused/regenerated)
    if project.video:
        old = project.video
        shutil.rmtree(UPLOAD_DIR / old.id, ignore_errors=True)
        shutil.rmtree(TEMP_DIR / old.id, ignore_errors=True)
        db.delete(old)
        db.flush()
    v = Video(id=video_id, project_id=project.id, original_filename=Path(filename).name, path=str(dest),
              size_bytes=size, status="processing")
    db.add(v)
    if project.name in ("Untitled project", ""):
        project.name = Path(filename).stem[:120]
    db.commit()
    job = manager.submit("process", project.id, {"videoId": video_id, "model": model}, process_video_job)
    return {"video": ps.video_to_dict(v), "job": job}


def _video(db: Session, video_id: str) -> Video:
    v = db.get(Video, video_id)
    if not v:
        raise HTTPException(404, "Video not found")
    return v


@router.get("/{video_id}/metadata")
def metadata(video_id: str, db: Session = Depends(get_db)):
    return ps.video_to_dict(_video(db, video_id))


@router.get("/{video_id}/stream")
def stream(video_id: str, original: int = 0, db: Session = Depends(get_db)):
    """Range-capable file response (seeking in the HTML5 player). Uses the H.264 preview proxy when the
    original codec isn't browser-playable, unless ?original=1."""
    v = _video(db, video_id)
    path = Path(v.path)
    if not original and v.proxy_path and Path(v.proxy_path).exists():
        path = Path(v.proxy_path)
    if not path.exists():
        raise HTTPException(404, "Video file missing")
    return FileResponse(path, media_type=MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"))


@router.get("/{video_id}/waveform")
def waveform(video_id: str, db: Session = Depends(get_db)):
    v = _video(db, video_id)
    if not v.waveform_path or not Path(v.waveform_path).exists():
        raise HTTPException(404, "Waveform not ready")
    return FileResponse(v.waveform_path, media_type="application/json")


@router.delete("/{video_id}")
def delete_video(video_id: str, db: Session = Depends(get_db)):
    v = _video(db, video_id)
    shutil.rmtree(UPLOAD_DIR / v.id, ignore_errors=True)
    shutil.rmtree(TEMP_DIR / v.id, ignore_errors=True)
    db.delete(v)
    db.commit()
    return {"ok": True}
