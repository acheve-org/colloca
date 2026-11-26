"""Automatic alignment of two documents (the original and its translation) into sentence links.

Pipeline: split each document into paragraphs (the lines `ingest.read_file` keeps) and sentences (spaCy, as
for every other text), align the paragraphs, then the sentences inside each aligned paragraph block, with the
length model of Gale and Church (1993) extended by anchors: numbers, capitalised names that appear on both
sides, and the closing punctuation. Link types: 1:1, 1:2, 2:1, 1:0 and 0:1.

The result is only a proposal (nothing is stored). `confirm_pairs` turns the reviewed links into the
(source, target) pairs the existing storage takes: a merged unit becomes one segment (sentences joined with a
space), so segment N of one side is still the translation of segment N of the other. Units with an empty side
(1:0, 0:1) cannot be stored as a pair, so they are left out and reported.
"""
import math
import re
import unicodedata
from dataclasses import dataclass, field

from . import nlp
from .parallel import MAX_SEGMENT_CHARS, Pair, clean_segment

LOW_CONFIDENCE = 0.2          # links below this are marked for review
LINK_TYPES = ("1:1", "1:2", "2:1", "1:0", "0:1")
# (source items, target items, prior probability); Gale and Church's priors, 2:2 left out
_MOVES = ((1, 1, 0.89), (1, 0, 0.01), (0, 1, 0.01), (2, 1, 0.045), (1, 2, 0.045))
_S2 = 6.8                      # variance of the length difference per source character
_MIN_PROB = 1e-9
_NUMBER = re.compile(r"\d+")
_WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)?", re.UNICODE)
_PARA_FALLBACK = 0.6           # fewer 1:1 paragraph links than this: ignore paragraphs, align sentences flat


@dataclass
class Item:
    text: str
    length: int
    numbers: frozenset
    names: frozenset
    last: str                  # closing punctuation class

    @classmethod
    def of(cls, text: str) -> "Item":
        return cls(text, max(len(text), 1), *_features(text))


@dataclass
class Link:
    src: list[str]
    tgt: list[str]
    confidence: float = 0.0
    low: bool = False
    type: str = field(init=False)

    def __post_init__(self) -> None:
        self.type = f"{len(self.src)}:{len(self.tgt)}"
        if not self.src or not self.tgt:              # a unit without a counterpart always needs a look
            self.low = True


def _plain(word: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", word.lower()) if not unicodedata.combining(c))


def _features(text: str) -> tuple[frozenset, frozenset, str]:
    numbers = frozenset(n.lstrip("0") or "0" for n in _NUMBER.findall(text))
    names = set()
    for m in _WORD.finditer(text):
        w = m.group()
        if len(w) < 3 or not w[0].isupper() or not m.start():
            continue
        before = text[:m.start()].rstrip()
        if before and before[-1] in ".!?¿¡:«\"“(":
            continue                                  # sentence-initial capital, not a name
        names.add(_plain(w))
    tail = text.rstrip(" »”\")'")[-1:]
    last = tail if tail in "?!:;" else ("." if tail in ".…" else "")
    return numbers, frozenset(names), last


def _prob(delta: float) -> float:
    return math.erfc(abs(delta) / math.sqrt(2))      # two-sided tail of the normal distribution


def _delta(l1: float, l2: float, ratio: float) -> float:
    return (l2 - l1 * ratio) / math.sqrt(max(l1, 1) * _S2)


def _anchor_stats(a: list[Item], b: list[Item]) -> tuple[int, int, bool]:
    """(shared numbers + names, numbers found on one side only, closing punctuation agrees)."""
    na = frozenset().union(*(i.numbers for i in a)) if a else frozenset()
    nb = frozenset().union(*(i.numbers for i in b)) if b else frozenset()
    ma = frozenset().union(*(i.names for i in a)) if a else frozenset()
    mb = frozenset().union(*(i.names for i in b)) if b else frozenset()
    shared = len(na & nb) + len(ma & mb)
    only = len(na ^ nb)
    punct = bool(a and b and a[-1].last == b[-1].last)
    return shared, only, punct


def _cost(a: list[Item], b: list[Item], ratio: float, prior: float) -> float:
    l1, l2 = sum(i.length for i in a), sum(i.length for i in b)
    if not a or not b:
        cost = -math.log(prior) + 0.02 * (l1 + l2)
    else:
        cost = -math.log(max(prior * _prob(_delta(l1, l2, ratio)), _MIN_PROB))
    shared, only, punct = _anchor_stats(a, b)
    cost -= 1.5 * min(shared, 3)
    cost += 1.0 * min(only, 3)
    if a and b:
        cost += -0.5 if punct else 0.5
    return cost


def _confidence(a: list[Item], b: list[Item], ratio: float) -> float:
    if not a or not b:
        return 0.0
    p = _prob(_delta(sum(i.length for i in a), sum(i.length for i in b), ratio))
    shared, only, _ = _anchor_stats(a, b)
    p = min(1.0, p + 0.2 * min(shared, 2))
    return round(p * (0.5 if only and not shared else 1.0), 3)


def _ratio(a: list[Item], b: list[Item]) -> float:
    la, lb = sum(i.length for i in a), sum(i.length for i in b)
    return lb / la if la and lb else 1.0


def estimate_ratio(a: list[Item], b: list[Item]) -> float:
    """Length of the target per source character. The total is distorted by text that has no counterpart, so
    align once with it and take the median over the 1:1 links of that alignment."""
    first = _ratio(a, b)
    ones = sorted(sum(i.length for i in b[j0:j1]) / sum(i.length for i in a[i0:i1])
                  for i0, i1, j0, j1 in align_items(a, b, first) if i1 - i0 == 1 and j1 - j0 == 1)
    return ones[len(ones) // 2] if len(ones) >= 3 else first


def align_items(a: list[Item], b: list[Item], ratio: float | None = None) -> list[tuple[int, int, int, int]]:
    """Cheapest path through the two sequences: ranges (i0, i1, j0, j1), half-open, in order. Cells further
    from the diagonal than a band are not visited, so very long texts stay fast."""
    n, m = len(a), len(b)
    if not n and not m:
        return []
    ratio = ratio or _ratio(a, b)
    band = max(25, int(0.15 * max(n, m)))
    inf = float("inf")
    best: list[dict[int, tuple[float, int]]] = [{} for _ in range(n + 1)]
    best[0][0] = (0.0, -1)
    for i in range(n + 1):
        centre = int(i * m / n) if n else 0
        for j in range(max(0, centre - band), min(m, centre + band) + 1):
            if i == 0 and j == 0:
                continue
            top, choice = inf, -1
            for k, (di, dj, prior) in enumerate(_MOVES):
                pi, pj = i - di, j - dj
                if pi < 0 or pj < 0 or pj not in best[pi]:
                    continue
                total = best[pi][pj][0] + _cost(a[pi:i], b[pj:j], ratio, prior)
                if total < top:
                    top, choice = total, k
            if choice >= 0:
                best[i][j] = (top, choice)
    if m not in best[n]:                     # cannot happen with a band wider than |n - m| / 2; be safe
        return [(0, n, 0, m)]
    out, i, j = [], n, m
    while i or j:
        di, dj, _ = _MOVES[best[i][j][1]]
        out.append((i - di, i, j - dj, j))
        i, j = i - di, j - dj
    return out[::-1]


def _links(a: list[Item], b: list[Item], ratio: float | None = None) -> list[Link]:
    ratio = ratio or estimate_ratio(a, b)
    out = []
    for i0, i1, j0, j1 in align_items(a, b):
        x, y = a[i0:i1], b[j0:j1]
        conf = _confidence(x, y, ratio)
        out.append(Link([i.text for i in x], [i.text for i in y], conf, conf < LOW_CONFIDENCE))
    return out


# --------------------------------------------------------------------------- splitting
def split_sentences(text: str, lang: str) -> list[list[str]]:
    """Paragraphs (the non-empty lines of `text`) as lists of sentences."""
    paragraphs = [p.strip() for p in text.splitlines() if p.strip()]
    model = nlp.load_model(lang)
    skip = [n for n in ("lemmatizer", "morphologizer", "tagger", "attribute_ruler") if n in model.pipe_names]
    out = []
    for doc in model.pipe(paragraphs, batch_size=64, disable=skip):
        sents = [clean_segment(s.text) for s in doc.sents]
        sents = [s for s in sents if s]
        if sents:
            out.append(sents)
    return out


def align_paragraphs(src: list[list[str]], tgt: list[list[str]]) -> list[Link]:
    """Links between the sentences of two documents given as paragraphs of sentences."""
    flat_a = [Item.of(s) for p in src for s in p]
    flat_b = [Item.of(s) for p in tgt for s in p]
    if not flat_a or not flat_b:
        return [Link([i.text], []) for i in flat_a] + [Link([], [i.text]) for i in flat_b]
    pa = [Item.of(" ".join(p)) for p in src]
    pb = [Item.of(" ".join(p)) for p in tgt]
    ratio = estimate_ratio(pa, pb)
    blocks = align_items(pa, pb, ratio)
    clean = sum(1 for i0, i1, j0, j1 in blocks if (i1 - i0, j1 - j0) == (1, 1))
    if len(blocks) == 0 or clean / len(blocks) < _PARA_FALLBACK:
        return _links(flat_a, flat_b)
    links: list[Link] = []
    for i0, i1, j0, j1 in blocks:
        a = [Item.of(s) for p in src[i0:i1] for s in p]
        b = [Item.of(s) for p in tgt[j0:j1] for s in p]
        if a and b:
            links += _links(a, b, ratio)
        else:
            links += [Link([i.text], []) for i in a] + [Link([], [i.text]) for i in b]
    return links


def propose(src_text: str, tgt_text: str, src_lang: str, tgt_lang: str) -> list[Link]:
    return align_paragraphs(split_sentences(src_text, src_lang), split_sentences(tgt_text, tgt_lang))


# --------------------------------------------------------------------------- report and confirmation
def report(types: list[str], low: list[bool]) -> dict:
    """Counts by link type and the share of low-confidence links."""
    by_type = {t: types.count(t) for t in LINK_TYPES}
    other = len(types) - sum(by_type.values())
    if other:
        by_type["other"] = other
    n = len(types)
    n_low = sum(1 for x in low if x)
    return {"links": n, "by_type": by_type, "low": n_low, "low_share": round(n_low / n, 3) if n else 0.0}


def links_report(links: list[Link]) -> dict:
    return report([lk.type for lk in links], [lk.low for lk in links])


def confirm_pairs(links: list[tuple[list[str], list[str], bool]]) -> tuple[list[Pair], dict]:
    """Reviewed links (source sentences, target sentences, low confidence) -> storable pairs and a report.

    The report counts every link given; `stored` is what becomes a segment pair, `dropped` the units with an
    empty side or a segment that is too long.
    """
    pairs: list[Pair] = []
    types, low = [], []
    dropped = 0
    for src, tgt, is_low in links:
        types.append(f"{len(src)}:{len(tgt)}")
        low.append(is_low)
        a, b = clean_segment(" ".join(src)), clean_segment(" ".join(tgt))
        if a and b and len(a) <= MAX_SEGMENT_CHARS and len(b) <= MAX_SEGMENT_CHARS:
            pairs.append((a, b))
        else:
            dropped += 1
    rep = report(types, low)
    rep.update(stored=len(pairs), dropped=dropped)
    return pairs, rep
