"""Subprocess helpers (Windows friendly: no console windows, killable, progress parsing)."""
from __future__ import annotations

import subprocess
import sys
import threading
from typing import Callable

from ..config import FFMPEG_BIN, FFPROBE_BIN

CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


class Cancelled(Exception):
    pass


class ProcessError(RuntimeError):
    pass


def run(cmd: list[str], timeout: float | None = None, cwd: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, cwd=cwd,
        creationflags=CREATE_NO_WINDOW,
    )


def ffmpeg_with_progress(
    args: list[str],
    duration: float,
    on_progress: Callable[[float], None] | None = None,
    cancel_event: threading.Event | None = None,
    cwd: str | None = None,
) -> None:
    """Run ffmpeg with `-progress pipe:1`, reporting fraction complete. Raises Cancelled / ProcessError."""
    cmd = [FFMPEG_BIN, "-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", *args]
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
        cwd=cwd, creationflags=CREATE_NO_WINDOW,
    )
    stderr_tail: list[str] = []

    def _drain():
        assert proc.stderr is not None
        for line in proc.stderr:
            stderr_tail.append(line.rstrip())
            if len(stderr_tail) > 60:
                del stderr_tail[:20]

    t = threading.Thread(target=_drain, daemon=True)
    t.start()
    assert proc.stdout is not None
    try:
        for line in proc.stdout:
            if cancel_event is not None and cancel_event.is_set():
                proc.kill()
                raise Cancelled()
            key, _, val = line.strip().partition("=")
            if key in ("out_time_us", "out_time_ms") and val.isdigit() and duration > 0 and on_progress:
                on_progress(min(1.0, int(val) / 1_000_000 / duration))
        proc.wait()
    finally:
        if proc.poll() is None:
            proc.kill()
    t.join(timeout=2)
    if cancel_event is not None and cancel_event.is_set():
        raise Cancelled()
    if proc.returncode != 0:
        msg = "\n".join(l for l in stderr_tail[-12:] if l)
        raise ProcessError(f"FFmpeg failed (exit {proc.returncode}): {msg}")


def check_binaries() -> dict:
    out = {}
    for name, binary in (("ffmpeg", FFMPEG_BIN), ("ffprobe", FFPROBE_BIN)):
        try:
            r = run([binary, "-version"], timeout=15)
            out[name] = {"ok": r.returncode == 0, "version": (r.stdout.splitlines() or [""])[0]}
        except (OSError, subprocess.TimeoutExpired) as e:
            out[name] = {"ok": False, "version": "", "error": str(e)}
    if out.get("ffmpeg", {}).get("ok"):
        r = run([FFMPEG_BIN, "-hide_banner", "-filters"], timeout=15)
        out["libass"] = " subtitles " in r.stdout
        r = run([FFMPEG_BIN, "-hide_banner", "-encoders"], timeout=15)
        out["libx264"] = "libx264" in r.stdout
        out["libx265"] = "libx265" in r.stdout
    return out
