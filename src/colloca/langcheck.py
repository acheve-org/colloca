"""Cheap, deterministic language check among the configured languages (no extra dependency).

Each language's stopword list (shipped with spaCy, no model needed), minus the words the other configured languages
share, is a strong signal for telling them apart. It is deliberately not a general language identifier: its job is
to catch a document filed under the wrong corpus, which would otherwise be annotated with the wrong
model and silently pollute lemmas and every statistic.
"""
import importlib
import re
from functools import lru_cache

from . import languages

SAMPLE_WORDS = 20_000     # the first words are plenty to decide
MIN_WORDS = 20           # below this the sample is too short to judge
MISMATCH_MIN_SHARE = 0.06  # the other language must explain at least this share of the words...
MISMATCH_RATIO = 2.0       # ...and at least this many times more than the expected language
UNCERTAIN_MAX_SHARE = 0.08  # neither language explains the text (another language, lists, codes)

_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)


@lru_cache(maxsize=32)
def _distinct(codes: tuple[str, ...]) -> dict[str, frozenset[str]]:
    stops = {c: {w.lower() for w in importlib.import_module(f"spacy.lang.{c}.stop_words").STOP_WORDS}
             for c in codes}
    return {c: frozenset(stops[c].difference(*(stops[o] for o in codes if o != c))) for c in codes}


def _configured() -> tuple[str, ...]:
    codes = []
    for lang in languages.all_languages():
        try:
            importlib.import_module(f"spacy.lang.{lang.code}.stop_words")
        except ImportError:
            continue
        codes.append(lang.code)
    return tuple(sorted(codes))


def check(text: str, lang: str) -> dict:
    """Judge whether `text` looks like `lang`, one of the configured languages.

    Returns {"verdict": "ok" | "mismatch" | "uncertain" | "short", "detected": code | None,
    "scores": {code: share}}. Only "mismatch" is clear enough to reject a document. With fewer than two
    configured languages there is nothing to tell apart and the verdict is always "ok".
    """
    words = [w.lower() for w in _WORD.findall(text[:SAMPLE_WORDS * 12])][:SAMPLE_WORDS]
    codes = _configured()
    if lang not in codes or len(codes) < 2:
        return {"verdict": "ok", "detected": None, "scores": {}}
    distinct = _distinct(codes)
    n = len(words)
    scores = {k: (sum(w in v for w in words) / n if n else 0.0) for k, v in distinct.items()}
    rounded = {k: round(v, 3) for k, v in scores.items()}
    if n < MIN_WORDS:
        return {"verdict": "short", "detected": None, "scores": rounded}
    other = max((c for c in codes if c != lang), key=lambda c: scores[c])
    own, foreign = scores[lang], scores[other]
    if foreign >= MISMATCH_MIN_SHARE and foreign > MISMATCH_RATIO * own:
        return {"verdict": "mismatch", "detected": other, "scores": rounded}
    if max(own, foreign) < UNCERTAIN_MAX_SHARE:
        return {"verdict": "uncertain", "detected": None, "scores": rounded}
    return {"verdict": "ok", "detected": lang if own >= foreign else other, "scores": rounded}
