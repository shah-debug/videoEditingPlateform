from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models import HistorySnapshot, Project
from ..services import project_service as ps
from ..schemas.style import DEFAULT_STYLE

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    name: str = Field(default="Untitled project", max_length=200)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    settings: dict | None = None
    style: dict | None = None


def _get(db: Session, pid: str, segments: bool = False) -> Project:
    p = ps.get_project(db, pid, with_segments=segments)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@router.post("")
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    p = Project(name=body.name.strip() or "Untitled project", settings=dict(ps.DEFAULT_SETTINGS),
                style=dict(DEFAULT_STYLE))
    db.add(p)
    db.commit()
    return ps.project_to_dict(_get(db, p.id), include_segments=True)


@router.get("")
def list_projects(db: Session = Depends(get_db)):
    rows = db.scalars(select(Project).options(selectinload(Project.video), selectinload(Project.segments))
                      .order_by(Project.updated_at.desc())).all()
    out = []
    for p in rows:
        d = ps.project_to_dict(p)
        d["segmentCount"] = len(p.segments)
        out.append(d)
    return out


@router.get("/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db)):
    return ps.project_to_dict(_get(db, project_id, True), include_segments=True)


@router.patch("/{project_id}")
def patch_project(project_id: str, body: ProjectPatch, db: Session = Depends(get_db)):
    p = _get(db, project_id)
    if body.name is not None:
        p.name = body.name.strip() or p.name
    if body.settings is not None:
        p.settings = {**(p.settings or {}), **body.settings}
    if body.style is not None:
        p.style = {**DEFAULT_STYLE, **body.style}
    db.commit()
    return ps.project_to_dict(_get(db, project_id, True), include_segments=True)


@router.delete("/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)):
    p = _get(db, project_id)
    ps.delete_project_files(p)
    ps.delete_export_files(db, project_id)
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.get("/{project_id}/history")
def list_history(project_id: str, db: Session = Depends(get_db)):
    _get(db, project_id)
    rows = db.scalars(select(HistorySnapshot).where(HistorySnapshot.project_id == project_id)
                      .order_by(HistorySnapshot.id.desc())).all()
    return [{"id": r.id, "label": r.label, "createdAt": r.created_at.isoformat(),
             "segmentCount": len(r.snapshot.get("segments", []))} for r in rows]


@router.post("/{project_id}/history/{snapshot_id}/restore")
def restore_history(project_id: str, snapshot_id: int, db: Session = Depends(get_db)):
    p = _get(db, project_id, True)
    snap = db.get(HistorySnapshot, snapshot_id)
    if not snap or snap.project_id != project_id:
        raise HTTPException(404, "Snapshot not found")
    ps.snapshot(db, p, "Before restore")
    data = snap.snapshot
    ps.replace_segments(db, p, data.get("segments", []))
    if data.get("style"):
        p.style = data["style"]
    db.commit()
    db.expire_all()
    return ps.project_to_dict(_get(db, project_id, True), include_segments=True)
