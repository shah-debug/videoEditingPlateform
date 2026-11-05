"""Project / subtitle document persistence."""
from __future__ import annotations

import shutil
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from ..config import EXPORT_DIR, TEMP_DIR, UPLOAD_DIR
from ..models import (DictionaryEntry, HistorySnapshot, Job, Preset, Project, Segment, Video, Word, new_id,
                      utcnow)
from ..schemas.style import BUILTIN_PRESETS, DEFAULT_STYLE

DEFAULT_SETTINGS = {
    "aspectRatio": "original",
    "fitMode": "fit",
    "padColor": "#000000",
    "sourceLanguage": "auto",
    "outputScript": "original",
    "model": None,
    "captionLength": "medium",
}
MAX_SNAPSHOTS = 40


def seed_presets(db: Session) -> None:
    existing = {p.name: p for p in db.scalars(select(Preset).where(Preset.builtin.is_(True)))}
    for name, style in BUILTIN_PRESETS:
        if name in existing:
            existing[name].style = style
        else:
            db.add(Preset(name=name, builtin=True, style=style))
    db.commit()


def get_project(db: Session, project_id: str, with_segments: bool = False) -> Project | None:
    stmt = select(Project).where(Project.id == project_id).options(selectinload(Project.video))
    if with_segments:
        stmt = stmt.options(selectinload(Project.segments).selectinload(Segment.words))
    return db.scalars(stmt).first()


def video_to_dict(v: Video | None) -> dict | None:
    if not v:
        return None
    return {
        "id": v.id,
        "originalFilename": v.original_filename,
        "sizeBytes": v.size_bytes,
        "meta": v.meta or {},
        "status": v.status,
        "error": v.error,
        "detectedLanguage": v.detected_language,
        "detectedLanguageProb": v.detected_language_prob,
        "hasProxy": bool(v.proxy_path and Path(v.proxy_path).exists()),
        "hasWaveform": bool(v.waveform_path and Path(v.waveform_path).exists()),
        "streamUrl": f"/api/videos/{v.id}/stream",
        "originalUrl": f"/api/videos/{v.id}/stream?original=1",
    }


def project_to_dict(p: Project, include_segments: bool = False) -> dict:
    out = {
        "id": p.id,
        "name": p.name,
        "createdAt": p.created_at.isoformat() if p.created_at else None,
        "updatedAt": p.updated_at.isoformat() if p.updated_at else None,
        "settings": {**DEFAULT_SETTINGS, **(p.settings or {})},
        "style": {**DEFAULT_STYLE, **(p.style or {})},
        "transcription": p.transcription or {},
        "video": video_to_dict(p.video),
    }
    if include_segments:
        out["segments"] = segments_to_doc(p.segments)
    return out


def segments_to_doc(segments: list[Segment]) -> list[dict]:
    return [
        {
            "id": s.id,
            "start": s.start,
            "end": s.end,
            "text": s.text,
            "sourceText": s.source_text,
            "speaker": s.speaker,
            "style": s.style,
            "words": [
                {"text": w.text, "start": w.start, "end": w.end, "sourceText": w.source_text,
                 "probability": w.probability, "color": w.color}
                for w in s.words
            ],
        }
        for s in sorted(segments, key=lambda s: (s.start, s.end))
    ]


def _segment_from_doc(project_id: str, d: dict) -> Segment:
    start = max(0.0, float(d.get("start", 0)))
    end = max(start + 0.05, float(d.get("end", start + 1)))
    seg = Segment(
        id=d.get("id") or new_id("cap"),
        project_id=project_id,
        start=start,
        end=end,
        text=str(d.get("text", ""))[:2000],
        source_text=d.get("sourceText"),
        speaker=d.get("speaker"),
        style=d.get("style") or None,
    )
    for i, w in enumerate(d.get("words") or []):
        ws = float(w.get("start", start))
        we = max(ws, float(w.get("end", ws)))
        seg.words.append(Word(idx=i, start=ws, end=we, text=str(w.get("text", ""))[:200],
                              source_text=w.get("sourceText"), probability=w.get("probability"),
                              color=w.get("color")))
    return seg


def replace_segments(db: Session, project: Project, docs: list[dict]) -> None:
    ids = [s.id for s in db.scalars(select(Segment).where(Segment.project_id == project.id))]
    if ids:
        db.execute(delete(Word).where(Word.segment_id.in_(ids)))
        db.execute(delete(Segment).where(Segment.project_id == project.id))
    db.flush()
    seen: set[str] = set()
    for d in docs:
        seg = _segment_from_doc(project.id, d)
        if seg.id in seen:
            seg.id = new_id("cap")
        seen.add(seg.id)
        db.add(seg)
    project.updated_at = utcnow()


def add_segment(db: Session, project: Project, d: dict) -> Segment:
    seg = _segment_from_doc(project.id, d)
    if db.get(Segment, seg.id):
        seg.id = new_id("cap")
    db.add(seg)
    project.updated_at = utcnow()
    return seg


def snapshot(db: Session, project: Project, label: str) -> None:
    db.refresh(project)
    data = {"segments": segments_to_doc(project.segments), "style": project.style or {},
            "settings": project.settings or {}}
    db.add(HistorySnapshot(project_id=project.id, label=label, snapshot=data))
    db.flush()
    rows = db.scalars(select(HistorySnapshot.id).where(HistorySnapshot.project_id == project.id)
                      .order_by(HistorySnapshot.id.desc()).offset(MAX_SNAPSHOTS)).all()
    if rows:
        db.execute(delete(HistorySnapshot).where(HistorySnapshot.id.in_(rows)))


def user_dictionary(db: Session) -> dict[str, str]:
    return {e.source: e.target for e in db.scalars(select(DictionaryEntry))}


def delete_project_files(project: Project) -> None:
    for base in (UPLOAD_DIR, TEMP_DIR):
        if project.video:
            shutil.rmtree(base / project.video.id, ignore_errors=True)


def delete_export_files(db: Session, project_id: str) -> None:
    for job in db.scalars(select(Job).where(Job.project_id == project_id, Job.type == "export")):
        shutil.rmtree(EXPORT_DIR / job.id, ignore_errors=True)
        shutil.rmtree(TEMP_DIR / job.id, ignore_errors=True)
