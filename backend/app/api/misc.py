"""Presets, fonts, transliteration dictionary, system status and the WebSocket endpoint."""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import MODELS_DIR, SUPPORTED_FONT_EXTENSIONS, TEMP_DIR
from ..db import get_db
from ..models import DictionaryEntry, Preset
from ..services import fonts as font_svc
from ..services import subtitle_alignment as align
from ..services import transcription as asr
from ..services.transliteration import normalise, strip_diacritics
from ..utils.proc import check_binaries
from ..workers.manager import hub

router = APIRouter(tags=["misc"])


# ------------------------------------------------------------------ presets


class PresetIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    style: dict


def _preset(p: Preset) -> dict:
    return {"id": p.id, "name": p.name, "builtin": p.builtin, "style": p.style}


@router.get("/api/presets")
def list_presets(db: Session = Depends(get_db)):
    rows = db.scalars(select(Preset).order_by(Preset.builtin.desc(), Preset.created_at)).all()
    return [_preset(p) for p in rows]


@router.post("/api/presets")
def create_preset(body: PresetIn, db: Session = Depends(get_db)):
    p = Preset(name=body.name.strip(), style=body.style, builtin=False)
    db.add(p)
    db.commit()
    return _preset(p)


@router.put("/api/presets/{preset_id}")
def update_preset(preset_id: str, body: PresetIn, db: Session = Depends(get_db)):
    p = db.get(Preset, preset_id)
    if not p or p.builtin:
        raise HTTPException(404, "Custom preset not found")
    p.name, p.style = body.name.strip(), body.style
    db.commit()
    return _preset(p)


@router.delete("/api/presets/{preset_id}")
def delete_preset(preset_id: str, db: Session = Depends(get_db)):
    p = db.get(Preset, preset_id)
    if not p or p.builtin:
        raise HTTPException(400, "Built-in presets can't be deleted")
    db.delete(p)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ fonts


@router.get("/api/fonts")
def list_fonts():
    cat = font_svc.catalog()
    return [f.to_public() for f in cat.values()]


@router.get("/api/fonts/file/{font_id}/{variant}")
def font_file(font_id: str, variant: str):
    cat = font_svc.catalog()
    info = cat.get(font_id)
    if not info or variant not in info.files:
        raise HTTPException(404, "Font not found")
    path = info.files[variant]
    return FileResponse(path, media_type="font/otf" if path.suffix.lower() == ".otf" else "font/ttf",
                        headers={"Cache-Control": "public, max-age=86400"})


@router.post("/api/fonts/upload")
async def upload_font(request: Request, filename: str):
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_FONT_EXTENSIONS:
        raise HTTPException(415, "Only .ttf and .otf fonts are supported.")
    tmp = Path(tempfile.mkstemp(suffix=ext, dir=TEMP_DIR)[1])
    size = 0
    with tmp.open("wb") as f:
        async for chunk in request.stream():
            size += len(chunk)
            if size > 30 * 1024 * 1024:
                tmp.unlink(missing_ok=True)
                raise HTTPException(413, "Font file too large (max 30 MB).")
            f.write(chunk)
    try:
        info = font_svc.add_user_font(tmp, filename)
    except ValueError as e:
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, str(e))
    return info.to_public()


# ------------------------------------------------------------------ Roman Urdu dictionary


class DictIn(BaseModel):
    source: str = Field(min_length=1, max_length=100)
    target: str = Field(min_length=1, max_length=100)


@router.get("/api/dictionary")
def list_dictionary(db: Session = Depends(get_db)):
    return [{"id": e.id, "source": e.source, "target": e.target}
            for e in db.scalars(select(DictionaryEntry).order_by(DictionaryEntry.source))]


@router.post("/api/dictionary")
def add_dictionary(body: DictIn, db: Session = Depends(get_db)):
    src = strip_diacritics(normalise(body.source)).strip()
    e = db.scalars(select(DictionaryEntry).where(DictionaryEntry.source == src)).first()
    if e:
        e.target = body.target.strip()
    else:
        e = DictionaryEntry(source=src, target=body.target.strip())
        db.add(e)
    db.commit()
    return {"id": e.id, "source": e.source, "target": e.target}


@router.delete("/api/dictionary/{entry_id}")
def delete_dictionary(entry_id: int, db: Session = Depends(get_db)):
    e = db.get(DictionaryEntry, entry_id)
    if not e:
        raise HTTPException(404, "Entry not found")
    db.delete(e)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ system


@router.get("/api/system/status")
def system_status():
    device, compute = asr._device_and_compute()
    return {
        "binaries": check_binaries(),
        "whisper": {"device": device, "computeType": compute, "defaultModel": asr.WHISPER_DEFAULT_MODEL,
                    "modelsDir": str(MODELS_DIR),
                    "downloaded": [m["id"] for m in asr.AVAILABLE_MODELS if asr.is_model_downloaded(m["id"])]},
        "whisperx": align.whisperx_available(),
        "fonts": len(font_svc.catalog()),
    }


@router.websocket("/api/ws")
async def ws(websocket: WebSocket, projectId: str = "*"):
    await websocket.accept()
    hub.add(projectId, websocket)
    try:
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_json({"event": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        hub.remove(projectId, websocket)
