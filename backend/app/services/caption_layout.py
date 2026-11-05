"""Caption layout engine.

IMPORTANT: this is a line-for-line port of frontend/src/preview/captionLayout.ts. Both sides take the same
inputs (style, words, frame size, font metrics) and produce the same lines/boxes, which is what keeps the
browser preview and the burned-in export visually identical. Change both files together.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from ..config import STYLE_REFERENCE
from . import fonts as font_svc

_ARABIC_RE = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")


def is_rtl(text: str) -> bool:
    return bool(_ARABIC_RE.search(text or ""))


def apply_case(text: str, mode: str) -> str:
    if mode == "upper":
        return text.upper()
    if mode == "lower":
        return text.lower()
    if mode == "title":
        return " ".join(w[:1].upper() + w[1:] for w in text.split(" "))
    return text


@dataclass
class LayoutLine:
    word_indices: list[int]
    text: str
    width: float
    cx: float  # anchor x (left/center/right edge depending on align)
    cy: float  # vertical centre of the line box
    baseline: float


@dataclass
class Rect:
    x: float
    y: float
    w: float
    h: float


@dataclass
class Layout:
    scale: float
    font_px: float
    line_height: float
    lines: list[LayoutLine] = field(default_factory=list)
    boxes: list[Rect] = field(default_factory=list)
    radius: float = 0.0
    center_x: float = 0.0
    center_y: float = 0.0
    rtl: bool = False


def layout_caption(words: list[str], style: dict, frame_w: int, frame_h: int) -> Layout:
    font = font_svc.get_font(style.get("fontFamily"))
    scale = min(frame_w, frame_h) / STYLE_REFERENCE
    weight = int(style.get("fontWeight", 400))
    italic = bool(style.get("italic"))
    words = [apply_case(w, style.get("textCase", "none")) for w in words]
    rtl = is_rtl(" ".join(words))
    max_w = max(10.0, float(style.get("maxWidth", 0.8)) * frame_w)
    bg = bool(style.get("backgroundEnabled"))
    pad_x = float(style.get("backgroundPaddingX", 0)) * scale if bg else 0.0
    pad_y = float(style.get("backgroundPaddingY", 0)) * scale if bg else 0.0
    base_px = float(style.get("fontSize", 48)) * scale
    max_lines = max(1, int(style.get("maxLines", 2)))
    wrap = bool(style.get("wrap", True))

    def wrap_lines(px: float) -> list[tuple[list[int], str, float]]:
        ls = float(style.get("letterSpacing", 0)) * scale
        meas = lambda t: font_svc.measure(font, t, px, weight, italic, ls)  # noqa: E731
        out: list[tuple[list[int], str, float]] = []
        cur_idx: list[int] = []
        cur = ""
        for i, w in enumerate(words):
            if not w:
                continue
            if not cur:
                cur, cur_idx = w, [i]
                continue
            cand = f"{cur} {w}"
            if not wrap or meas(cand) <= max_w:
                cur, cur_idx = cand, cur_idx + [i]
            else:
                out.append((cur_idx, cur, meas(cur)))
                cur, cur_idx = w, [i]
        if cur:
            out.append((cur_idx, cur, meas(cur)))
        return out

    px = base_px
    lines = wrap_lines(px)
    # shrink-to-fit when the caption needs more lines than allowed
    tries = 0
    while len(lines) > max_lines and tries < 12:
        px *= 0.92
        lines = wrap_lines(px)
        tries += 1

    lh = float(style.get("lineHeight", 1.25)) * px
    n = max(1, len(lines))
    block_w = max((l[2] for l in lines), default=0.0)
    block_h = n * lh
    bg_w_frac = float(style.get("backgroundWidth", 0) or 0)
    total_w = bg_w_frac * frame_w if (bg and bg_w_frac > 0) else block_w + 2 * pad_x
    total_h = max(block_h + 2 * pad_y, float(style.get("backgroundMinHeight", 0)) * scale if bg else 0.0)

    cx = float(style.get("x", 0.5)) * frame_w
    cy = float(style.get("y", 0.85)) * frame_h
    cx = min(max(cx, total_w / 2), frame_w - total_w / 2) if total_w < frame_w else frame_w / 2
    cy = min(max(cy, total_h / 2), frame_h - total_h / 2) if total_h < frame_h else frame_h / 2

    asc = font.win_ascent / font.upem * px
    desc = font.win_descent / font.upem * px
    align = style.get("align", "center")
    box_left = cx - total_w / 2
    top = cy - block_h / 2

    out = Layout(scale=scale, font_px=px, line_height=lh, center_x=cx, center_y=cy, rtl=rtl,
                 radius=float(style.get("backgroundRadius", 0)) * scale)
    for i, (idx, text, width) in enumerate(lines):
        lcy = top + (i + 0.5) * lh
        if align == "left":
            ax = box_left + pad_x
        elif align == "right":
            ax = box_left + total_w - pad_x
        else:
            ax = cx
        out.lines.append(LayoutLine(idx, text, width, ax, lcy, lcy + (asc - desc) / 2))

    if bg and lines:
        if style.get("backgroundMode") == "line":
            for ln in out.lines:
                if align == "left":
                    lx = ln.cx - pad_x
                elif align == "right":
                    lx = ln.cx - ln.width - pad_x
                else:
                    lx = ln.cx - ln.width / 2 - pad_x
                out.boxes.append(Rect(lx, ln.cy - lh / 2 - pad_y, ln.width + 2 * pad_x, lh + 2 * pad_y))
        else:
            out.boxes.append(Rect(box_left, cy - total_h / 2, total_w, total_h))
    return out


def rounded_rect_path(r: Rect, radius: float) -> list[tuple]:
    """Path commands for a rounded rectangle: ('m',x,y) ('l',x,y) ('b',x1,y1,x2,y2,x,y).
    Same geometry as the SVG path drawn in the preview."""
    rad = max(0.0, min(radius, r.w / 2, r.h / 2))
    x0, y0, x1, y1 = r.x, r.y, r.x + r.w, r.y + r.h
    if rad < 0.5:
        return [("m", x0, y0), ("l", x1, y0), ("l", x1, y1), ("l", x0, y1)]
    k = rad * 0.5523  # bezier circle approximation
    return [
        ("m", x0 + rad, y0),
        ("l", x1 - rad, y0),
        ("b", x1 - rad + k, y0, x1, y0 + rad - k, x1, y0 + rad),
        ("l", x1, y1 - rad),
        ("b", x1, y1 - rad + k, x1 - rad + k, y1, x1 - rad, y1),
        ("l", x0 + rad, y1),
        ("b", x0 + rad - k, y1, x0, y1 - rad + k, x0, y1 - rad),
        ("l", x0, y0 + rad),
        ("b", x0, y0 + rad - k, x0 + rad - k, y0, x0 + rad, y0),
    ]


def _fmt(v: float) -> str:
    return str(int(round(v))) if math.isfinite(v) else "0"


def ass_path(cmds: list[tuple], dx: float = 0, dy: float = 0) -> str:
    parts: list[str] = []
    for c in cmds:
        op, *nums = c
        pts = [(_fmt(nums[i] - dx), _fmt(nums[i + 1] - dy)) for i in range(0, len(nums), 2)]
        parts.append(op + " " + " ".join(f"{a} {b}" for a, b in pts))
    return " ".join(parts)
