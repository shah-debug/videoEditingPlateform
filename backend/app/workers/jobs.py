"""Job implementations: video processing, transcription, export."""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from ..config import DETECT_LANGUAGE_ON_UPLOAD, EXPORT_DIR, TEMP_DIR, UPLOAD_DIR
from ..db import session_scope
from ..models import Project, Video
from ..services import project_service as ps
from ..services import subtitle_alignment as align
from ..services import transcription as asr
from ..services import video_processing as vp
from ..services.ffmpeg_renderer import render, safe_filename, write_subtitle_files, output_size
from ..services.transliteration import Transliterator, has_arabic
from .manager import JobContext, hub

log = logging.getLogger(__name__)


# ------------------------------------------------------------------ processing (after upload)


def process_video_job(ctx: JobContext, params: dict) -> dict:
    video_id = params["videoId"]
    with session_scope() as db:
        v = db.get(Video, video_id)
        if not v:
            raise ValueError("Video not found")
        src = Path(v.path)
        v.status = "processing"
    work = UPLOAD_DIR / video_id

    ctx.update(0.02, "Reading video metadata")
    try:
        meta = vp.probe(src)
    except vp.VideoError as e:
        with session_scope() as db:
            v = db.get(Video, video_id)
            v.status, v.error = "error", str(e)
        raise
    with session_scope() as db:
        v = db.get(Video, video_id)
        v.meta, v.size_bytes = meta, meta["sizeBytes"]
    hub.publish(ctx.project_id, {"event": "video", "videoId": video_id})

    audio_path = None
    if meta["hasAudio"]:
        audio_path = work / "audio.wav"
        vp.extract_audio(src, audio_path, meta["duration"], ctx.sub(0.05, 0.3, "Extracting audio"), ctx.cancel)
        ctx.update(0.32, "Analysing audio waveform")
        vp.build_waveform(audio_path, work / "waveform.json")


    with session_scope() as db:
        v = db.get(Video, video_id)
        v.audio_path = str(audio_path) if audio_path else None
        v.waveform_path = str(work / "waveform.json") if audio_path else None
    hub.publish(ctx.project_id, {"event": "video", "videoId": video_id})

    if vp.needs_proxy(src, meta):
        vp.build_proxy(src, work / "proxy.mp4", meta["duration"], ctx.sub(0.42, 0.85, "Creating preview copy"),
                       ctx.cancel)
        with session_scope() as db:
            db.get(Video, video_id).proxy_path = str(work / "proxy.mp4")

    detected = None
    if audio_path and DETECT_LANGUAGE_ON_UPLOAD:
        model_name = params.get("model") or asr.WHISPER_DEFAULT_MODEL
        if asr.is_model_downloaded(model_name):
            ctx.update(0.88, "Detecting spoken language")
        else:
            ctx.update(0.88, f"Downloading the '{model_name}' speech model (one time only, a few hundred MB; "
                             "needs internet), then detecting the language")
        try:
            with asr.transcribe_lock:
                detected = asr.detect_language(audio_path, params.get("model"))
        except Exception as e:  # non-fatal: user can still pick the language manually
            log.warning("Language detection failed: %s", e)
    with session_scope() as db:
        v = db.get(Video, video_id)
        v.status = "ready"
        v.error = None
        if detected:
            v.detected_language = detected["language"]
            v.detected_language_prob = detected["probability"]
    hub.publish(ctx.project_id, {"event": "video", "videoId": video_id})
    return {"meta": meta, "language": detected}


# ------------------------------------------------------------------ transcription


def transcribe_job(ctx: JobContext, params: dict) -> dict:
    project_id = ctx.project_id
    language = params.get("language") or "auto"
    output = params.get("output") or "original"
    model = params.get("model") or None
    length = params.get("captionLength") or "medium"

    with session_scope() as db:
        p = ps.get_project(db, project_id)
        if not p or not p.video:
            raise ValueError("Upload a video first.")
        v = p.video
        if not v.meta.get("hasAudio", True):
            raise ValueError("This video has no audio track, so there is nothing to transcribe.")
        audio = Path(v.audio_path) if v.audio_path else None
        src, duration = Path(v.path), float(v.meta.get("duration", 0))
        user_dict = ps.user_dictionary(db)

    if not audio or not audio.exists():
        audio = UPLOAD_DIR / v.id / "audio.wav"
        vp.extract_audio(src, audio, duration, ctx.sub(0.0, 0.05, "Extracting audio"), ctx.cancel)

    loaded_note = "" if asr.is_model_downloaded(model or asr.WHISPER_DEFAULT_MODEL) else \
        " (downloading model, first time only)"
    ctx.update(0.06, "Waiting for speech engine")
    with asr.transcribe_lock:
        ctx.update(0.07, "Loading speech model" + loaded_note)
        asr.get_model(model)
        lang = None if language == "auto" else language
        detected = None
        notes: list[str] = []
        if lang is None:
            ctx.update(0.09, "Detecting spoken language")
            detected = asr.detect_language(audio, model)
            lang = detected["language"]
            # Spoken Urdu and Hindi are close; Whisper often labels Urdu speech as Hindi (Devanagari output).
            if output in ("roman_urdu", "urdu_script") and lang == "hi":
                notes.append("Detected Hindi; transcribing as Urdu because an Urdu output script was selected.")
                lang = "ur"
        task = "translate" if output == "english" and lang != "en" else "transcribe"
        stage = "Translating speech to English" if task == "translate" else "Transcribing speech"
        result = asr.transcribe(audio, lang, task, model, lambda f, txt="": ctx.update(0.1 + 0.78 * f, stage, txt),
                                ctx.cancel)

    words = result["words"]
    ctx.update(0.9, "Aligning word timestamps")
    if task == "transcribe" and params.get("useWhisperX", True) and align.whisperx_available():
        refined = align.refine_with_whisperx(audio, result["segments"], result["language"])
        if refined and len(refined) >= 0.8 * len(words):
            words = refined
            notes.append("Word timings refined with WhisperX forced alignment.")
    words = align.clean_words(words)

    # caption text in the requested script; the original-script word is kept as sourceText
    script_lang = result["language"]
    if output == "roman_urdu":
        ctx.update(0.93, "Converting to Roman Urdu")
        if any(has_arabic(w["text"]) for w in words) or script_lang in ("ur", "hi"):
            words = romanise_words(words, user_dict)
        else:
            notes.append("Transcript is not in Urdu script; Roman Urdu conversion was not needed.")
    else:
        words = [{**w, "sourceText": w["text"]} for w in words]

    ctx.update(0.96, "Building captions")
    captions = align.segment_words(words, length, script_lang if output != "roman_urdu" else "ur-Latn")
    if not captions:
        notes.append("No speech was detected in this video.")

    with session_scope() as db:
        p = ps.get_project(db, project_id, with_segments=True)
        ps.snapshot(db, p, "Before auto-generate")
        ps.replace_segments(db, p, captions)
        p.transcription = {
            "language": result["language"],
            "languageProbability": result["languageProbability"],
            "detected": detected,
            "requestedLanguage": language,
            "output": output,
            "task": task,
            "model": model or asr.WHISPER_DEFAULT_MODEL,
            "captionLength": length,
            "wordCount": len(words),
            "notes": notes,
        }
        p.settings = {**(p.settings or {}), "sourceLanguage": language, "outputScript": output,
                      "model": model, "captionLength": length}
    hub.publish(project_id, {"event": "subtitles", "projectId": project_id})
    return {"segments": len(captions), "language": result["language"], "notes": notes}


def romanise_words(words: list[dict], user_dict: dict[str, str]) -> list[dict]:
    """Transliterate a whole transcript at once (sentence context) and merge timings of merged words."""
    tr = Transliterator(user_dict)
    pairs = tr.transliterate_words([w["text"] for w in words])
    out = []
    for text, idx in pairs:
        group = [words[i] for i in idx]
        out.append({
            "text": text,
            "start": group[0]["start"],
            "end": group[-1]["end"],
            "probability": min(g.get("probability", 1) for g in group),
            "sourceText": " ".join(g.get("sourceText") or g["text"] for g in group),
        })
    return out


# ------------------------------------------------------------------ export


def export_job(ctx: JobContext, params: dict) -> dict:
    with session_scope() as db:
        p = ps.get_project(db, ctx.project_id, with_segments=True)
        if not p or not p.video:
            raise ValueError("Project has no video.")
        data = ps.project_to_dict(p, include_segments=True)
    v = data["video"]
    meta = v["meta"]
    src = Path(_video_path(v["id"]))
    if not src.exists():
        raise FileNotFoundError("The original video file is missing from the uploads folder.")
    out_dir = EXPORT_DIR / ctx.job_id
    work = TEMP_DIR / ctx.job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    base = safe_filename(params.get("filename") or data["name"], "captioned")
    files: dict[str, str] = {}
    try:
        w, h = output_size(meta["width"], meta["height"], data["settings"].get("aspectRatio", "original"),
                           params.get("resolution", "original"))
        subs = [f for f in params.get("subtitleFormats", []) if f in ("srt", "vtt", "ass")]
        for fmt, path in write_subtitle_files(data["segments"], data["style"], w, h, out_dir, base, subs).items():
            files[fmt] = path.name
        if params.get("renderVideo", True):
            ctx.update(0.01, "Rendering video")
            out_path = out_dir / f"{base}.mp4"
            info = render(src, meta, data["segments"], data["style"], data["settings"], params, work, out_path,
                          ctx.sub(0.01, 0.99, "Rendering video"), ctx.cancel)
            files["mp4"] = out_path.name
        else:
            info = {"width": w, "height": h}
    except BaseException:
        shutil.rmtree(work, ignore_errors=True)
        if ctx.cancel.is_set():
            shutil.rmtree(out_dir, ignore_errors=True)
        raise
    shutil.rmtree(work, ignore_errors=True)
    sizes = {k: (out_dir / f).stat().st_size for k, f in files.items()}
    return {"files": files, "sizes": sizes, "folder": str(out_dir.resolve()), **info}


def _video_path(video_id: str) -> str:
    with session_scope() as db:
        return db.get(Video, video_id).path


__all__ = ["process_video_job", "transcribe_job", "export_job", "romanise_words", "Project"]
