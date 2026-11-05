"""Application configuration. Values can be overridden with environment variables or a .env file."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent

load_dotenv(ROOT_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env")


def _path(env: str, default: Path) -> Path:
    p = Path(os.getenv(env, str(default))).expanduser().resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


DATA_DIR = _path("CAPTION_DATA_DIR", ROOT_DIR / "data")
UPLOAD_DIR = _path("CAPTION_UPLOAD_DIR", BACKEND_DIR / "uploads")
EXPORT_DIR = _path("CAPTION_EXPORT_DIR", BACKEND_DIR / "exports")
TEMP_DIR = _path("CAPTION_TEMP_DIR", BACKEND_DIR / "temp")
FONTS_DIR = _path("CAPTION_FONTS_DIR", BACKEND_DIR / "fonts")
USER_FONTS_DIR = _path("CAPTION_USER_FONTS_DIR", FONTS_DIR / "user")
MODELS_DIR = _path("CAPTION_MODELS_DIR", DATA_DIR / "models")
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"

DATABASE_URL = os.getenv("CAPTION_DATABASE_URL", f"sqlite:///{(DATA_DIR / 'caption_editor.db').as_posix()}")

FFMPEG_BIN = os.getenv("FFMPEG_BIN") or shutil.which("ffmpeg") or "ffmpeg"
FFPROBE_BIN = os.getenv("FFPROBE_BIN") or shutil.which("ffprobe") or "ffprobe"

# Whisper defaults (CPU friendly). "large-v3-turbo" or "large-v3" give the best Urdu accuracy but are slower.
WHISPER_DEFAULT_MODEL = os.getenv("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "auto")  # auto | cpu | cuda
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "auto")  # auto | int8 | float16 | int8_float16
WHISPER_CPU_THREADS = int(os.getenv("WHISPER_CPU_THREADS", "0"))  # 0 = let CTranslate2 decide
DETECT_LANGUAGE_ON_UPLOAD = os.getenv("DETECT_LANGUAGE_ON_UPLOAD", "1") == "1"

MAX_WORKERS = int(os.getenv("CAPTION_MAX_WORKERS", "2"))
HOST = os.getenv("CAPTION_HOST", "127.0.0.1")
PORT = int(os.getenv("CAPTION_PORT", "8000"))

SUPPORTED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
SUPPORTED_FONT_EXTENSIONS = {".ttf", ".otf"}

# Reference size for style units: all pixel values in a caption style are expressed for a frame
# whose shorter side is 1080 px, then scaled to the real preview/export size.
STYLE_REFERENCE = 1080.0
