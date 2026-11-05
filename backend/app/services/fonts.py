"""Font catalog + text measurement.

The same font *files* are used by the browser preview (served via /api/fonts/file/...) and by libass during
export (copied into a fontsdir). Text is measured with HarfBuzz so line wrapping on the server matches the
canvas-based wrapping in the browser.
"""
from __future__ import annotations

import shutil
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import uharfbuzz as hb
from fontTools.ttLib import TTFont

from ..config import FONTS_DIR, USER_FONTS_DIR

WIN_FONTS = Path(r"C:\Windows\Fonts")

# id, label, {variant: path}
_SYSTEM_FONTS: list[tuple[str, str, dict[str, Path]]] = [
    ("arial", "Arial", {"400": WIN_FONTS / "arial.ttf", "700": WIN_FONTS / "arialbd.ttf",
                        "400i": WIN_FONTS / "ariali.ttf", "700i": WIN_FONTS / "arialbi.ttf"}),
    ("segoe-ui", "Segoe UI", {"400": WIN_FONTS / "segoeui.ttf", "700": WIN_FONTS / "segoeuib.ttf",
                              "400i": WIN_FONTS / "segoeuii.ttf", "700i": WIN_FONTS / "segoeuiz.ttf"}),
    ("segoe-ui-black", "Segoe UI Black", {"400": WIN_FONTS / "seguibl.ttf", "400i": WIN_FONTS / "seguibli.ttf"}),
    ("verdana", "Verdana", {"400": WIN_FONTS / "verdana.ttf", "700": WIN_FONTS / "verdanab.ttf",
                            "400i": WIN_FONTS / "verdanai.ttf", "700i": WIN_FONTS / "verdanaz.ttf"}),
    ("tahoma", "Tahoma", {"400": WIN_FONTS / "tahoma.ttf", "700": WIN_FONTS / "tahomabd.ttf"}),
    ("georgia", "Georgia", {"400": WIN_FONTS / "georgia.ttf", "700": WIN_FONTS / "georgiab.ttf",
                            "400i": WIN_FONTS / "georgiai.ttf", "700i": WIN_FONTS / "georgiaz.ttf"}),
    ("times", "Times New Roman", {"400": WIN_FONTS / "times.ttf", "700": WIN_FONTS / "timesbd.ttf",
                                  "400i": WIN_FONTS / "timesi.ttf", "700i": WIN_FONTS / "timesbi.ttf"}),
    ("trebuchet", "Trebuchet MS", {"400": WIN_FONTS / "trebuc.ttf", "700": WIN_FONTS / "trebucbd.ttf",
                                   "400i": WIN_FONTS / "trebucit.ttf", "700i": WIN_FONTS / "trebucbi.ttf"}),
    ("calibri", "Calibri", {"400": WIN_FONTS / "calibri.ttf", "700": WIN_FONTS / "calibrib.ttf",
                            "400i": WIN_FONTS / "calibrii.ttf", "700i": WIN_FONTS / "calibriz.ttf"}),
    ("impact", "Impact", {"400": WIN_FONTS / "impact.ttf"}),
    ("comic", "Comic Sans MS", {"400": WIN_FONTS / "comic.ttf", "700": WIN_FONTS / "comicbd.ttf",
                                "400i": WIN_FONTS / "comici.ttf", "700i": WIN_FONTS / "comicz.ttf"}),
    ("consolas", "Consolas", {"400": WIN_FONTS / "consola.ttf", "700": WIN_FONTS / "consolab.ttf"}),
]

_BUNDLED = FONTS_DIR / "bundled"
_BUNDLED_FONTS: list[tuple[str, str, dict[str, Path]]] = [
    ("poppins", "Poppins", {"400": _BUNDLED / "Poppins-Regular.ttf", "700": _BUNDLED / "Poppins-Bold.ttf",
                            "400i": _BUNDLED / "Poppins-Italic.ttf", "700i": _BUNDLED / "Poppins-BoldItalic.ttf"}),
    ("anton", "Anton", {"400": _BUNDLED / "Anton-Regular.ttf"}),
    ("bebas-neue", "Bebas Neue", {"400": _BUNDLED / "BebasNeue-Regular.ttf"}),
    ("gulzar", "Gulzar (Urdu Nastaliq)", {"400": _BUNDLED / "Gulzar-Regular.ttf"}),
    ("lateef", "Lateef (Urdu Naskh)", {"400": _BUNDLED / "Lateef-Regular.ttf", "700": _BUNDLED / "Lateef-Bold.ttf"}),
]


@dataclass
class FontInfo:
    id: str
    label: str
    family: str  # internal family name (what libass matches on)
    files: dict[str, Path]
    upem: int
    win_ascent: int
    win_descent: int
    supports_arabic: bool
    supports_latin: bool
    source: str  # system|bundled|user
    variants: list[str] = field(default_factory=list)

    @property
    def ass_size_factor(self) -> float:
        """libass sizes a font so that winAscent+winDescent == \\fs. CSS sizes the em square.
        So ass_fs = css_px * ass_size_factor."""
        return (self.win_ascent + self.win_descent) / self.upem

    def to_public(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "family": self.family,
            "variants": self.variants,
            "upem": self.upem,
            "ascent": self.win_ascent / self.upem,
            "descent": self.win_descent / self.upem,
            "supportsArabic": self.supports_arabic,
            "supportsLatin": self.supports_latin,
            "source": self.source,
        }

    def file_for(self, weight: int, italic: bool) -> Path:
        bold = weight >= 600
        order = []
        if bold and italic:
            order = ["700i", "700", "400i", "400"]
        elif bold:
            order = ["700", "400"]
        elif italic:
            order = ["400i", "400"]
        else:
            order = ["400"]
        for key in order:
            if key in self.files:
                return self.files[key]
        return next(iter(self.files.values()))


def _family_name(tt: TTFont) -> str:
    name = tt["name"]
    for nid in (1, 16):
        rec = name.getName(nid, 3, 1, 0x409) or name.getName(nid, 1, 0, 0)
        if rec:
            return str(rec)
    return "Unknown"


def _load_info(fid: str, label: str, files: dict[str, Path], source: str) -> FontInfo | None:
    files = {k: v for k, v in files.items() if v.exists()}
    if "400" not in files:
        if not files:
            return None
        files["400"] = next(iter(files.values()))
    try:
        tt = TTFont(str(files["400"]), lazy=True, fontNumber=0)
        upem = tt["head"].unitsPerEm
        os2 = tt["OS/2"] if "OS/2" in tt else None
        if os2 is not None and (os2.usWinAscent + os2.usWinDescent) > 0:
            asc, desc = os2.usWinAscent, os2.usWinDescent
        else:
            asc, desc = tt["hhea"].ascent, -tt["hhea"].descent
        cmap = tt.getBestCmap() or {}
        family = _family_name(tt)
        tt.close()
    except Exception:
        return None
    return FontInfo(
        id=fid, label=label, family=family, files=files, upem=upem, win_ascent=asc, win_descent=desc,
        supports_arabic=0x0627 in cmap and 0x06CC in cmap, supports_latin=0x0041 in cmap,
        source=source, variants=sorted(files.keys()),
    )


_lock = threading.Lock()
_catalog: dict[str, FontInfo] | None = None


def _scan_user_fonts() -> list[FontInfo]:
    out: list[FontInfo] = []
    for p in sorted(USER_FONTS_DIR.glob("*")):
        if p.suffix.lower() not in {".ttf", ".otf"}:
            continue
        info = _load_info(f"user-{p.stem}", p.stem, {"400": p}, "user")
        if info:
            info.label = f"{info.family} (custom)"
            out.append(info)
    return out


def catalog(refresh: bool = False) -> dict[str, FontInfo]:
    global _catalog
    with _lock:
        if _catalog is None or refresh:
            cat: dict[str, FontInfo] = {}
            for fid, label, files in _BUNDLED_FONTS + _SYSTEM_FONTS:
                info = _load_info(fid, label, files, "bundled" if files["400"].parent == _BUNDLED else "system")
                if info:
                    cat[fid] = info
            for info in _scan_user_fonts():
                cat[info.id] = info
            _catalog = cat
        return _catalog


DEFAULT_FONT = "poppins"
DEFAULT_URDU_FONT = "lateef"


def get_font(fid: str | None) -> FontInfo:
    cat = catalog()
    if fid and fid in cat:
        return cat[fid]
    return cat.get(DEFAULT_FONT) or next(iter(cat.values()))


def add_user_font(src: Path, original_name: str) -> FontInfo:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in Path(original_name).stem)[:60] or "font"
    dest = USER_FONTS_DIR / f"{safe}{src.suffix.lower()}"
    i = 1
    while dest.exists():
        dest = USER_FONTS_DIR / f"{safe}_{i}{src.suffix.lower()}"
        i += 1
    shutil.move(str(src), dest)
    info = _load_info(f"user-{dest.stem}", dest.stem, {"400": dest}, "user")
    if not info:
        dest.unlink(missing_ok=True)
        raise ValueError("The uploaded file is not a valid TrueType/OpenType font.")
    catalog(refresh=True)
    return catalog()[info.id]


# ---------------------------------------------------------------- measurement


@lru_cache(maxsize=64)
def _hb_font(path: str) -> tuple[hb.Font, int]:
    blob = hb.Blob.from_file_path(path)
    face = hb.Face(blob)
    font = hb.Font(face)
    return font, face.upem


@lru_cache(maxsize=20000)
def _advance_units(path: str, text: str) -> int:
    font, _ = _hb_font(path)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": True})
    return sum(p.x_advance for p in buf.glyph_positions)


def measure(font: FontInfo, text: str, px: float, weight: int, italic: bool, letter_spacing_px: float) -> float:
    """Advance width of `text` at CSS font-size `px` (matches canvas measureText + letterSpacing)."""
    if not text:
        return 0.0
    path = str(font.file_for(weight, italic))
    _, upem = _hb_font(path)
    return _advance_units(path, text) / upem * px + letter_spacing_px * len(text)
