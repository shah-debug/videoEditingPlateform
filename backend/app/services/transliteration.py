"""Urdu script -> Roman Urdu transliteration (contextual, word-level, timestamp-preserving).

Pipeline per transcript:
  1. normalise Arabic-presentation letters to Urdu letters, strip tatweel, keep diacritics aside
  2. split each Whisper word into leading punctuation / core / trailing punctuation
  3. lookup order:  user dictionary  ->  two-word phrases  ->  contextual rules  ->  lexicon
                    ->  morphology (plural/oblique suffixes, attached postpositions)  ->  heuristic fallback
  4. merge future-tense particles into the verb (جاؤں گا -> "jaunga"), keeping the merged word's timing
  5. Latin words (English code-switching) pass through unchanged; Devanagari (when Whisper writes Urdu
     speech in Hindi script) is romanised phonetically
  6. Urdu punctuation -> Latin punctuation; sentence case

This is deliberately *not* translation: word order, names and spoken words are preserved.
"""
from __future__ import annotations

import re
import unicodedata

from .english_loanwords import match_english
from .urdu_lexicon import LEXICON as _CURATED_LEX, _parse
from .urdu_lexicon_extra import _RAW as _EXTRA_RAW, VERB_STEMS_RAW

# curated entries win over the bulk vocabulary list
_RAW_LEX = {**_parse(_EXTRA_RAW), **_CURATED_LEX}

_NORMALISE = str.maketrans({
    "ي": "ی",  # Arabic yeh -> Farsi/Urdu yeh
    "ى": "ی",  # alef maksura -> yeh
    "ك": "ک",  # Arabic kaf -> keheh
    "ه": "ہ",  # heh -> heh goal
    "ە": "ہ",  # ae -> heh goal
    "ة": "ت",  # teh marbuta -> teh
    "أ": "ا",  # alef with hamza above -> alef
    "إ": "ا",
    "ـ": None,      # tatweel
    "‌": " ",       # ZWNJ (used inside compounds) -> space
    "‍": None,
})
_URDU_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_DIACRITICS = re.compile(r"[ً-ٰٟ۪-ۭ]")
_ARABIC = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_PUNCT_MAP = {"۔": ".", "؟": "?", "،": ",", "؛": ";", "٪": "%", "«": '"', "»": '"', "!": "!"}
_EDGE_PUNCT = "۔؟،؛.,!?;:\"'()[]«»…-–—"

FUTURE_PARTICLES = {"گا": "ga", "گی": "gi", "گے": "ge"}
# words after which گا/گی/گے must NOT be merged (they are not verbs)
_NO_MERGE_BEFORE = {"کا", "کی", "کے", "کو", "سے", "نے", "پر", "میں", "اور", "یا", "تو"}


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFC", text or "")
    # composed forms first
    text = text.replace("ۂ", "ۂ").replace("یٔ", "ئ")
    return text.translate(_NORMALISE).translate(_URDU_DIGITS)


def strip_diacritics(text: str) -> str:
    return _DIACRITICS.sub("", text)


LEXICON: dict[str, str] = {strip_diacritics(normalise(k)): v for k, v in _RAW_LEX.items()}
PHRASES: dict[str, str] = {k: v for k, v in LEXICON.items() if " " in k}

# verb roots -> (roman stem, roman stem used before a vowel ending)
VERB_STEMS: dict[str, tuple[str, str]] = {}
for _line in VERB_STEMS_RAW.strip().splitlines():
    _u, _, _r = _line.strip().partition(" ")
    if _u and _r:
        _full, _, _short = _r.partition("/")
        VERB_STEMS[strip_diacritics(normalise(_u))] = (_full, _short or _full)
# bare roots are also words (imperative: کر kar, سن sun, لکھ likh)
for _u, (_full, _) in VERB_STEMS.items():
    LEXICON.setdefault(_u, _full)

# verb endings, longest first. (urdu ending, roman after a consonant root, roman after a vowel root)
_VERB_ENDINGS = [
    ("ئیے", "iye", "iye"), ("یئے", "iye", "iye"), ("ئیں", "ein", "yein"), ("ئیو", "iyo", "yo"),
    ("یے", "iye", "iye"), ("ؤں", "un", "un"), ("وں", "un", "un"), ("یں", "ein", "ein"),
    ("ئے", "e", "ye"), ("ئی", "i", "yi"), ("یا", "ya", "ya"),
    ("نا", "na", "na"), ("نی", "ni", "ni"), ("نے", "ne", "ne"),
    ("تا", "ta", "ta"), ("تی", "ti", "ti"), ("تے", "te", "te"),
    ("ؤ", "o", "o"), ("و", "o", "o"), ("ے", "e", "e"), ("ا", "a", "ya"), ("ی", "i", "yi"),
]
_VOWEL_START = ("i", "e", "o", "u", "a", "y")


def has_arabic(text: str) -> bool:
    return bool(_ARABIC.search(text or ""))


def _split_edges(tok: str) -> tuple[str, str, str]:
    i, j = 0, len(tok)
    while i < j and tok[i] in _EDGE_PUNCT:
        i += 1
    while j > i and tok[j - 1] in _EDGE_PUNCT:
        j -= 1
    return tok[:i], tok[i:j], tok[j:]


def _map_punct(p: str) -> str:
    return "".join(_PUNCT_MAP.get(c, c) for c in p)


# ------------------------------------------------------------------ heuristic fallback

_CONS = {
    "ب": "b", "پ": "p", "ت": "t", "ٹ": "t", "ث": "s", "ج": "j", "چ": "ch", "ح": "h", "خ": "kh", "د": "d",
    "ڈ": "d", "ذ": "z", "ر": "r", "ڑ": "r", "ز": "z", "ژ": "zh", "س": "s", "ش": "sh", "ص": "s", "ض": "z",
    "ط": "t", "ظ": "z", "غ": "gh", "ف": "f", "ق": "q", "ک": "k", "گ": "g", "ل": "l", "م": "m", "ن": "n",
}
_DIAC = {"َ": "a", "ِ": "i", "ُ": "u", "ً": "an", "ْ": "", "ٰ": "a"}


def _fallback(word: str) -> str:
    """Rule-based romanisation for words not in the lexicon. Short vowels are not written in Urdu, so we
    insert 'a' where Urdu phonotactics make an inherent vowel likely. Uses diacritics when present."""
    chars = list(word)
    out: list[str] = []
    kinds: list[str] = []  # 'c' consonant, 'v' vowel per emitted chunk
    n = len(chars)
    i = 0
    while i < n:
        ch = chars[i]
        nxt = chars[i + 1] if i + 1 < n else ""
        first, last = i == 0, i == n - 1
        if ch in _DIAC:
            if _DIAC[ch]:
                out.append(_DIAC[ch])
                kinds.append("v")
        elif ch == "ّ":  # shadda: double previous consonant
            if out and kinds[-1] == "c":
                out.append(out[-1][-1])
                kinds.append("c")
        elif ch == "آ":
            out.append("aa")
            kinds.append("v")
        elif ch == "ا":
            if first:
                out.append("a")
            elif kinds and kinds[-1] == "v" and out[-1].endswith("a"):
                pass
            else:
                out.append("a")
            kinds.append("v")
        elif ch == "ع":
            if first or (kinds and kinds[-1] == "c"):
                out.append("a")
                kinds.append("v")
        elif ch in ("و", "ؤ"):
            if first:
                out.append("w")
                kinds.append("c")
            elif ch == "ؤ":
                out.append("u")
                kinds.append("v")
            elif nxt in ("ا", "ی", "ے") and not last:
                out.append("w")
                kinds.append("c")
            else:
                out.append("o")
                kinds.append("v")
        elif ch in ("ی", "ئ"):
            if first:
                out.append("y")
                kinds.append("c")
            elif ch == "ئ":
                out.append("i")
                kinds.append("v")
            elif nxt in ("ا", "و", "ے") and not last:
                out.append("y")
                kinds.append("c")
            elif last and kinds and kinds[-1] == "v":
                out.append("i")
                kinds.append("v")
            else:
                out.append("i" if last else "ee" if kinds and kinds[-1] == "c" and n > 3 else "i")
                kinds.append("v")
        elif ch in ("ے", "ۓ"):
            out.append("e")
            kinds.append("v")
        elif ch == "ھ":  # aspiration mark (bh, ph, kh...): never takes an inherent vowel before it
            out.append("h")
            kinds.append("a")
        elif ch in ("ہ", "ۂ"):
            if last and kinds and kinds[-1] == "c":
                out.append("a")
                kinds.append("v")
            elif last:
                pass
            else:
                out.append("h")
                kinds.append("c")
        elif ch == "ں":
            out.append("n")
            kinds.append("c")
        elif ch == "ء":
            pass
        elif ch in _CONS:
            out.append(_CONS[ch])
            kinds.append("c")
        else:
            out.append(ch)
            kinds.append("c")
        i += 1

    # insert inherent short vowels: after a word-initial consonant followed by a consonant, and between
    # a final consonant pair (e.g. نظر -> nazar, کل -> kal)
    res: list[str] = []
    m = len(out)
    for k, chunk in enumerate(out):
        res.append(chunk)
        if k + 1 < m and kinds[k] in ("c", "a") and kinds[k + 1] == "c":
            initial = k == 0 or (k == 1 and kinds[0] == "c" and kinds[1] == "a")
            final_pair = k + 1 == m - 1 and "v" not in kinds[max(0, k - 1):k]
            if initial or final_pair:
                res.append("a")
    s = "".join(res)
    letters = [c for c in word if c not in _DIAC and c != "ّ"]
    if len(letters) == 3 and letters[1] == "ا" and letters[0] in _CONS and letters[2] in _CONS:
        s = _CONS[letters[0]] + "aa" + _CONS[letters[2]]
    s = re.sub(r"aaa+", "aa", s)
    s = re.sub(r"(.)\1{2,}", r"\1\1", s)
    return s


# ------------------------------------------------------------------ Devanagari (Hindi-script Urdu speech)

_DEV_VOWELS = {"अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ए": "e", "ऐ": "ai", "ओ": "o",
               "औ": "au", "ऋ": "ri"}
_DEV_SIGNS = {"ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "oo", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
              "ृ": "ri", "ं": "n", "ँ": "n", "ः": "h"}
_DEV_CONS = {"क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh",
             "ञ": "n", "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d",
             "ध": "dh", "न": "n", "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r",
             "ल": "l", "व": "v", "श": "sh", "ष": "sh", "स": "s", "ह": "h", "क़": "q", "ख़": "kh", "ग़": "gh",
             "ज़": "z", "फ़": "f", "ड़": "r", "ढ़": "rh"}


def romanise_devanagari(word: str) -> str:
    word = unicodedata.normalize("NFC", word)
    out = []
    i, n = 0, len(word)
    while i < n:
        ch = word[i]
        two = word[i:i + 2]
        if two in _DEV_CONS:
            ch, i = two, i + 1
        if ch in _DEV_CONS:
            out.append(_DEV_CONS[ch])
            nxt = word[i + 1] if i + 1 < n else ""
            if nxt == "्":
                i += 1
            elif nxt in _DEV_SIGNS and nxt not in "ंँः":
                pass
            elif i + 1 < n:  # inherent schwa (dropped word-finally)
                out.append("a")
        elif ch in _DEV_VOWELS:
            out.append(_DEV_VOWELS[ch])
        elif ch in _DEV_SIGNS:
            out.append(_DEV_SIGNS[ch])
        elif ch == "्" or ch == "़":
            pass
        elif ch == "।":
            out.append(".")
        else:
            out.append(ch)
        i += 1
    return "".join(out)


# ------------------------------------------------------------------ main API


class Transliterator:
    def __init__(self, user_dict: dict[str, str] | None = None):
        self._ne_in_clause = False
        self.user = {strip_diacritics(normalise(k)).strip(): v for k, v in (user_dict or {}).items() if k.strip()}

    def _lookup(self, core: str) -> str | None:
        if core in self.user:
            return self.user[core]
        return LEXICON.get(core)

    def _morph(self, core: str) -> str | None:
        # attached postposition: اسکا = اس + کا, آپکو = آپ + کو
        for suf in ("کا", "کی", "کے", "کو", "سے", "نے"):
            if core.endswith(suf) and len(core) > len(suf) + 1:
                stem = self._lookup(core[: -len(suf)])
                if stem:
                    return stem + LEXICON[suf]
        # conjugated verbs: root + ending (لکھتے likhte, سمجھو samjho, کھائیں khayein)
        verb = self._verb(core)
        if verb:
            return verb
        # oblique plural -وں, plural -یں, -یاں
        for suf, rom in (("وں", "on"), ("یں", "ein"), ("یاں", "iyan"), ("ئیں", "ein")):
            if core.endswith(suf) and len(core) > len(suf) + 1:
                stem_u = core[: -len(suf)]
                stem = self._lookup(stem_u) or self._lookup(stem_u + "ا") or self._lookup(stem_u + "ہ")
                if stem:
                    base = stem[:-1] if stem.endswith("a") and not stem.endswith("aa") else stem
                    return base + rom
        return None

    @staticmethod
    def _verb(core: str) -> str | None:
        for end, after_c, after_v in _VERB_ENDINGS:
            if not core.endswith(end) or len(core) <= len(end):
                continue
            stem = VERB_STEMS.get(core[: -len(end)])
            if not stem:
                continue
            full, short = stem
            vowel_root = full[-1] in "aeiou"
            if vowel_root:
                return full + after_v
            return (short if after_c.startswith(_VOWEL_START) else full) + after_c
        return None

    def _contextual(self, core: str, prev: str | None, nxt: str | None, sentence_start: bool) -> str | None:
        if core == "کیا":
            # past tense of karna ("kiya") vs question word ("kya")
            if sentence_start:
                return "kya"
            if nxt == "کیا":
                return "kya"
            if prev == "کیا":
                return "kiya"
            if prev == "نے" or self._ne_in_clause or nxt in {"ہے", "تھا", "تھی", "تھے", "گیا", "گئی", "گئے", "جائے", "جاتا", "جاتی",
                                        "جاتے", "جا", "ہوا"}:
                return "kiya"
            return "kya"
        if core == "میں":
            # pronoun "me" (I) at sentence start / before نے, otherwise postposition "mein" (in)
            if sentence_start or prev is None:
                return "me"
            # pronoun when followed by a time word / adverb / verb-like word rather than closing a noun phrase
            if nxt in {"نے", "بھی", "تو", "ہی", "کل", "آج", "ابھی", "اب", "پھر", "نہیں", "یہ", "وہ", "آپ", "تم",
                       "ہمیشہ", "کبھی", "بہت", "اپنے", "اپنی", "اپنا", "صرف", "خود", "جب", "اس", "ان", "ہوں",
                       "تھا", "تھی", "کیا", "سمجھتا", "سمجھتی", "چاہتا", "چاہتی", "جانتا", "جانتی"}:
                return "me"
            if prev in {"اور", "کہ", "جب", "اگر", "تو", "لیکن", "مگر", "پھر", "کیونکہ", "بلکہ"}:
                return "me"
            return "mein"
        if core == "ہوا" and prev in {"تیز", "ٹھنڈی", "گرم", "تازہ"}:
            return "hawa"
        if core == "کہ" and nxt is None:
            return "ke"
        return None

    def word(self, core: str, prev: str | None, nxt: str | None, sentence_start: bool) -> str:
        if not core:
            return ""
        if _DEVANAGARI.search(core):
            return romanise_devanagari(core)
        if not has_arabic(core):
            return core  # Latin / numbers (English code-switching) unchanged
        bare = strip_diacritics(core)
        if bare in self.user:
            return self.user[bare]
        ctx = self._contextual(bare, prev, nxt, sentence_start)
        if ctx:
            return ctx
        return self._lookup(bare) or self._morph(bare) or match_english(bare) or _fallback(core)

    def transliterate_words(self, words: list[str]) -> list[tuple[str, list[int]]]:
        """Returns [(roman_word, [source indices...])]. Indices let callers merge word timestamps."""
        parts = [_split_edges(normalise(w).strip()) for w in words]
        cores = [strip_diacritics(c) for _, c, _ in parts]
        out: list[tuple[str, list[int]]] = []
        sentence_start = True
        self._ne_in_clause = False  # an ergative نے earlier in the clause makes کیا the verb "kiya"
        i = 0
        n = len(words)
        while i < n:
            lead, core, trail = parts[i]
            prev = cores[i - 1] if i > 0 else None
            nxt = cores[i + 1] if i + 1 < n else None
            if sentence_start:
                self._ne_in_clause = False
                prev = None  # context never crosses a sentence boundary
            if any(c in trail for c in "۔؟.!?"):
                nxt = None
            # two-word phrase (e.g. اسلام آباد, ان شاءاللہ)
            if i + 1 < n and not trail and not parts[i + 1][0]:
                phrase = f"{cores[i]} {cores[i + 1]}"
                if phrase in self.user or phrase in PHRASES:
                    rom = self.user.get(phrase) or PHRASES[phrase]
                    if "نے" in (cores[i], cores[i + 1]):
                        self._ne_in_clause = True
                    t2 = parts[i + 1][2]
                    out.append((_map_punct(lead) + rom + _map_punct(t2), [i, i + 1]))
                    sentence_start = any(c in t2 for c in "۔؟.!?")
                    i += 2
                    continue
            if core in FUTURE_PARTICLES and out and not lead and prev and has_arabic(prev) \
                    and prev not in _NO_MERGE_BEFORE and not parts[i - 1][2]:
                rom_prev, idxs = out[-1]
                # karein + ge -> karenge, jayein + ge -> jayenge, hun + ga -> hoonga
                if rom_prev.endswith("ein"):
                    rom_prev = rom_prev[:-3] + "en"
                elif rom_prev.lower() == "hun":
                    rom_prev = rom_prev[:1] + "oon"
                out[-1] = (rom_prev + FUTURE_PARTICLES[core] + _map_punct(trail), idxs + [i])
            else:
                rom = self.word(core, prev, nxt, sentence_start)
                out.append((_map_punct(lead) + rom + _map_punct(trail), [i]))
            sentence_start = any(c in trail for c in "۔؟.!?،,;؛:")
            if core == "نے":
                self._ne_in_clause = True
            i += 1
        return _sentence_case(out)

    def transliterate_text(self, text: str) -> str:
        toks = [t for t in re.split(r"\s+", text or "") if t]
        return " ".join(w for w, _ in self.transliterate_words(toks))


def _sentence_case(items: list[tuple[str, list[int]]]) -> list[tuple[str, list[int]]]:
    out = []
    cap = True
    for w, idx in items:
        if cap:
            m = re.search(r"[A-Za-z]", w)
            if m:
                w = w[: m.start()] + w[m.start()].upper() + w[m.start() + 1:]
                cap = False
        if re.search(r"[.!?]$", w):
            cap = True
        out.append((w, idx))
    return out
