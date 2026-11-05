from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Segment, Word
from ..services import project_service as ps
from ..services.ffmpeg_renderer import output_size, safe_filename
from ..services.subtitle_formats import build_ass, to_srt, to_vtt
from ..services.transliteration import Transliterator, has_arabic

router = APIRouter(prefix="/api/subtitles", tags=["subtitles"])


class WordIn(BaseModel):
    text: str
    start: float
    end: float
    sourceText: str | None = None
    probability: float | None = None
    color: str | None = None


class SegmentIn(BaseModel):
    id: str | None = None
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str = ""
    sourceText: str | None = None
    speaker: str | None = None
    style: dict | None = None
    words: list[WordIn] = []


class DocumentIn(BaseModel):
    segments: list[SegmentIn]
    style: dict | None = None
    settings: dict | None = None
    snapshotLabel: str | None = None


class ConvertIn(BaseModel):
    output: str  # roman_urdu | urdu_script


def _project(db: Session, pid: str, segments: bool = True):
    p = ps.get_project(db, pid, with_segments=segments)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@router.get("/{project_id}")
def get_subtitles(project_id: str, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    return {"segments": ps.segments_to_doc(p.segments), "style": ps.project_to_dict(p)["style"]}


@router.put("/{project_id}")
def save_document(project_id: str, body: DocumentIn, db: Session = Depends(get_db)):
    """Save the whole subtitle document (used by auto-save). Optionally records a restore point."""
    p = _project(db, project_id)
    if body.snapshotLabel:
        ps.snapshot(db, p, body.snapshotLabel)
    ps.replace_segments(db, p, [s.model_dump() for s in body.segments])
    if body.style is not None:
        p.style = body.style
    if body.settings is not None:
        p.settings = {**(p.settings or {}), **body.settings}
    db.commit()
    return {"ok": True, "updatedAt": p.updated_at.isoformat()}


@router.post("/{project_id}/segments")
def add_segment(project_id: str, body: SegmentIn, db: Session = Depends(get_db)):
    p = _project(db, project_id, segments=False)
    if body.end <= body.start:
        raise HTTPException(422, "end must be after start")
    seg = ps.add_segment(db, p, body.model_dump())
    db.commit()
    return ps.segments_to_doc([seg])[0]


@router.put("/segment/{segment_id}")
def update_segment(segment_id: str, body: SegmentIn, db: Session = Depends(get_db)):
    seg = db.get(Segment, segment_id)
    if not seg:
        raise HTTPException(404, "Caption not found")
    if body.end <= body.start:
        raise HTTPException(422, "end must be after start")
    seg.start, seg.end, seg.text = body.start, body.end, body.text
    seg.source_text, seg.speaker, seg.style = body.sourceText, body.speaker, body.style
    seg.words.clear()
    db.flush()
    for i, w in enumerate(body.words):
        seg.words.append(Word(idx=i, start=w.start, end=w.end, text=w.text, source_text=w.sourceText,
                              probability=w.probability, color=w.color))
    db.commit()
    return ps.segments_to_doc([seg])[0]


@router.delete("/segment/{segment_id}")
def delete_segment(segment_id: str, db: Session = Depends(get_db)):
    seg = db.get(Segment, segment_id)
    if not seg:
        raise HTTPException(404, "Caption not found")
    db.delete(seg)
    db.commit()
    return {"ok": True}


@router.post("/{project_id}/convert")
def convert_script(project_id: str, body: ConvertIn, db: Session = Depends(get_db)):
    """Switch between Urdu script and Roman Urdu using the stored original-script words, without
    re-transcribing. Manual text edits are replaced by the converted original."""
    p = _project(db, project_id)
    if body.output not in ("roman_urdu", "urdu_script"):
        raise HTTPException(422, "output must be roman_urdu or urdu_script")
    docs = ps.segments_to_doc(p.segments)
    if not any(has_arabic(s.get("sourceText") or "") for s in docs):
        raise HTTPException(400, "These captions have no Urdu-script source text. Generate captions with "
                                 "Urdu speech first.")
    ps.snapshot(db, p, f"Before converting to {body.output}")
    user_dict = ps.user_dictionary(db)
    # Flatten the whole transcript (sentence context and sentence-case span segment boundaries), remembering
    # which segment each source token belongs to.
    expanded: list[dict] = []
    owner: list[int] = []
    for si, s in enumerate(docs):
        src_words = [{"text": w.get("sourceText") or w["text"], "start": w["start"], "end": w["end"],
                      "probability": w.get("probability")} for w in s["words"]]
        if not src_words:
            src_words = [{"text": s.get("sourceText") or s["text"], "start": s["start"], "end": s["end"]}]
        # split merged words back into tokens so the transliterator sees context ("جاؤں گا")
        for w in src_words:
            toks = w["text"].split() or [w["text"]]
            d = (w["end"] - w["start"]) / len(toks)
            for k, t in enumerate(toks):
                expanded.append({"text": t, "start": w["start"] + k * d, "end": w["start"] + (k + 1) * d,
                                 "probability": w.get("probability") or 1})
                owner.append(si)
    if body.output == "roman_urdu":
        tr = Transliterator(user_dict)
        pairs = tr.transliterate_words([w["text"] for w in expanded])
    else:
        pairs = [(w["text"], [i]) for i, w in enumerate(expanded)]
    per_seg: list[list[dict]] = [[] for _ in docs]
    for text, idx in pairs:
        group = [expanded[i] for i in idx]
        per_seg[owner[idx[0]]].append({
            "text": text, "start": group[0]["start"], "end": group[-1]["end"],
            "probability": min(g["probability"] for g in group),
            "sourceText": " ".join(g["text"] for g in group),
        })
    out = [{**s, "words": per_seg[i], "text": " ".join(w["text"] for w in per_seg[i])} for i, s in enumerate(docs)]
    ps.replace_segments(db, p, out)
    p.settings = {**(p.settings or {}), "outputScript": body.output}
    db.commit()
    db.expire_all()
    return ps.project_to_dict(_project(db, project_id), include_segments=True)


@router.post("/transliterate")
def transliterate(body: dict, db: Session = Depends(get_db)):
    return {"text": Transliterator(ps.user_dictionary(db)).transliterate_text(str(body.get("text", "")))}


@router.get("/{project_id}/download/{fmt}")
def download(project_id: str, fmt: str, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    d = ps.project_to_dict(p, include_segments=True)
    name = safe_filename(d["name"], "captions")
    if fmt == "srt":
        body, mt = "﻿" + to_srt(d["segments"]), "application/x-subrip"
    elif fmt == "vtt":
        body, mt = to_vtt(d["segments"]), "text/vtt"
    elif fmt == "ass":
        meta = (d["video"] or {}).get("meta") or {"width": 1920, "height": 1080}
        w, h = output_size(meta["width"], meta["height"], d["settings"].get("aspectRatio", "original"), "original")
        body, mt = "﻿" + build_ass(d["segments"], d["style"], w, h), "text/x-ssa"
    else:
        raise HTTPException(404, "Unknown format")
    return Response(body.encode("utf-8"), media_type=f"{mt}; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}.{fmt}"'})
