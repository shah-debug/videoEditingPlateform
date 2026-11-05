from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import WHISPER_DEFAULT_MODEL
from ..db import get_db
from ..models import Job
from ..services import project_service as ps
from ..services import subtitle_alignment as align
from ..services import transcription as asr
from ..workers.jobs import transcribe_job
from ..workers.manager import job_to_dict, manager

router = APIRouter(tags=["transcription"])

OUTPUTS = [
    {"id": "original", "label": "Original language (as spoken)"},
    {"id": "roman_urdu", "label": "Roman Urdu (Urdu in Latin letters)"},
    {"id": "urdu_script", "label": "Urdu script (اردو)"},
    {"id": "english", "label": "English translation"},
]


class TranscribeRequest(BaseModel):
    projectId: str
    language: str = "auto"
    output: str = "original"
    model: str | None = None
    captionLength: str = "medium"
    useWhisperX: bool = True


@router.get("/api/transcription/options")
def options():
    return {
        "languages": [{"id": "auto", "label": "Auto detect"}] +
                     [{"id": k, "label": v} for k, v in asr.LANGUAGES.items()],
        "outputs": OUTPUTS,
        "models": [{**m, "downloaded": asr.is_model_downloaded(m["id"])} for m in asr.AVAILABLE_MODELS],
        "defaultModel": WHISPER_DEFAULT_MODEL,
        "captionLengths": [{"id": "short", "label": "Short (1-4 words, social)"},
                           {"id": "medium", "label": "Medium (one subtitle line)"},
                           {"id": "long", "label": "Long (two lines)"}],
        "whisperx": align.whisperx_available(),
    }


@router.post("/api/transcription/start")
def start(body: TranscribeRequest, db: Session = Depends(get_db)):
    p = ps.get_project(db, body.projectId)
    if not p:
        raise HTTPException(404, "Project not found")
    if not p.video:
        raise HTTPException(400, "Upload a video before generating captions.")
    if p.video.status == "error":
        raise HTTPException(400, p.video.error or "Video processing failed.")
    if body.output not in {o["id"] for o in OUTPUTS}:
        raise HTTPException(422, "Unknown caption output")
    if body.language != "auto" and body.language not in asr.LANGUAGES:
        raise HTTPException(422, "Unknown language")
    if body.model and body.model not in {m["id"] for m in asr.AVAILABLE_MODELS} and "/" not in body.model:
        raise HTTPException(422, "Unknown model")
    running = db.query(Job).filter(Job.project_id == p.id, Job.type == "transcribe",
                                   Job.status.in_(["queued", "running"])).first()
    if running:
        raise HTTPException(409, "Captions are already being generated for this project.")
    return manager.submit("transcribe", p.id, body.model_dump(), transcribe_job)


@router.get("/api/transcription/{job_id}/status")
def status(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job_to_dict(job)


@router.get("/api/jobs/{job_id}")
def job_status(job_id: str, db: Session = Depends(get_db)):
    return status(job_id, db)


@router.get("/api/projects/{project_id}/jobs")
def project_jobs(project_id: str, active: int = 0, db: Session = Depends(get_db)):
    q = db.query(Job).filter(Job.project_id == project_id)
    if active:
        q = q.filter(Job.status.in_(["queued", "running"]))
    return [job_to_dict(j) for j in q.order_by(Job.created_at.desc()).limit(30)]


@router.post("/api/jobs/{job_id}/cancel")
def cancel(job_id: str):
    if not manager.cancel(job_id):
        raise HTTPException(404, "Job is not running")
    return {"ok": True}
