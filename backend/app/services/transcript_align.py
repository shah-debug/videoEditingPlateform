"""Sync a user-supplied transcript (Roman Urdu, Urdu script, English...) to the speech in the video.

Whisper is used only as a *timing reference*: even when it mishears a word, it still knows roughly when
each word was spoken. The user's words are matched to Whisper's words on a phonetic key (so "bohat" ~ "bahut",
"Abdullah" ~ "عبداللہ" ~ "دلہ"), matched words take Whisper's timing, and unmatched words are timed between
their matched neighbours. The user's text is kept exactly as typed.

Pipeline: parse_transcript() -> align_tokens() -> build_captions().
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from functools import lru_cache

from .transliteration import Transliterator, has_arabic, romanise_devanagari, _DEVANAGARI

# SRT/VTT pieces that are not caption text
_TIMING_LINE = re.compile(r"^\s*(\d{1,2}:)?\d{1,2}:\d{2}([.,]\d{1,3})?\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}([.,]\d{1,3})?.*$")
_INDEX_LINE = re.compile(r"^\s*\d+\s*$")
_TAG = re.compile(r"<[^>]+>|\{\\[^}]*\}")


@dataclass
class Token:
    text: str          # exactly as the user wrote it (with punctuation)
    line: int          # index of the line it came from


def parse_transcript(text: str) -> tuple[list[Token], int]:
    """Split pasted text into word tokens. Accepts plain text, or SRT/VTT (timings and numbering are dropped,
    each cue becomes one line). Returns (tokens, number of non-empty lines)."""
    lines: list[str] = []
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n").replace("﻿", "")
    is_subs = bool(re.search(r"-->", raw))
    cue: list[str] = []
    for line in raw.split("\n"):
        s = line.strip()
        if is_subs:
            if s.upper().startswith("WEBVTT") or s.startswith(("NOTE", "STYLE", "REGION")):
                continue
            if _TIMING_LINE.match(s) or (_INDEX_LINE.match(s) and not cue):
                continue
            if not s:
                if cue:
                    lines.append(" ".join(cue))
                    cue = []
                continue
            cue.append(_TAG.sub("", s))
        elif s:
            lines.append(_TAG.sub("", s))
    if cue:
        lines.append(" ".join(cue))
    tokens: list[Token] = []
    n_lines = 0
    for line in lines:
        words = [w for w in line.split() if w.strip()]
        if not words:
            continue
        for w in words:
            tokens.append(Token(w, n_lines))
        n_lines += 1
    return tokens, n_lines


# ------------------------------------------------------------------ phonetic keys

_PAIRS = [("chh", "C"), ("ch", "C"), ("sh", "S"), ("kh", "K"), ("gh", "G"), ("ph", "f"), ("th", "t"), ("dh", "d"),
          ("bh", "b"), ("jh", "j"), ("rh", "r"), ("tth", "t"), ("ee", "i"), ("oo", "u"), ("aa", "a"), ("ou", "o"),
          ("au", "o"), ("ai", "e"), ("ay", "e"), ("ei", "e"), ("ey", "e"), ("ck", "k")]
_LETTERS = str.maketrans({"q": "k", "c": "k", "v": "w", "x": "ks", "y": "i"})


@lru_cache(maxsize=50000)
def roman_key(word: str) -> str:
    """Spelling-insensitive Roman key: 'Bohat' ~ 'bahut', 'nahin' ~ 'nahi', 'zaroori' ~ 'zaruri'."""
    w = re.sub(r"[^a-z0-9]", "", word.lower())
    for a, b in _PAIRS:
        w = w.replace(a, b)
    w = w.translate(_LETTERS)
    w = re.sub(r"n$", "", w) if len(w) > 3 and w.endswith(("in", "en", "on", "un")) else w  # nasal: nahin~nahi
    w = re.sub(r"h(?=[^aeiou]|$)", "", w) if len(w) > 2 else w  # silent/aspirate h: rahna~rehna, subah~suba
    w = re.sub(r"(.)\1+", r"\1", w)
    return w


@lru_cache(maxsize=50000)
def _skeleton(key: str) -> str:
    return (key[0] if key[:1] in "aeiou" else "") + re.sub(r"[aeiou]", "", key)


@lru_cache(maxsize=200000)
def similarity(a: str, b: str) -> float:
    """0..1 similarity of two roman keys (weighted towards consonants, which carry Urdu words)."""
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    full = SequenceMatcher(None, a, b, autojunk=False).ratio()
    sa, sb = _skeleton(a), _skeleton(b)
    skel = SequenceMatcher(None, sa, sb, autojunk=False).ratio() if sa and sb else full
    score = 0.45 * full + 0.55 * skel
    # very short words are easy to confuse: demand near-identity
    if min(len(a), len(b)) <= 2:
        score *= 0.8
    return score


MATCH_THRESHOLD = 0.55


def to_roman(word: str, tr: Transliterator) -> str:
    if _DEVANAGARI.search(word):
        return romanise_devanagari(word)
    if has_arabic(word):
        return tr.transliterate_text(word)
    return word


# ------------------------------------------------------------------ alignment


SKIP_SPEECH_COST = 0.25  # per Whisper word skipped *between* matched words


def _weighted_lcs(a: list[str], b: list[str], band: int | None = None,
                  free_start: bool = True, free_end: bool = True) -> list[tuple[int, int]]:
    """Monotonic 1:1 matching of user words `a` to speech words `b`, maximising total similarity.

    Skipping a user word is free (it may simply have been misheard). Skipping speech words *inside* the matched
    stretch costs a little, so a word is never matched to the same word said a minute earlier just because
    its real counterpart was misheard. Speech before the first / after the last matched word is free when
    `free_start` / `free_end` (the transcript may cover only part of the video).
    An optional diagonal band keeps very long gaps tractable."""
    n, m = len(a), len(b)
    if not n or not m:
        return []
    NEG = float("-inf")
    score = [[NEG] * (m + 1) for _ in range(n + 1)]
    move = [[0] * (m + 1) for _ in range(n + 1)]  # 1 = match, 2 = skip user word, 3 = skip speech word
    score[0][0] = 0.0
    for j in range(1, m + 1):
        score[0][j] = 0.0 if free_start else -SKIP_SPEECH_COST * j
        move[0][j] = 3
    for i in range(1, n + 1):
        centre = i * m / n
        lo = 0 if band is None else max(0, int(centre - band))
        hi = m if band is None else min(m, int(centre + band) + 1)
        row, prow, mrow = score[i], score[i - 1], move[i]
        skip_cost = 0.0 if (i == n and free_end) else SKIP_SPEECH_COST
        for j in range(lo, hi + 1):
            best, mv = prow[j], 2
            if j > 0:
                if row[j - 1] - skip_cost > best:
                    best, mv = row[j - 1] - skip_cost, 3
                s = similarity(a[i - 1], b[j - 1])
                if s >= MATCH_THRESHOLD and prow[j - 1] + s > best:
                    best, mv = prow[j - 1] + s, 1
            row[j], mrow[j] = best, mv
    pairs: list[tuple[int, int]] = []
    i, j = n, m
    if score[n][m] == NEG:  # end of b outside the band: finish at the best reachable column
        j = max(range(m + 1), key=lambda c: score[n][c])
    while i > 0 and j > 0:
        mv = move[i][j]
        if mv == 1:
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif mv == 3:
            j -= 1
        else:
            i -= 1
    pairs.reverse()
    return pairs


def match_words(user_keys: list[str], asr_keys: list[str]) -> list[int | None]:
    """For every user word, the index of the ASR word it was spoken as (or None)."""
    n, m = len(user_keys), len(asr_keys)
    match: list[int | None] = [None] * n
    # 1) anchors: words that occur exactly once on both sides (names, rare nouns), kept only when they are
    #    in a consistent order (longest increasing subsequence). Repeated phrases ("like aur subscribe
    #    karein") can never pull the alignment to the wrong place this way.
    anchors = _unique_anchors(user_keys, asr_keys)
    # 2) similarity-weighted matching inside each gap between anchors
    prev_a, prev_b = 0, 0
    bounds = anchors + [(n, m)]
    for g, (a0, b0) in enumerate(bounds):
        ga, gb = user_keys[prev_a:a0], asr_keys[prev_b:b0]
        # Text before the first anchor was spoken just before it, text after the last anchor just after it.
        # The transcript may cover only part of the video, so don't search the whole remaining speech.
        window = int(len(ga) * 1.6) + 40
        first, last = g == 0, g == len(bounds) - 1
        if anchors and first and len(gb) > window:
            off = len(gb) - window
            gb = gb[off:]
            prev_b += off
        elif anchors and last:
            gb = gb[:window]
        if ga and gb:
            cells = len(ga) * len(gb)
            band = None if cells <= 2_500_000 else max(80, abs(len(ga) - len(gb)) + 80)
            # speech may be skipped freely only at the open ends of the whole transcript
            for i, j in _weighted_lcs(ga, gb, band, free_start=first, free_end=last):
                match[prev_a + i] = prev_b + j
        if a0 < n:
            match[a0] = b0
        prev_a, prev_b = a0 + 1, b0 + 1
    return match


def _unique_anchors(a: list[str], b: list[str]) -> list[tuple[int, int]]:
    count_a: dict[str, int] = {}
    count_b: dict[str, int] = {}
    for k in a:
        count_a[k] = count_a.get(k, 0) + 1
    for k in b:
        count_b[k] = count_b.get(k, 0) + 1
    pos_b = {k: j for j, k in enumerate(b) if count_b[k] == 1}
    cand = [(i, pos_b[k]) for i, k in enumerate(a)
            if len(k) >= 4 and count_a[k] == 1 and k in pos_b]
    if not cand:
        return []
    # longest increasing subsequence on the ASR positions (patience sorting, O(k log k))
    import bisect
    tails: list[int] = []
    tails_idx: list[int] = []
    parent = [-1] * len(cand)
    for ci, (_, j) in enumerate(cand):
        p = bisect.bisect_left(tails, j)
        if p == len(tails):
            tails.append(j)
            tails_idx.append(ci)
        else:
            tails[p] = j
            tails_idx[p] = ci
        parent[ci] = tails_idx[p - 1] if p > 0 else -1
    out = []
    ci = tails_idx[-1]
    while ci != -1:
        out.append(cand[ci])
        ci = parent[ci]
    out.reverse()
    return out


def _spread(words: list[dict], lo: float, hi: float) -> None:
    total = sum(max(1, len(w["text"])) for w in words)
    t = lo
    for w in words:
        d = (hi - lo) * max(1, len(w["text"])) / total
        w["start"], w["end"] = t, t + d
        t += d


def align_tokens(tokens: list[Token], asr_words: list[dict], duration: float,
                 user_dict: dict[str, str] | None = None) -> tuple[list[dict], dict]:
    """Give every user token a start/end time. asr_words: Whisper words [{text, start, end}]."""
    tr = Transliterator(user_dict)
    user_keys = [roman_key(to_roman(t.text, tr)) for t in tokens]
    # ASR words are romanised as one transcript (sentence context, merged future particles)
    asr_items: list[dict] = []
    if asr_words:
        if any(has_arabic(w["text"]) for w in asr_words):
            for text, idx in tr.transliterate_words([w["text"] for w in asr_words]):
                g = [asr_words[i] for i in idx]
                asr_items.append({"text": text, "start": g[0]["start"], "end": g[-1]["end"]})
        else:
            asr_items = [{"text": to_roman(w["text"], tr), "start": w["start"], "end": w["end"]} for w in asr_words]
    asr_keys = [roman_key(w["text"]) for w in asr_items]

    match = match_words(user_keys, asr_keys) if asr_items else [None] * len(tokens)
    matched = sum(1 for x in match if x is not None)

    out = [{"text": t.text, "start": 0.0, "end": 0.0, "line": t.line, "matched": match[k] is not None}
           for k, t in enumerate(tokens)]
    if not out:
        return [], {"matched": 0, "total": 0, "rate": 0.0}

    if matched == 0:
        # nothing recognisable (wrong language / unrelated transcript): spread over the detected speech
        lo = asr_items[0]["start"] if asr_items else 0.0
        hi = asr_items[-1]["end"] if asr_items else duration
        _spread(out, lo, max(hi, lo + 0.3 * len(out)))
    else:
        for k, j in enumerate(match):
            if j is not None:
                out[k]["start"], out[k]["end"] = asr_items[j]["start"], asr_items[j]["end"]
        # a matched word directly followed (no pause) by skipped ASR words is usually one word that Whisper
        # split in two (السلام علیکم for "Assalam-o-alaikum"): it keeps speaking through them. Skipped words
        # after a pause are speech the user left out, so they're not absorbed.
        for k in range(len(out) - 1):
            j, jn = match[k], match[k + 1]
            if j is None or jn is None or jn <= j + 1:
                continue
            end = out[k]["end"]
            for q in range(j + 1, jn):
                if asr_items[q]["start"] - end > 0.25:
                    break
                end = asr_items[q]["end"]
            out[k]["end"] = max(out[k]["end"], min(end, asr_items[jn]["start"]))
        avg = sum(w["end"] - w["start"] for w in asr_items) / len(asr_items)
        k = 0
        while k < len(out):
            if match[k] is not None:
                k += 1
                continue
            e = k
            while e < len(out) and match[e] is None:
                e += 1
            run = out[k:e]
            if k == 0:  # before the first matched word
                hi = out[e]["start"]
                first_asr = asr_items[0]["start"] if match[e] and match[e] > 0 else hi - avg * len(run)
                lo = max(0.0, min(first_asr, hi - 0.15 * len(run)))
                _spread(run, lo, hi)
            elif e == len(out):  # after the last matched word
                lo = out[k - 1]["end"]
                last_j = match[k - 1] or 0
                tail = asr_items[-1]["end"] if last_j < len(asr_items) - 1 else lo + avg * len(run)
                hi = min(max(tail, lo + 0.15 * len(run)), duration or tail)
                _spread(run, lo, max(hi, lo + 0.05 * len(run)))
            else:
                lo, hi = out[k - 1]["end"], out[e]["start"]
                if hi - lo < 0.12 * len(run):
                    # no room (e.g. "jaun ga" written as two words, heard as one): share the previous word's time
                    prev = out[k - 1]
                    lo = prev["start"]
                    _spread([prev] + run, lo, max(hi, lo + 0.1 * (len(run) + 1)))
                else:
                    _spread(run, lo, hi)
            k = e

    # monotonic, non-overlapping
    last = 0.0
    for w in out:
        w["start"] = max(w["start"], last)
        w["end"] = max(w["end"], w["start"] + 0.04)
        last = w["end"]
    stats = {"matched": matched, "total": len(out), "rate": matched / len(out)}
    return out, stats


def captions_from_lines(words: list[dict], next_gap_hold: float = 0.3) -> list[dict]:
    """One caption per line of the pasted transcript."""
    groups: dict[int, list[dict]] = {}
    for w in words:
        groups.setdefault(w["line"], []).append(w)
    ordered = [groups[k] for k in sorted(groups)]
    out = []
    for i, g in enumerate(ordered):
        start, end = g[0]["start"], g[-1]["end"]
        nxt = ordered[i + 1][0]["start"] if i + 1 < len(ordered) else None
        hold = end + next_gap_hold
        end = min(hold, nxt) if nxt is not None else hold
        if end - start < 0.5:
            end = min(start + 0.5, nxt) if nxt is not None else start + 0.5
        out.append({"start": round(start, 3), "end": round(max(end, start + 0.1), 3),
                    "text": " ".join(w["text"] for w in g), "sourceText": " ".join(w["text"] for w in g),
                    "words": [_clean(w) for w in g]})
    return out


def _clean(w: dict) -> dict:
    return {"text": w["text"], "start": round(w["start"], 3), "end": round(w["end"], 3),
            "probability": 1.0 if w.get("matched") else 0.5, "sourceText": w["text"]}


def clean_for_segmenter(words: list[dict]) -> list[dict]:
    return [_clean(w) for w in words]
