"""Near-duplicate detection: a bottom-k MinHash sketch of each document's word shingles.

A document is reduced to its set of overlapping 5-word shingles (lower-cased words, so case, punctuation and
whitespace do not matter). Each shingle is hashed to 64 bits and the SK smallest distinct hashes are kept as the
document's *sketch* (stored sorted, as a BLOB of little-endian uint64, in `documents.fingerprint`). The Jaccard
similarity of two shingle sets (shared shingles / all distinct shingles) is estimated from the sketches alone:
take the SK smallest values of the union of both sketches and count how many are in both. Texts with fewer than
SK shingles keep every hash, so for them the estimate is exact.

Cost is linear in the text (one pass, no per-shingle Python hashing beyond the distinct words) and a sketch is
at most 2 KB, so checking an import against a corpus reads the sketches only, never the texts.
"""
import os
import re
from hashlib import blake2b
from typing import Any

import numpy as np

SHINGLE = 5            # words per shingle
SK = 256               # sketch size (values kept per document)
THRESHOLD = min(max(float(os.environ.get("NEAR_DUP_THRESHOLD", "0.85")), 0.5), 1.0)   # default similarity to flag
_WORD = re.compile(r"\w+")
_MASK = (1 << 64) - 1
_MULTS = np.array([0x9E3779B97F4A7C15, 0xC2B2AE3D27D4EB4F, 0x165667B19E3779F9, 0x27D4EB2F165667C5,
                   0xFF51AFD7ED558CCD], dtype=np.uint64)[:SHINGLE]
_word_hash: dict[str, int] = {}


def _hash_word(word: str) -> int:
    h = _word_hash.get(word)
    if h is None:
        if len(_word_hash) > 500_000:
            _word_hash.clear()
        h = _word_hash[word] = int.from_bytes(blake2b(word.encode(), digest_size=8).digest(), "little")
    return h


def sketch(text: str) -> bytes:
    """The sorted bottom-SK shingle hashes of a text, packed (empty for a text with no words)."""
    words = _WORD.findall(text.casefold())
    if not words:
        return b""
    w = np.fromiter((_hash_word(x) for x in words), dtype=np.uint64, count=len(words))
    if len(w) < SHINGLE:
        w = np.concatenate([w, np.zeros(SHINGLE - len(w), dtype=np.uint64)])
    n = len(w) - SHINGLE + 1
    with np.errstate(over="ignore"):
        h = np.zeros(n, dtype=np.uint64)
        for j in range(SHINGLE):
            h += w[j:j + n] * _MULTS[j]            # position-dependent mix, wraps mod 2**64
        h ^= h >> np.uint64(29)
        h *= np.uint64(0xBF58476D1CE4E5B9)
        h ^= h >> np.uint64(32)
    h = np.unique(h)
    if len(h) > SK:
        h = np.sort(np.partition(h, SK)[:SK])
    return h.astype("<u8").tobytes()


def _arr(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype="<u8")


def similarity(a: bytes, b: bytes) -> float:
    """Estimated Jaccard similarity (0..1) of two sketches."""
    x, y = _arr(a), _arr(b)
    if not len(x) or not len(y):
        return 0.0
    union = np.union1d(x, y)[:SK]
    both = np.intersect1d(x, y)
    return float(np.count_nonzero(np.isin(union, both, assume_unique=True))) / len(union)


def find_similar(new: bytes, known: list[tuple[int, bytes]], threshold: float) -> list[tuple[int, float]]:
    """(doc id, similarity) of the stored sketches at or above `threshold`, most similar first.
    A cheap pass over all sketches at once discards the clearly unrelated before the exact estimate."""
    if not known or not new:
        return []
    x = _arr(new)
    ids = np.concatenate([np.full(len(_arr(b)), i, dtype=np.int64) for i, (_, b) in enumerate(known)])
    values = np.concatenate([_arr(b) for _, b in known])
    shared = np.bincount(ids[np.isin(values, x)], minlength=len(known))
    need = max(1.0, 0.4 * threshold * min(len(x), SK))
    out: list[tuple[int, float]] = []
    for i in np.nonzero(shared >= need)[0]:
        s = similarity(new, known[i][1])
        if s >= threshold:
            out.append((known[i][0], s))
    return sorted(out, key=lambda t: -t[1])


def ensure_fingerprints(conn, corpus_id: int) -> int:
    """Fingerprint the documents that have none (added before migration v9). Returns how many were computed."""
    rows = conn.execute("""SELECT id, text FROM documents WHERE corpus_id=? AND fingerprint IS NULL""",
                        (corpus_id,)).fetchall()
    conn.executemany("UPDATE documents SET fingerprint=? WHERE id=?", ((sketch(r["text"]), r["id"]) for r in rows))
    return len(rows)


def exempt(kind: str, segmented: bool) -> bool:
    """Reference-corpus sentence files and aligned (segmented) texts are not compared."""
    return kind == "sentences" or segmented


# --------------------------------------------------------------------------- what overlaps
_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def _units(text: str) -> list[str]:
    lines = text.split("\n")
    return lines if len(lines) > 1 else [s for s in _SENTENCE.split(text) if s]


def _key(unit: str) -> str:
    return " ".join(_WORD.findall(unit.casefold()))


def overlap(new_text: str, old_text: str, examples: int = 3, width: int = 160) -> dict:
    """How the new text relates to an older one, by paragraph (sentence if there is one paragraph):
    how many of its paragraphs the older text has, and a few that are new or changed."""
    new_units = [u for u in _units(new_text) if _key(u)]
    old_keys = {_key(u) for u in _units(old_text)}
    changed = [u for u in new_units if _key(u) not in old_keys]
    shared = len(new_units) - len(changed)
    return {"units": len(new_units), "shared_units": shared,
            "changed": [u if len(u) <= width else u[:width].rstrip() + "…" for u in changed[:examples]]}


# --------------------------------------------------------------------------- report on an existing corpus
HOT = 200   # a sketch value found in more documents than this (boilerplate) no longer proposes pairs


def report(conn, corpus_id: int, threshold: float) -> dict:
    """Every pair of documents in a corpus similar to at least `threshold`, most similar first."""
    from collections import Counter
    computed = ensure_fingerprints(conn, corpus_id)
    docs = conn.execute("""SELECT id, title, source, added, n_tokens, fingerprint FROM documents
                           WHERE corpus_id=? AND deleted_at IS NULL AND segmented=0 AND kind<>'sentences'
                             AND fingerprint IS NOT NULL
                           ORDER BY id""", (corpus_id,)).fetchall()
    sketches = [_arr(d["fingerprint"]) for d in docs]
    if sketches:
        owner = np.concatenate([np.full(len(s), i, dtype=np.int64) for i, s in enumerate(sketches)])
        values = np.concatenate(sketches)
        order = np.argsort(values, kind="stable")
        values, owner = values[order], owner[order]
        starts = np.flatnonzero(np.r_[True, values[1:] != values[:-1]])
        ends = np.r_[starts[1:], len(values)]
    else:
        starts = ends = np.array([], dtype=np.int64)
    counts: Counter[tuple[int, int]] = Counter()
    for a, b in zip(starts, ends, strict=True):
        if 1 < b - a <= HOT:
            members = sorted(owner[a:b].tolist())
            for i, x in enumerate(members):
                for y in members[i + 1:]:
                    counts[(x, y)] += 1
    pairs: list[dict[str, Any]] = []
    for (x, y), shared in counts.items():
        if shared < max(1.0, 0.4 * threshold * min(len(sketches[x]), len(sketches[y]))):
            continue
        s = similarity(docs[x]["fingerprint"], docs[y]["fingerprint"])
        if s >= threshold:
            pairs.append({"a": _brief(docs[x]), "b": _brief(docs[y]), "similarity": round(s, 3)})
    pairs.sort(key=lambda p: -p["similarity"])
    return {"threshold": threshold, "documents": len(docs), "fingerprinted_now": computed, "pairs": pairs}


def _brief(row) -> dict:
    return {k: row[k] for k in ("id", "title", "source", "added", "n_tokens")}
