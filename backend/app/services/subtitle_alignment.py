"""Word timing clean-up, optional WhisperX forced alignment, and caption segmentation."""
from __future__ import annotations

import logging
import math
import re
from pathlib import Path

log = logging.getLogger(__name__)

SENTENCE_END = re.compile(r"[.!?۔؟।]+[\"')\]]*$")
CLAUSE_END = re.compile(r"[,،;؛:]$")

CAPTION_LENGTHS = {
    # max characters per caption, max duration (s)
    "short": (22, 2.6),   # social / TikTok style, 1-4 words
    "medium": (42, 4.5),  # standard subtitle line
    "long": (84, 6.5),    # two full lines
}
NO_SPACE_LANGS = {"zh", "ja", "th", "lo", "my", "km"}


def whisperx_available() -> bool:
    try:
        import whisperx  # noqa: F401

        return True
    except Exception:
        return False


def refine_with_whisperx(audio_path: Path, segments: list[dict], language: str) -> list[dict] | None:
    """Forced alignment with a wav2vec2 phoneme model (much tighter word boundaries). Optional dependency:
    returns None when WhisperX or an alignment model for `language` isn't available."""
    try:
        import whisperx
    except Exception:
        return None
    try:
        device = "cpu"
        model_a, metadata = whisperx.load_align_model(language_code=language, device=device)
        audio = whisperx.load_audio(str(audio_path))
        result = whisperx.align([{"start": s["start"], "end": s["end"], "text": s["text"]} for s in segments],
                                model_a, metadata, audio, device, return_char_alignments=False)
        words = []
        for seg in result.get("segments", []):
            for w in seg.get("words", []):
                if "start" in w and "end" in w and w.get("word", "").strip():
                    words.append({"text": w["word"].strip(), "start": float(w["start"]), "end": float(w["end"]),
                                  "probability": float(w.get("score", 0))})
        return words or None
    except Exception as e:  # model missing for this language, etc.
        log.warning("WhisperX alignment skipped: %s", e)
        return None


def clean_words(words: list[dict]) -> list[dict]:
    """Monotonic, non-overlapping, non-zero-length word timings."""
    out: list[dict] = []
    last_end = 0.0
    for w in words:
        s, e = float(w["start"]), float(w["end"])
        s = max(s, last_end)
        if e < s + 0.04:
            e = s + 0.04
        out.append({**w, "start": round(s, 3), "end": round(e, 3)})
        last_end = e
    return out


def _join(ws: list[dict], joiner: str) -> str:
    return joiner.join(w["text"] for w in ws)


def _balanced_split(group: list[dict], joiner: str, max_chars: int, max_dur: float) -> list[list[dict]]:
    """Split one sentence into the fewest chunks that respect max_chars/max_dur, with chunk lengths as even
    as possible and breaks preferably after commas or at pauses (dynamic programming)."""
    total = len(_join(group, joiner))
    dur = group[-1]["end"] - group[0]["start"]
    if (total <= max_chars * 1.15 and dur <= max_dur * 1.25) or len(group) == 1:
        return [group]
    m = len(group)
    n_min = max(2, math.ceil(total / max_chars), math.ceil(dur / max_dur))
    best: list[list[dict]] | None = None
    best_cost = float("inf")
    for n in range(n_min, min(m, n_min + 2) + 1):
        target = total / n
        INF = float("inf")
        dp = [[INF] * (m + 1) for _ in range(n + 1)]
        back = [[0] * (m + 1) for _ in range(n + 1)]
        dp[0][0] = 0.0
        for k in range(1, n + 1):
            for j in range(k, m + 1):
                for i in range(k - 1, j):
                    if dp[k - 1][i] == INF:
                        continue
                    chunk = group[i:j]
                    L = len(_join(chunk, joiner))
                    D = chunk[-1]["end"] - chunk[0]["start"]
                    c = ((L - target) / max(target, 1)) ** 2
                    if L > max_chars * 1.2 and len(chunk) > 1:
                        c += 50
                    if D > max_dur * 1.4 and len(chunk) > 1:
                        c += 20
                    if j < m:
                        if CLAUSE_END.search(chunk[-1]["text"]):
                            c -= 0.35
                        c -= min(1.0, group[j]["start"] - chunk[-1]["end"]) * 0.6
                        if len(chunk) == 1 and len(chunk[0]["text"]) <= 3:
                            c += 0.5
                    v = dp[k - 1][i] + c
                    if v < dp[k][j]:
                        dp[k][j], back[k][j] = v, i
        if dp[n][m] + 0.25 * n < best_cost:
            best_cost = dp[n][m] + 0.25 * n
            chunks, j = [], m
            for k in range(n, 0, -1):
                i = back[k][j]
                chunks.append(group[i:j])
                j = i
            best = chunks[::-1]
    return best or [group]


def segment_words(words: list[dict], length: str = "medium", language: str | None = None,
                  pause_split: float = 0.7) -> list[dict]:
    """Group words into readable captions: sentences (split at punctuation and long pauses) are kept together
    when they fit, otherwise split into evenly sized chunks."""
    max_chars, max_dur = CAPTION_LENGTHS.get(length, CAPTION_LENGTHS["medium"])
    joiner = "" if language in NO_SPACE_LANGS else " "
    if language in NO_SPACE_LANGS:
        max_chars = max(8, max_chars // 2)

    groups: list[list[dict]] = []
    cur: list[dict] = []
    for w in words:
        if cur and w["start"] - cur[-1]["end"] > pause_split:
            groups.append(cur)
            cur = []
        cur.append(w)
        if SENTENCE_END.search(w["text"]):
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)

    captions: list[list[dict]] = []
    for g in groups:
        # very long run-on "sentences" (no punctuation): pre-split greedily, then balance each piece
        if len(g) > 60:
            for k in range(0, len(g), 40):
                captions.extend(_balanced_split(g[k:k + 40], joiner, max_chars, max_dur))
        else:
            captions.extend(_balanced_split(g, joiner, max_chars, max_dur))

    out = []
    for i, c in enumerate(captions):
        start = c[0]["start"]
        end = c[-1]["end"]
        nxt = captions[i + 1][0]["start"] if i + 1 < len(captions) else None
        # keep captions on screen a little longer than the last word for readability
        hold = end + 0.3
        end = min(hold, nxt) if nxt is not None else hold
        if end - start < 0.5:
            end = min(start + 0.5, nxt) if nxt is not None else start + 0.5
        out.append({
            "start": round(start, 3),
            "end": round(max(end, start + 0.1), 3),
            "text": _join(c, joiner),
            "sourceText": joiner.join(w.get("sourceText") or w["text"] for w in c),
            "words": c,
        })
    return out
