"""Video analysis and derived assets. The original upload is never modified."""
from __future__ import annotations

import json
import threading
from fractions import Fraction
from pathlib import Path
from typing import Callable

import numpy as np

from ..config import FFPROBE_BIN, SUPPORTED_VIDEO_EXTENSIONS
from ..utils.proc import ProcessError, ffmpeg_with_progress, run

BROWSER_VIDEO_CODECS = {"h264", "vp8", "vp9", "av1"}
BROWSER_AUDIO_CODECS = {"aac", "mp3", "opus", "vorbis", "flac", None}
BROWSER_CONTAINERS = {".mp4", ".webm", ".mov", ".mkv"}


class VideoError(ValueError):
    pass


def probe(path: Path) -> dict:
    if path.suffix.lower() not in SUPPORTED_VIDEO_EXTENSIONS:
        raise VideoError(f"Unsupported format '{path.suffix}'. Supported: MP4, MOV, AVI, MKV, WEBM.")
    r = run([FFPROBE_BIN, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            timeout=120)
    if r.returncode != 0:
        raise VideoError("Could not read this file. It may be corrupted or not a video. " + r.stderr.strip()[:300])
    data = json.loads(r.stdout or "{}")
    streams = data.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video" and
              not s.get("disposition", {}).get("attached_pic")), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not v:
        raise VideoError("No video stream found in this file.")
    fmt = data.get("format", {})
    duration = float(fmt.get("duration") or v.get("duration") or 0)
    if duration <= 0:
        raise VideoError("Video duration could not be determined; the file may be corrupted.")

    def _rate(s: str | None) -> float:
        try:
            f = Fraction(s or "0")
            return float(f) if f else 0.0
        except (ValueError, ZeroDivisionError):
            return 0.0

    width, height = int(v.get("width", 0)), int(v.get("height", 0))
    rotation = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rotation = int(sd["rotation"])
    if abs(rotation) in (90, 270):
        width, height = height, width
    fps = _rate(v.get("avg_frame_rate")) or _rate(v.get("r_frame_rate")) or 30.0
    return {
        "duration": duration,
        "width": width,
        "height": height,
        "fps": round(fps, 3),
        "videoCodec": v.get("codec_name"),
        "pixFmt": v.get("pix_fmt"),
        "audioCodec": a.get("codec_name") if a else None,
        "hasAudio": a is not None,
        "audioChannels": int(a.get("channels", 0)) if a else 0,
        "sampleRate": int(a.get("sample_rate", 0)) if a else 0,
        "bitrate": int(fmt.get("bit_rate") or 0),
        "format": fmt.get("format_long_name") or fmt.get("format_name"),
        "container": path.suffix.lower().lstrip("."),
        "sizeBytes": int(fmt.get("size") or path.stat().st_size),
        "rotation": rotation,
    }


def needs_proxy(path: Path, meta: dict) -> bool:
    """True when the browser most likely can't play the original (codec/container), or it's 10-bit/HEVC."""
    if path.suffix.lower() not in BROWSER_CONTAINERS:
        return True
    if meta.get("videoCodec") not in BROWSER_VIDEO_CODECS:
        return True
    if meta.get("audioCodec") not in BROWSER_AUDIO_CODECS:
        return True
    pix = meta.get("pixFmt") or ""
    return "10" in pix or "12" in pix or "422" in pix or "444" in pix


def extract_audio(src: Path, dest: Path, duration: float, on_progress: Callable[[float], None] | None = None,
                  cancel: threading.Event | None = None) -> Path:
    """16 kHz mono PCM WAV: the format Whisper expects. Light loudness normalisation helps quiet speech."""
    ffmpeg_with_progress(
        ["-i", str(src), "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "16000",
         "-af", "highpass=f=60,dynaudnorm=f=250:g=15", "-c:a", "pcm_s16le", str(dest)],
        duration, on_progress, cancel,
    )
    return dest


def build_waveform(wav: Path, dest: Path, peaks_per_second: int = 50) -> dict:
    """Peak envelope (0..1) for the timeline, computed from the 16 kHz wav in chunks."""
    import wave

    with wave.open(str(wav), "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        hop = max(1, sr // peaks_per_second)
        peaks: list[float] = []
        chunk = hop * peaks_per_second * 30
        while True:
            raw = wf.readframes(chunk)
            if not raw:
                break
            x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            m = len(x) // hop * hop
            if m:
                peaks.extend(np.abs(x[:m]).reshape(-1, hop).max(axis=1).tolist())
            if len(x) > m:
                peaks.append(float(np.abs(x[m:]).max()))
    arr = np.array(peaks or [0.0], dtype=np.float32)
    ref = float(np.percentile(arr, 99.5)) or 1.0
    arr = np.clip(arr / ref, 0, 1)
    out = {"peaksPerSecond": peaks_per_second, "duration": n / sr if sr else 0,
           "peaks": [round(float(v), 3) for v in arr]}
    dest.write_text(json.dumps(out), encoding="utf-8")
    return out


def build_proxy(src: Path, dest: Path, duration: float, on_progress: Callable[[float], None] | None = None,
                cancel: threading.Event | None = None) -> Path:
    """Browser-playable H.264/AAC preview copy (max 720p). Only used for preview; exports use the original."""
    ffmpeg_with_progress(
        ["-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=-2:'min(720,ih)'", "-c:v", "libx264",
         "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
         "-movflags", "+faststart", str(dest)],
        duration, on_progress, cancel,
    )
    return dest


__all__ = ["probe", "needs_proxy", "extract_audio", "build_waveform", "build_proxy",
           "VideoError", "ProcessError"]
