"""Detect English words that Whisper wrote in Urdu script (code-switching), e.g. پراجکٹ -> "project".

Both the Urdu-script word and English candidates are reduced to a phonetic consonant skeleton; an unknown
Urdu word whose skeleton matches a known English word is written in English. Only used for words that are
not in the Urdu lexicon, so real Urdu words are never replaced.
"""
from __future__ import annotations

import re

# Common English words in Pakistani Urdu speech (roughly ordered by frequency; first match wins).
WORDS = """
meeting project complete presentation email mail office phone mobile computer laptop internet online offline
video channel subscribe like share comment comments link description update upload download app website
system software hardware data file folder password account login logout message status story post page
group team manager boss company business market marketing sales customer client order delivery product
service problem solution plan planning idea issue point topic question answer result report review test
exam paper class school college university teacher student students course lecture assignment project
doctor hospital medicine clinic report patient appointment emergency operation
time minute second hour week weekend month year date schedule deadline late early fast slow busy free
start stop finish complete cancel confirm check select send receive call missed number contact
camera picture photo selfie screen screenshot battery charger charge signal network wifi bluetooth
car bus train ticket station airport flight hotel room booking restaurant menu pizza burger coffee
shopping mall shop discount offer price budget salary bonus job interview career experience skill
training workshop seminar program event party function wedding birthday gift surprise
game match cricket football player score team captain coach practice
film movie drama episode season series song music singer actor actress hero star fan fans
news channel interview live stream streaming viewer viewers audience content creator vlog vlogs blog
please sorry thanks thank welcome okay ok hello bye guys friends friend brother sister family
basically actually literally seriously definitely exactly obviously probably simple simply
normal special important interesting amazing awesome perfect best good bad nice cool great super
level step method process system design style quality quantity size type version model brand
government minister election vote party policy budget tax bank loan card cash payment transfer
account balance online shopping order tracking address location map area city country
energy power electricity light fan AC heater water gas bill bills
health fitness gym exercise diet weight sugar pressure test result report
office meeting agenda notes minutes presentation slides deck draft final approval feedback
support help desk ticket complaint request response reply follow update
engineer engineering developer development code coding programming design designer testing
problem error bug fix issue crash
"""

_ORDER = []
for _w in WORDS.split():
    lw = _w.lower()
    if lw not in _ORDER:
        _ORDER.append(lw)


def english_key(word: str) -> str:
    w = word.lower()
    initial_vowel = bool(re.match(r"[aeiou]", w))
    w = re.sub(r"tion|sion", "Sn", w)
    w = w.replace("sh", "S").replace("ch", "C").replace("ph", "f").replace("th", "t").replace("ck", "k")
    w = re.sub(r"c(?=[eiy])", "s", w)
    w = w.replace("c", "k").replace("q", "k").replace("x", "ks").replace("z", "s").replace("v", "w")
    w = re.sub(r"(?<=.)g(?=[eiy])", "j", w)  # soft g (page, message, college) but not get/give/gift
    w = re.sub(r"[aeiouyh]", "", w)
    w = re.sub(r"(.)\1+", r"\1", w)
    return ("V" if initial_vowel else "") + w


_URDU_MAP = {
    "ک": "k", "ق": "k", "خ": "k", "گ": "g", "غ": "g", "ج": "j", "ژ": "j", "س": "s", "ص": "s", "ث": "s", "ز": "s",
    "ذ": "s", "ض": "s", "ظ": "s", "ت": "t", "ٹ": "t", "ط": "t", "د": "d", "ڈ": "d", "پ": "p", "ب": "b", "ف": "f",
    "ر": "r", "ڑ": "r", "ل": "l", "م": "m", "ن": "n", "ں": "n", "ش": "S", "چ": "C",
}
_URDU_VOWELS = set("اآعءئیےۓہھحو")


def urdu_key(word: str) -> str:
    out = []
    initial_vowel = bool(word) and word[0] in "اآعای"
    for i, ch in enumerate(word):
        if ch in _URDU_MAP:
            out.append(_URDU_MAP[ch])
        elif ch == "و":
            # consonant w/v at start or before a vowel letter, otherwise a vowel
            nxt = word[i + 1] if i + 1 < len(word) else ""
            if i == 0 or nxt in "اآیے":
                out.append("w")
    key = re.sub(r"(.)\1+", r"\1", "".join(out))
    return ("V" if initial_vowel else "") + key


_INDEX: dict[str, str] = {}
for _w in _ORDER:
    _INDEX.setdefault(english_key(_w), _w)


def match_english(urdu_word: str) -> str | None:
    key = urdu_key(urdu_word)
    bare = key.lstrip("V")
    if len(bare) < 2 or (len(bare) < 3 and len(urdu_word) < 5):
        return None
    hit = _INDEX.get(key)
    if hit:
        return hit
    return None
