"""Caption style model. Mirrors frontend/src/types.ts (CaptionStyle).

Units: every pixel value is expressed for a frame whose shorter side is 1080 px ("style units") and scaled to
the real frame size. Positions (x, y, maxWidth, backgroundWidth) are fractions of the frame.
"""
from __future__ import annotations

from copy import deepcopy

DEFAULT_STYLE: dict = {
    # font
    "fontFamily": "poppins",
    "fontSize": 56,
    "fontWeight": 700,
    "italic": False,
    "underline": False,
    "letterSpacing": 0,
    "lineHeight": 1.25,
    "textCase": "none",  # none|upper|lower|title
    "wrap": True,
    # colours
    "textColor": "#FFFFFF",
    "textOpacity": 1.0,
    # outline
    "outlineEnabled": True,
    "outlineColor": "#000000",
    "outlineWidth": 3,
    # shadow
    "shadowEnabled": False,
    "shadowColor": "#000000",
    "shadowOpacity": 0.6,
    "shadowBlur": 6,
    "shadowOffsetX": 3,
    "shadowOffsetY": 3,
    # background
    "backgroundEnabled": False,
    "backgroundMode": "block",  # block|line
    "backgroundColor": "#000000",
    "backgroundOpacity": 0.7,
    "backgroundPaddingX": 24,
    "backgroundPaddingY": 10,
    "backgroundRadius": 12,
    "backgroundWidth": 0,  # 0 = fit text, otherwise fraction of frame width
    "backgroundMinHeight": 0,  # style units
    # position
    "position": "bottom",  # top|top-center|center|bottom-center|bottom|custom
    "x": 0.5,
    "y": 0.85,
    "align": "center",  # left|center|right
    "maxWidth": 0.8,
    "maxLines": 2,
    # animation
    "animationIn": "none",  # none|fade|pop|slide-up|slide-down
    "animationOut": "none",  # none|fade
    "animationDuration": 0.25,
    # word-level
    "wordMode": "none",  # none|highlight|karaoke|reveal
    "activeWordColor": "#FFD400",
}

POSITION_Y = {"top": 0.12, "top-center": 0.3, "center": 0.5, "bottom-center": 0.7, "bottom": 0.85}


def merged_style(base: dict | None, override: dict | None = None) -> dict:
    s = deepcopy(DEFAULT_STYLE)
    if base:
        s.update({k: v for k, v in base.items() if v is not None})
    if override:
        s.update({k: v for k, v in override.items() if v is not None})
    return s


BUILTIN_PRESETS: list[tuple[str, dict]] = [
    ("Classic White", {
        "fontFamily": "arial", "fontSize": 48, "fontWeight": 700, "textColor": "#FFFFFF",
        "outlineEnabled": True, "outlineColor": "#000000", "outlineWidth": 3, "shadowEnabled": False,
        "backgroundEnabled": False, "position": "bottom", "y": 0.85, "textCase": "none", "wordMode": "none",
        "animationIn": "none", "animationOut": "none"}),
    ("Bold White on Black", {
        "fontFamily": "poppins", "fontSize": 50, "fontWeight": 700, "textColor": "#FFFFFF",
        "outlineEnabled": False, "shadowEnabled": False, "backgroundEnabled": True, "backgroundMode": "block",
        "backgroundColor": "#000000", "backgroundOpacity": 0.85, "backgroundPaddingX": 28, "backgroundPaddingY": 12,
        "backgroundRadius": 10, "position": "bottom", "y": 0.85, "wordMode": "none"}),
    ("Yellow Highlight", {
        "fontFamily": "poppins", "fontSize": 54, "fontWeight": 700, "textColor": "#FFFFFF",
        "outlineEnabled": True, "outlineColor": "#000000", "outlineWidth": 4, "backgroundEnabled": False,
        "wordMode": "highlight", "activeWordColor": "#FFD400", "position": "bottom", "y": 0.82}),
    ("Minimal Clean", {
        "fontFamily": "segoe-ui", "fontSize": 40, "fontWeight": 400, "textColor": "#FFFFFF",
        "outlineEnabled": False, "shadowEnabled": True, "shadowColor": "#000000", "shadowOpacity": 0.55,
        "shadowBlur": 8, "shadowOffsetX": 0, "shadowOffsetY": 2, "backgroundEnabled": False,
        "position": "bottom", "y": 0.88, "wordMode": "none"}),
    ("Social Media", {
        "fontFamily": "poppins", "fontSize": 60, "fontWeight": 700, "textColor": "#FFFFFF",
        "outlineEnabled": False, "backgroundEnabled": True, "backgroundMode": "line", "backgroundColor": "#7C3AED",
        "backgroundOpacity": 1.0, "backgroundPaddingX": 18, "backgroundPaddingY": 6, "backgroundRadius": 14,
        "position": "center", "y": 0.62, "animationIn": "pop", "wordMode": "none"}),
    ("TikTok Style", {
        "fontFamily": "anton", "fontSize": 78, "fontWeight": 400, "textColor": "#FFFFFF", "textCase": "upper",
        "outlineEnabled": True, "outlineColor": "#000000", "outlineWidth": 6, "shadowEnabled": True,
        "shadowColor": "#000000", "shadowOpacity": 0.5, "shadowBlur": 4, "shadowOffsetX": 0, "shadowOffsetY": 5,
        "backgroundEnabled": False, "position": "center", "y": 0.6, "maxLines": 2, "maxWidth": 0.82,
        "wordMode": "highlight", "activeWordColor": "#2BF06B", "animationIn": "pop"}),
    ("YouTube Shorts", {
        "fontFamily": "segoe-ui-black", "fontSize": 70, "fontWeight": 400, "textColor": "#FFFFFF",
        "textCase": "upper", "outlineEnabled": True, "outlineColor": "#000000", "outlineWidth": 5,
        "backgroundEnabled": False, "position": "center", "y": 0.66, "wordMode": "karaoke",
        "activeWordColor": "#FFD400", "animationIn": "pop"}),
    ("Podcast", {
        "fontFamily": "georgia", "fontSize": 44, "fontWeight": 400, "textColor": "#F5F5F4",
        "outlineEnabled": False, "backgroundEnabled": True, "backgroundMode": "block", "backgroundColor": "#111827",
        "backgroundOpacity": 0.72, "backgroundPaddingX": 32, "backgroundPaddingY": 16, "backgroundRadius": 18,
        "position": "bottom", "y": 0.84, "animationIn": "fade", "animationOut": "fade", "wordMode": "none"}),
    ("Cinematic", {
        "fontFamily": "times", "fontSize": 42, "fontWeight": 400, "italic": False, "letterSpacing": 1,
        "textColor": "#FDF6E3", "outlineEnabled": False, "shadowEnabled": True, "shadowColor": "#000000",
        "shadowOpacity": 0.8, "shadowBlur": 4, "shadowOffsetX": 0, "shadowOffsetY": 2, "backgroundEnabled": False,
        "position": "bottom", "y": 0.9, "animationIn": "fade", "animationOut": "fade", "wordMode": "none"}),
    ("Word-by-Word Highlight", {
        "fontFamily": "poppins", "fontSize": 62, "fontWeight": 700, "textColor": "#FFFFFF",
        "outlineEnabled": True, "outlineColor": "#000000", "outlineWidth": 4, "backgroundEnabled": False,
        "position": "center", "y": 0.7, "maxLines": 2, "wordMode": "reveal", "activeWordColor": "#FF4FD8"}),
]
