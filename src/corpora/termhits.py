"""Termbase hits inside running text: which words of a segment belong to a termbase entry of the project.

Matching is done on the server and reported as character offsets into the text the interface displays (the same
mechanism as `source_marks` / `target_marks` in `parallel`). A term matches by exact word forms or by lemmas,
single or multi-word, so inflected forms (*contratti* for *contratto*) and phrases are found. Two roles, by the
language of the text being marked:

  * the text is in the entry's source language: its source term is a hit (`term`); the approved translations
    and the forbidden ones are carried along for the tooltip;
  * the text is in the entry's target language: a `forbidden` translation is flagged (`forbidden`, with the
    approved alternatives), an `approved` translation is a hit (`term`).

The lemmatised termbase is cached per project and language, and every term text is lemmatised once.
"""
from collections import defaultdict

from . import nlp

_LEMMAS: dict[tuple[str, str], tuple[tuple, tuple]] = {}      # (lang, normalised term) -> (forms, lemmas)
_INDEX: dict[tuple, tuple[int, dict, int]] = {}               # (project, lang) -> (fingerprint, index, longest)
_MAX_CACHED_TERMS = 100_000
MAX_CHECK_CHARS = 20_000


def _lemmatise(terms: list[str], lang: str) -> None:
    """Fill the lemma cache for the terms not seen yet, in one pass of the pipeline."""
    todo = sorted({k for k in (" ".join(t.lower().split()) for t in terms) if k and (lang, k) not in _LEMMAS})
    if not todo:
        return
    if len(_LEMMAS) > _MAX_CACHED_TERMS:
        _LEMMAS.clear()
    spans: list[tuple[int, int]] = []
    toks = list(nlp.annotate("\n".join(todo), lang, None, spans))
    for term, (a, b) in zip(todo, spans, strict=True):
        _LEMMAS[(lang, term)] = (tuple(t[3] for t in toks[a:b]), tuple(t[4] for t in toks[a:b]))


def _index(conn, project_id: int | None, lang: str) -> tuple[dict, int]:
    """token tuple -> [(entry, role)] for the entries of this project (and the general termbase) that can be
    matched in a text of `lang`, plus the longest key. Rebuilt only when the termbase changed."""
    rows = [dict(r) for r in conn.execute(
        """SELECT id, src_term, tgt_term, status, src_lang, tgt_lang FROM terms
           WHERE (project_id IS NULL OR project_id IS ?) AND (src_lang=? OR tgt_lang=?) AND deleted_at IS NULL
           ORDER BY id""",
        (project_id, lang, lang))]
    fingerprint = hash(tuple(tuple(r.values()) for r in rows))
    cached = _INDEX.get((project_id, lang))
    if cached and cached[0] == fingerprint:
        return cached[1], cached[2]
    # the approved / forbidden translations of each source term (per language pair)
    approved: dict[tuple, list[str]] = defaultdict(list)
    forbidden: dict[tuple, list[str]] = defaultdict(list)
    for r in rows:
        key = (r["src_lang"], r["tgt_lang"], r["src_term"].lower())
        if r["tgt_term"] and r["status"] == "approved" and r["tgt_term"] not in approved[key]:
            approved[key].append(r["tgt_term"])
        if r["tgt_term"] and r["status"] == "forbidden" and r["tgt_term"] not in forbidden[key]:
            forbidden[key].append(r["tgt_term"])
    _lemmatise([r["src_term"] for r in rows if r["src_lang"] == lang]
               + [r["tgt_term"] for r in rows if r["tgt_lang"] == lang and r["status"] in ("approved", "forbidden")],
               lang)
    index: dict[tuple, list[dict]] = defaultdict(list)

    def add(text: str, info: dict) -> None:
        got = _LEMMAS.get((lang, " ".join(text.lower().split())))
        if not got:
            return
        for key in {got[0], got[1]}:
            if key:
                index[key].append(info)

    for r in rows:
        pair = (r["src_lang"], r["tgt_lang"], r["src_term"].lower())
        if r["src_lang"] == lang:
            add(r["src_term"], {"id": r["id"], "kind": "term", "term": r["src_term"], "of": "",
                                "translations": approved[pair], "forbidden": forbidden[pair]})
        if r["tgt_lang"] == lang and r["tgt_term"] and r["status"] in ("approved", "forbidden"):
            add(r["tgt_term"], {"id": r["id"], "kind": "forbidden" if r["status"] == "forbidden" else "term",
                                "term": r["tgt_term"], "of": r["src_term"],
                                "translations": approved[pair] if r["status"] == "forbidden" else [],
                                "forbidden": []})
    longest = max((len(k) for k in index), default=0)
    _INDEX[(project_id, lang)] = (fingerprint, dict(index), longest)
    return dict(index), longest


def find(conn, project_id: int | None, lang: str, toks: list[dict]) -> list[dict]:
    """Termbase hits among `toks` (dicts with `form`, `lemma`, `s`, `e`): [{start, end, kind, term, of,
    translations, forbidden, ids}], sorted, not overlapping. The longest match wins; hits on exactly the same
    words (a term that is a source term of one entry and a forbidden translation of another) are merged."""
    index, longest = _index(conn, project_id, lang)
    if not index or not toks:
        return []
    norms = [t["form"].lower() for t in toks]
    lemmas = [t["lemma"].lower() for t in toks]
    found: list[tuple[int, int, list[dict]]] = []
    for n in range(min(longest, len(toks)), 0, -1):
        for i in range(len(toks) - n + 1):
            by_form = index.get(tuple(norms[i:i + n]), ())
            by_id = {e["id"]: e for e in (*by_form, *index.get(tuple(lemmas[i:i + n]), ()))}
            if by_id:
                found.append((i, i + n - 1, list(by_id.values())))
    taken: set[int] = set()
    out: list[dict] = []
    for a, b, infos in found:                     # longest first (the loop above runs from long to short)
        idx = set(range(a, b + 1))
        if idx & taken:
            continue
        taken |= idx
        flagged = [e for e in infos if e["kind"] == "forbidden"]
        first = (flagged or infos)[0]
        out.append({
            "start": toks[a]["s"], "end": toks[b]["e"], "kind": "forbidden" if flagged else "term",
            "term": first["term"], "of": first["of"],
            "translations": list(dict.fromkeys(t for e in infos for t in e["translations"])),
            "forbidden": list(dict.fromkeys(t for e in infos for t in e["forbidden"])),
            "ids": [e["id"] for e in infos],
        })
    out.sort(key=lambda m: m["start"])
    return out


def layout(rows) -> tuple[str, list[dict]]:
    """Text of token rows (`form`, `lemma`, `sp`) as the interface shows it, and each token's [s, e) offsets."""
    raw, toks = "", []
    for r in rows:
        toks.append({"form": r["form"], "lemma": r["lemma"], "s": len(raw), "e": len(raw) + len(r["form"])})
        raw += r["form"] + (" " if r["sp"] else "")
    lead = len(raw) - len(raw.lstrip())
    text = raw.strip()
    for t in toks:
        t["s"] = min(max(t["s"] - lead, 0), len(text))
        t["e"] = min(max(t["e"] - lead, 0), len(text))
    return text, toks


def mark_kwic(conn, corpus_id: int, lines: list[dict], width: int) -> None:
    """Add `left_terms`, `node_terms`, `right_terms` (offsets into `left`, `node`, `right`) to KWIC lines.
    A term crossing from the context into the node is marked on both sides."""
    c = conn.execute("SELECT lang, project_id FROM corpora WHERE id=?", (corpus_id,)).fetchone()
    for ln in lines:
        ln["left_terms"] = ln["node_terms"] = ln["right_terms"] = []
    if not c or not lines or not _index(conn, c["project_id"], c["lang"])[0]:
        return
    for ln in lines:
        last = ln["pos"] + ln["span"] - 1
        rows = conn.execute("SELECT pos, form, lemma, sp FROM tokens WHERE doc_id=? AND pos BETWEEN ? AND ? "
                            "ORDER BY pos", (ln["doc_id"], ln["pos"] - width, last + width)).fetchall()
        parts = {"left": [r for r in rows if r["pos"] < ln["pos"]],
                 "node": [r for r in rows if ln["pos"] <= r["pos"] < ln["pos"] + ln["span"]],
                 "right": [r for r in rows if r["pos"] >= ln["pos"] + ln["span"]]}
        _, toks = layout(rows)
        hits = find(conn, c["project_id"], c["lang"], toks)
        # character range of each part inside the whole text, to cut the hits into the three columns
        at, bounds = 0, {}
        for name, part in parts.items():
            if part:
                bounds[name] = (toks[at]["s"], toks[at + len(part) - 1]["e"])
            at += len(part)
        for name, (lo, hi) in bounds.items():
            ln[f"{name}_terms"] = [{**h, "start": max(h["start"], lo) - lo, "end": min(h["end"], hi) - lo}
                                   for h in hits if h["start"] < hi and h["end"] > lo]


def check(conn, project_id: int | None, lang: str, text: str) -> dict:
    """Mark termbase hits and forbidden translations in a pasted text of language `lang`, line by line."""
    lines: list[dict] = []
    for raw in text.splitlines():
        if not raw.strip():
            continue
        spans: list[tuple[int, int]] = []
        toks = list(nlp.annotate(raw, lang, None, spans))
        shown, tokens = layout([{"form": t[2], "lemma": t[4], "sp": t[8]} for t in toks])
        lines.append({"text": shown, "marks": find(conn, project_id, lang, tokens)})
    marks = [m for ln in lines for m in ln["marks"]]
    return {"lang": lang, "lines": lines,
            "summary": {"hits": sum(m["kind"] == "term" for m in marks),
                        "forbidden": sum(m["kind"] == "forbidden" for m in marks)}}
