"""Final render with FFmpeg + libass.

Captions are converted to an ASS script (subtitle_formats.build_ass) whose PlayRes equals the output frame, so
every pixel value in the style maps 1:1 onto the exported video. The exact font files used by the preview are
copied into a private fontsdir so libass renders with the same fonts.
"""
from __future__ import annotations

import re
import shutil
import threading
from pathlib import Path
from typing import Callable

from . import fonts as font_svc
from .subtitle_formats import build_ass, to_srt, to_vtt
from ..schemas.style import merged_style
from ..utils.proc import ffmpeg_with_progress

ASPECTS = {"16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1.0, "4:5": 4 / 5}
QUALITY = {
    "h264": {"high": ("18", "medium"), "medium": ("21", "fast"), "low": ("25", "veryfast")},
    "h265": {"high": ("21", "medium"), "medium": ("25", "fast"), "low": ("29", "veryfast")},
}


def _even(v: float) -> int:
    return max(2, int(round(v / 2)) * 2)


def output_size(src_w: int, src_h: int, aspect: str, resolution: str) -> tuple[int, int]:
    ar = src_w / src_h if aspect in ("original", None, "") else ASPECTS.get(aspect, src_w / src_h)
    if resolution == "720p":
        short = 720
    elif resolution == "1080p":
        short = 1080
    elif resolution == "4k":
        short = 2160
    else:
        short = min(src_w, src_h)
    if ar >= 1:
        h = short
        w = h * ar
    else:
        w = short
        h = w / ar
    return _even(w), _even(h)


def safe_filename(name: str, default: str = "video") -> str:
    s = re.sub(r"[^\w\-. ]+", "_", name or "", flags=re.UNICODE).strip(" ._")
    return (s or default)[:80]


def write_subtitle_files(segments: list[dict], style: dict, w: int, h: int, out_dir: Path, base: str,
                         formats: list[str]) -> dict[str, Path]:
    out: dict[str, Path] = {}
    for fmt in formats:
        p = out_dir / f"{base}.{fmt}"
        if fmt == "srt":
            p.write_text(to_srt(segments), encoding="utf-8-sig")
        elif fmt == "vtt":
            p.write_text(to_vtt(segments), encoding="utf-8")
        elif fmt == "ass":
            p.write_text(build_ass(segments, style, w, h), encoding="utf-8-sig")
        else:
            continue
        out[fmt] = p
    return out


def collect_fonts(segments: list[dict], style: dict, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    ids = {merged_style(style, s.get("style")).get("fontFamily") for s in segments} | {style.get("fontFamily")}
    for fid in ids:
        info = font_svc.get_font(fid)
        for p in info.files.values():
            target = dest / p.name
            if not target.exists():
                shutil.copy2(p, target)


def render(
    src: Path,
    meta: dict,
    segments: list[dict],
    style: dict,
    settings: dict,
    params: dict,
    work_dir: Path,
    out_path: Path,
    on_progress: Callable[[float], None] | None = None,
    cancel: threading.Event | None = None,
) -> dict:
    aspect = settings.get("aspectRatio", "original")
    fit = settings.get("fitMode", "fit")
    pad = (settings.get("padColor") or "#000000").lstrip("#")
    w, h = output_size(meta["width"], meta["height"], aspect, params.get("resolution", "original"))
    codec = params.get("codec", "h264")
    if codec not in QUALITY:
        codec = "h264"
    crf, preset = QUALITY[codec].get(params.get("quality", "high"), QUALITY[codec]["high"])

    vf = []
    if fit == "fill":
        vf.append(f"scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,crop={w}:{h}")
    else:
        vf.append(f"scale={w}:{h}:force_original_aspect_ratio=decrease:flags=lanczos,"
                  f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=0x{pad}")
    vf.append("setsar=1")
    fps = params.get("fps", "original")
    if str(fps) not in ("original", "", "None"):
        vf.append(f"fps={float(fps):g}")
    if params.get("burnCaptions", True) and segments:
        (work_dir / "captions.ass").write_text(build_ass(segments, style, w, h), encoding="utf-8")
        collect_fonts(segments, style, work_dir / "fonts")
        # relative paths (cwd=work_dir) avoid Windows drive-letter escaping problems in the filter graph
        vf.append("subtitles=captions.ass:fontsdir=fonts")
    vf.append("format=yuv420p")

    args = ["-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-vf", ",".join(vf)]
    if codec == "h265":
        args += ["-c:v", "libx265", "-crf", crf, "-preset", preset, "-tag:v", "hvc1", "-x265-params", "log-level=error"]
    else:
        args += ["-c:v", "libx264", "-crf", crf, "-preset", preset, "-profile:v", "high"]
    if meta.get("audioCodec") == "aac":
        args += ["-c:a", "copy"]
    else:
        args += ["-c:a", "aac", "-b:a", "192k"]
    args += ["-movflags", "+faststart", str(out_path)]
    ffmpeg_with_progress(args, float(meta["duration"]), on_progress, cancel, cwd=str(work_dir))
    return {"width": w, "height": h, "codec": codec}
