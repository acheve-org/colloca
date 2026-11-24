"""Segment lookup with match percentages (T18): find the aligned source segments most like a given segment.

The usual translation-memory idea: paste a segment, get the stored source segments that resemble it, each with a
percentage, its aligned translation and what differs. Candidates come from the token index (segments that share
words with the query, the rarest words first in effect because shared counts rank them), and each candidate is
scored by a token-level edit distance. It is a lookup aid over the corpora in Colloca, not a replacement for the
memory in your CAT tool: tags are ignored, numbers are ordinary words (and flagged when they are the only
difference), and the percentage is not comparable to a CAT tool's own."""
import re
from collections import Counter
from dataclasses import dataclass, replace
from difflib import SequenceMatcher

from . import analysis, nlp

MAX_QUERY_CHARS = 2000
CANDIDATES = 400                       # segments scored per query
BANDS = ((100, "100"), (95, "95-99"), (85, "85-94"), (75, "75-84"), (0, "below75"))
_TAG = re.compile(r"</?[A-Za-z][^<>]{0,80}>|\{\d+\}|\[\d+\]|%\d*[sd]")     # inline codes and placeholders
_NUMBER = re.compile(r"\d")


@dataclass
class Tok:
    form: str
    norm: str
    content: bool          # a word or a number (punctuation is shown but never compared)
    stop: bool
    space: bool


def band(percent: int) -> str:
    return next(name for floor, name in BANDS if percent >= floor)


def clean_query(text: str) -> str:
    """The segment without inline tags and placeholders, on one line."""
    return " ".join(_TAG.sub(" ", text or "").split())


def query_tokens(text: str, lang: str) -> list[Tok]:
    out = []
    for _pos, _sent, form, norm, _lemma, _upos, alpha, stop, sp in nlp.annotate(clean_query(text), lang):
        out.append(Tok(form, norm, bool(alpha) or bool(_NUMBER.search(norm)), bool(stop), bool(sp)))
    return out


def edit_distance(a: list[str], b: list[str], cutoff: int | None = None) -> int:
    """Levenshtein distance between two token lists; None as soon as it must exceed `cutoff`."""
    if abs(len(a) - len(b)) > (cutoff if cutoff is not None else len(a) + len(b)):
        return len(a) + len(b) + 1
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        if cutoff is not None and min(cur) > cutoff:
            return len(a) + len(b) + 1
        prev = cur
    return prev[-1]


def percent(a: list[str], b: list[str], floor: int = 0) -> int:
    """Match percentage of two token lists: 100 only when identical, otherwise the share not changed, rounded
    down. Below `floor` the exact value does not matter: 0 is returned early."""
    longest = max(len(a), len(b))
    if longest == 0:
        return 0
    cutoff = int(longest * (100 - floor) / 100)
    d = edit_distance(a, b, cutoff)
    if d > cutoff:
        return 0
    return int(100 * (longest - d) / longest)


def _candidates(conn, scope, words: list[str], length: int) -> list:
    where, params = scope.where("d")
    marks = ",".join("?" * len(words))
    return conn.execute(
        f"""SELECT t.doc_id, s.seg, s.start_pos, s.end_pos, COUNT(DISTINCT t.norm) AS shared
            FROM tokens t JOIN documents d ON d.id=t.doc_id
            JOIN segments s ON s.doc_id=t.doc_id AND t.pos>=s.start_pos AND t.pos<s.end_pos
            WHERE {where} AND t.norm IN ({marks})
            GROUP BY t.doc_id, s.seg
            ORDER BY shared DESC, ABS((s.end_pos - s.start_pos) - ?) ASC
            LIMIT ?""", [*params, *words, length, CANDIDATES]).fetchall()


def _segment(conn, doc_id: int, start: int, end: int) -> list[Tok]:
    return [Tok(r["form"], r["norm"], bool(r["alpha"]) or bool(_NUMBER.search(r["norm"])), bool(r["stop"]),
                bool(r["sp"])) for r in conn.execute(
        "SELECT form, norm, alpha, stop, sp FROM tokens WHERE doc_id=? AND pos>=? AND pos<? ORDER BY pos",
        (doc_id, start, end))]


def _text(toks: list[Tok]) -> str:
    return "".join(t.form + (" " if t.space else "") for t in toks).strip()


def diff(query: list[Tok], found: list[Tok]) -> list[dict]:
    """The found segment word by word: `same`; `extra` (in the found segment, not in the query); and, in place,
    `missing` (in the query, not in the found segment). Punctuation is always `same`. Each word says whether a space
    follows it (`sp`), so the segment can be written out as it was."""
    qc = [t for t in query if t.content]
    fc = [t for t in found if t.content]
    ops = SequenceMatcher(None, [t.norm for t in qc], [t.norm for t in fc], autojunk=False).get_opcodes()
    kind = {}                                            # index among the found content tokens -> kind
    missing_before: dict[int, list[Tok]] = {}
    for tag, i1, i2, j1, j2 in ops:
        if tag in ("replace", "insert"):                 # words only the found segment has
            for j in range(j1, j2):
                kind[j] = "extra"
        if tag in ("replace", "delete"):                 # words only the query has
            missing_before.setdefault(j1, []).extend(qc[i1:i2])
    out: list[dict] = []
    j = 0
    for t in found:
        if t.content:
            for m in missing_before.pop(j, []):
                out.append({"text": m.form, "kind": "missing", "sp": True})
            out.append({"text": t.form, "kind": kind.get(j, "same"), "sp": t.space})
            j += 1
        else:
            out.append({"text": t.form, "kind": "same", "sp": t.space})
    for rest in missing_before.values():
        out.extend({"text": m.form, "kind": "missing", "sp": True} for m in rest)
    return out


def lookup(conn, scope, lang: str, text: str, min_percent: int = 50, limit: int = 10) -> dict:
    """The stored source segments most like `text`, best first: percent, band, the aligned translation and the
    word-level difference. Only aligned documents (with a live partner) of `scope` are searched."""
    scope = replace(analysis.as_scope(scope), paired_only=True)
    if len(text) > MAX_QUERY_CHARS:
        raise ValueError(f"The segment is longer than {MAX_QUERY_CHARS} characters; paste one segment at a time")
    query = query_tokens(text, lang)
    content = [t for t in query if t.content]
    if not content:
        raise ValueError("The segment has no words to look up")
    words = list({t.norm for t in content if not t.stop}) or list({t.norm for t in content})
    q_norm = [t.norm for t in content]
    q_numbers = Counter(t.norm for t in content if _NUMBER.search(t.norm))
    live = analysis.PARTNER_LIVE.format(a="d")
    titles: dict[int, tuple[str, int | None]] = {}
    matches = []
    for c in _candidates(conn, scope, words, len(content)):
        found = _segment(conn, c["doc_id"], c["start_pos"], c["end_pos"])
        f_content = [t for t in found if t.content]
        pct = percent(q_norm, [t.norm for t in f_content], min_percent)
        if pct < min_percent:
            continue
        if c["doc_id"] not in titles:
            row = conn.execute(f"SELECT d.title, d.pair_doc_id FROM documents d WHERE d.id=? AND {live}",
                               (c["doc_id"],)).fetchone()
            titles[c["doc_id"]] = (row["title"], row["pair_doc_id"]) if row else ("", None)
        title, partner = titles[c["doc_id"]]
        if partner is None:
            continue
        span = conn.execute("SELECT start_pos, end_pos FROM segments WHERE doc_id=? AND seg=?",
                            (partner, c["seg"])).fetchone()
        target = _text(_segment(conn, partner, span["start_pos"], span["end_pos"])) if span else ""
        numbers_differ = q_numbers != Counter(t.norm for t in f_content if _NUMBER.search(t.norm))
        only_numbers = numbers_differ and [t.norm for t in f_content if not _NUMBER.search(t.norm)] == \
            [n for n in q_norm if not _NUMBER.search(n)]
        matches.append({
            "doc_id": c["doc_id"], "doc": title, "seg": c["seg"], "pos": c["start_pos"],
            "span": max(c["end_pos"] - c["start_pos"], 1), "percent": pct, "band": band(pct),
            "exact": " ".join(_text(found).split()) == " ".join(text.split()),
            "numbers_differ": numbers_differ, "only_numbers_differ": only_numbers,
            "source": _text(found), "target": target, "diff": diff(query, found)})
    matches.sort(key=lambda m: (-m["percent"], not m["exact"], m["doc_id"], m["seg"]))
    # the same source text stored twice (two documents) is shown once, the first one
    seen, unique = set(), []
    for m in matches:
        key = (m["source"], m["target"])
        if key not in seen:
            seen.add(key)
            unique.append(m)
    return {"query_words": len(content), "matches": unique[:limit], "found": len(unique)}


def leverage(conn, scope, lang: str, sentences: list[str], min_percent: int = 75) -> dict:
    """How much of a text the aligned corpus already translates: each sentence by its best match, counted in
    the usual bands and weighted by words. A rough figure for planning, not a quote."""
    counts = {name: {"segments": 0, "words": 0} for _, name in BANDS}
    total_words = 0
    for text in sentences:
        try:
            toks = [t for t in query_tokens(text, lang) if t.content]
        except ValueError:
            continue
        if not toks:
            continue
        total_words += len(toks)
        try:
            res = lookup(conn, scope, lang, text, min_percent=min_percent, limit=1)
        except ValueError:
            res = {"matches": []}
        name = res["matches"][0]["band"] if res["matches"] else "below75"
        counts[name]["segments"] += 1
        counts[name]["words"] += len(toks)
    covered = sum(counts[n]["words"] for _, n in BANDS if n != "below75")
    return {"segments": sum(c["segments"] for c in counts.values()), "words": total_words, "bands": counts,
            "covered_pct": round(100 * covered / total_words, 1) if total_words else 0.0}
