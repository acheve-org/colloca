"""Cheap, deterministic Spanish/Italian language check (no extra dependency).

Each language's stopword list, minus the words both languages share, is a strong signal
for telling the two apart. It is deliberately not a general language identifier: its job is to
catch a document filed under the wrong corpus, which would otherwise be annotated with the wrong
model and silently pollute lemmas and every statistic.
"""
import re
from functools import lru_cache

from spacy.lang.es.stop_words import STOP_WORDS as ES_STOP
from spacy.lang.it.stop_words import STOP_WORDS as IT_STOP

SAMPLE_WORDS = 20_000     # the first words are plenty to decide
MIN_WORDS = 20           # below this the sample is too short to judge
MISMATCH_MIN_SHARE = 0.06  # the other language must explain at least this share of the words...
MISMATCH_RATIO = 2.0       # ...and at least this many times more than the expected language
UNCERTAIN_MAX_SHARE = 0.08  # neither language explains the text (another language, lists, codes)

_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)


@lru_cache(maxsize=1)
def _distinct() -> dict[str, frozenset[str]]:
    es, it = {w.lower() for w in ES_STOP}, {w.lower() for w in IT_STOP}
    return {"es": frozenset(es - it), "it": frozenset(it - es)}


def check(text: str, lang: str) -> dict:
    """Judge whether `text` looks like `lang` ('es' or 'it').

    Returns {"verdict": "ok" | "mismatch" | "uncertain" | "short", "detected": "es" | "it" | None,
    "scores": {"es": share, "it": share}}. Only "mismatch" is clear enough to reject a document.
    """
    words = [w.lower() for w in _WORD.findall(text[:SAMPLE_WORDS * 12])][:SAMPLE_WORDS]
    distinct = _distinct()
    if lang not in distinct:
        return {"verdict": "ok", "detected": None, "scores": {}}
    other = "it" if lang == "es" else "es"
    n = len(words)
    scores = {k: (sum(w in v for w in words) / n if n else 0.0) for k, v in distinct.items()}
    rounded = {k: round(v, 3) for k, v in scores.items()}
    if n < MIN_WORDS:
        return {"verdict": "short", "detected": None, "scores": rounded}
    own, foreign = scores[lang], scores[other]
    if foreign >= MISMATCH_MIN_SHARE and foreign > MISMATCH_RATIO * own:
        return {"verdict": "mismatch", "detected": other, "scores": rounded}
    if max(own, foreign) < UNCERTAIN_MAX_SHARE:
        return {"verdict": "uncertain", "detected": None, "scores": rounded}
    return {"verdict": "ok", "detected": lang if own >= foreign else other, "scores": rounded}
