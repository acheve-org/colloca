"""Parallel (aligned) texts: reading TMX / XLIFF / two-column files into segment pairs, importing them as a
pair of documents, and searching them side by side.

Storage (see db migration v6): the source and the target text are ordinary documents in ordinary corpora of
their own language, stored one segment per line, linked through `documents.pair_doc_id`; segment N of one is
the translation of segment N of the other. Everything the monolingual tools do keeps working on each side.
"""
import csv
import io
import math
import os
import re
from collections import Counter
from dataclasses import replace

from defusedxml import DefusedXmlException
from defusedxml import ElementTree as SafeET

from . import analysis, db, formats, importer, ingest, termhits

PAIRS_PER_DOC = 5000              # translation units per stored document pair
MAX_SEGMENT_CHARS = 3000          # longer segments are skipped (they are paragraphs, not translation units)
_XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
_INLINE_CODE = {"bpt", "ept", "ph", "it", "ut", "sub"}      # TMX inline markup whose content is formatting, not text
_HEADER_CELL = re.compile(r"^(source|target|origen|destino|fonte|origine|destinazione|spanish|italian|español|"
                          r"espanol|italiano|castellano|[a-z]{2}([-_][a-z]{2,4})?)$", re.I)

Pair = tuple[str, str]


def clean_segment(text: str) -> str:
    """One line, single spaces. (`split()` also removes every character `splitlines()` would break on.)"""
    return " ".join(str(text or "").split())


def lang_matches(code: str, lang: str) -> bool:
    return (code or "").lower().replace("_", "-").split("-")[0] == lang


# --------------------------------------------------------------------------- readers
def _seg_text(el) -> str:
    parts = [el.text or ""]
    for child in el:
        if child.tag not in _INLINE_CODE:
            parts.append(_seg_text(child))
        parts.append(child.tail or "")
    return "".join(parts)


def read_tmx(data: bytes, lang_a: str, lang_b: str) -> tuple[list[Pair], int]:
    """(pairs as (lang_a text, lang_b text), number of translation units skipped)."""
    pairs: list[Pair] = []
    skipped = 0
    try:
        for _, el in SafeET.iterparse(io.BytesIO(data), events=("end",)):
            if el.tag != "tu":
                continue
            texts: dict[str, str] = {}
            for tuv in el.findall("tuv"):
                code = tuv.get(_XML_LANG) or tuv.get("lang") or ""
                seg = tuv.find("seg")
                for lang in (lang_a, lang_b):
                    if lang not in texts and lang_matches(code, lang) and seg is not None:
                        texts[lang] = clean_segment(_seg_text(seg))
            el.clear()
            a, b = texts.get(lang_a, ""), texts.get(lang_b, "")
            if a and b and len(a) <= MAX_SEGMENT_CHARS and len(b) <= MAX_SEGMENT_CHARS:
                pairs.append((a, b))
            else:
                skipped += 1
    except (SafeET.ParseError, DefusedXmlException) as exc:
        raise ingest.IngestError(f"Not a readable TMX file: {exc}") from exc
    return pairs, skipped


def _is_header(a: str, b: str) -> bool:
    return bool(_HEADER_CELL.match(a.strip()) and _HEADER_CELL.match(b.strip()))


def _finish(rows: list[Pair], swap: bool) -> tuple[list[Pair], int]:
    pairs, skipped = [], 0
    for n, (a, b) in enumerate(rows):
        a, b = clean_segment(a), clean_segment(b)
        if n == 0 and _is_header(a, b):
            continue
        if swap:
            a, b = b, a
        if a and b and len(a) <= MAX_SEGMENT_CHARS and len(b) <= MAX_SEGMENT_CHARS:
            pairs.append((a, b))
        else:
            skipped += 1
    return pairs, skipped


def read_delimited(data: bytes, swap: bool = False) -> tuple[list[Pair], int]:
    """Two columns (source, target) separated by tab, semicolon or comma; a header row is skipped."""
    text = ingest.decode_bytes(data)
    sample = "\n".join(text.splitlines()[:20])
    delim = max("\t;,", key=sample.count)
    if sample.count(delim) == 0:
        raise ingest.IngestError("No second column found (use tab, semicolon or comma separated columns)")
    rows = [(r[0], r[1]) for r in csv.reader(io.StringIO(text), delimiter=delim) if len(r) >= 2]
    return _finish(rows, swap)


def read_docx_table(data: bytes, swap: bool = False) -> tuple[list[Pair], int]:
    """Rows of every table with two or more columns: first column = source, second = target."""
    from docx import Document
    doc = Document(io.BytesIO(data))
    rows = [(r.cells[0].text, r.cells[1].text) for t in doc.tables for r in t.rows if len(r.cells) >= 2]
    if not rows:
        raise ingest.IngestError("The document has no table with two columns (source | target)")
    return _finish(rows, swap)


def read_xliff_pairs(data: bytes, lang_a: str, lang_b: str, swap: bool = False) -> tuple[list[Pair], int]:
    """Translated units of an XLIFF 1.2/2.x, oriented (lang_a, lang_b) by the file's language codes (by
    source/target order, flipped by `swap`, when the codes are missing or do not match the corpora)."""
    doc = formats.read_xliff(data)
    pairs = [(clean_segment(s), clean_segment(t)) for s, t in doc.pairs]
    if lang_matches(doc.source_lang, lang_b) and lang_matches(doc.target_lang, lang_a):
        swap = True
    elif lang_matches(doc.source_lang, lang_a) and lang_matches(doc.target_lang, lang_b):
        swap = False
    kept = [(a, b) for a, b in pairs if len(a) <= MAX_SEGMENT_CHARS and len(b) <= MAX_SEGMENT_CHARS]
    return [(b, a) if swap else (a, b) for a, b in kept], doc.skipped + len(pairs) - len(kept)


def read_pairs(filename: str, data: bytes, lang_a: str, lang_b: str, swap: bool = False) -> tuple[list[Pair], int]:
    """Segment pairs from a file, oriented (lang_a, lang_b). TMX is oriented by its language codes;
    two-column files by column order (`swap` flips it)."""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext == "tmx":
        pairs, skipped = read_tmx(data, lang_a, lang_b)
    elif ext in ("xlf", "xliff"):
        pairs, skipped = read_xliff_pairs(data, lang_a, lang_b, swap)
    elif ext in ("tsv", "csv", "txt"):
        pairs, skipped = read_delimited(data, swap)
    elif ext == "docx":
        pairs, skipped = read_docx_table(data, swap)
    else:
        raise ingest.IngestError(f"Unsupported file type '.{ext}' for aligned texts "
                                 "(use .tmx, .xlf/.xliff, .tsv, .csv or a .docx table)")
    if not pairs:
        raise ingest.IngestError("No usable translation units found"
                                 + (" for this language pair" if ext == "tmx" else ""))
    return pairs, skipped


# --------------------------------------------------------------------------- import
def import_pairs(corpus_id: int, partner_id: int, filename: str, data: bytes, swap: bool, meta: dict,
                 force_language: bool):
    """Job body: read an aligned file and store it as linked document pairs (`corpus_id` receives the first
    texts, `partner_id` the second). Large files are split into parts of PAIRS_PER_DOC translation units."""
    stem = filename.rsplit(".", 1)[0]

    def work(job) -> dict:
        with db.session() as conn:
            langs = [conn.execute("SELECT lang FROM corpora WHERE id=?", (i,)).fetchone()
                     for i in (corpus_id, partner_id)]
        if not all(langs):
            raise importer.ImportRejected(404, "Corpus no longer exists", "gone")
        pairs, skipped = read_pairs(filename, data, langs[0]["lang"], langs[1]["lang"], swap)
        parts = [pairs[i:i + PAIRS_PER_DOC] for i in range(0, len(pairs), PAIRS_PER_DOC)]
        done = dups = 0
        for n, part in enumerate(parts):
            title = stem if len(parts) == 1 else f"{stem} (part {n + 1})"

            def frac(side: int, f: float, n=n) -> None:
                job.set_progress((n + (side + f) / 2) / len(parts))

            with db.session() as conn:
                a = conn.execute("SELECT * FROM corpora WHERE id=?", (corpus_id,)).fetchone()
                b = conn.execute("SELECT * FROM corpora WHERE id=?", (partner_id,)).fetchone()
                if not a or not b:
                    raise importer.ImportRejected(404, "Corpus no longer exists", "gone")
                try:
                    da = importer.add_document(conn, a, title, "\n".join(p[0] for p in part), filename, "aligned",
                                               meta, force_language, lambda f: frac(0, f), segmented=True)
                    db_ = importer.add_document(conn, b, title, "\n".join(p[1] for p in part), filename, "aligned",
                                                meta, force_language, lambda f: frac(1, f), segmented=True)
                except importer.ImportRejected as exc:
                    if exc.code != "duplicate":
                        if done:
                            exc.message += f" ({done} earlier parts were imported.)"
                        raise
                    dups += 1
                    continue
                conn.execute("UPDATE documents SET pair_doc_id=? WHERE id=?", (db_["id"], da["id"]))
                conn.execute("UPDATE documents SET pair_doc_id=? WHERE id=?", (da["id"], db_["id"]))
            done += 1
        return {"documents": done, "segments": len(pairs), "skipped_units": skipped, "skipped_duplicates": dups}
    return work


# --------------------------------------------------------------------------- searching
def segment_at(conn, doc_id: int, pos: int):
    """(seg, start, end) of the segment holding token `pos`, or None."""
    return conn.execute("SELECT seg, start_pos, end_pos FROM segments WHERE doc_id=? AND start_pos<=? AND end_pos>?",
                        (doc_id, pos, pos)).fetchone()


def segment_tokens(conn, doc_id: int, start: int, end: int) -> tuple[str, list[dict]]:
    """Text of the token range [start, end) and, for every token, its [s, e) character offsets in that text.
    The text is the `form` + `sp` join (stripped), so offsets index exactly what the interface displays."""
    rows = conn.execute("SELECT pos, form, lemma, sp FROM tokens WHERE doc_id=? AND pos>=? AND pos<? ORDER BY pos",
                        (doc_id, start, end)).fetchall()
    raw, toks = "", []
    for r in rows:
        toks.append({"pos": r["pos"], "form": r["form"], "lemma": r["lemma"], "s": len(raw),
                     "e": len(raw) + len(r["form"])})
        raw += r["form"] + (" " if r["sp"] else "")
    lead = len(raw) - len(raw.lstrip())
    text = raw.strip()
    for t in toks:
        t["s"] = min(max(t["s"] - lead, 0), len(text))
        t["e"] = min(max(t["e"] - lead, 0), len(text))
    return text, toks


def segment_text(conn, doc_id: int, start: int, end: int) -> str:
    return segment_tokens(conn, doc_id, start, end)[0]


def _pair_of(conn, cache: dict, doc_id: int):
    if doc_id not in cache:
        row = conn.execute("SELECT pair_doc_id FROM documents WHERE id=?", (doc_id,)).fetchone()
        cache[doc_id] = row["pair_doc_id"] if row else None
    return cache[doc_id]


def _partner_span(conn, seg: int, partner_doc: int):
    return conn.execute("SELECT start_pos, end_pos FROM segments WHERE doc_id=? AND seg=?",
                        (partner_doc, seg)).fetchone()


def _termbase_translations(conn, corpus_id: int, query: str) -> list[str]:
    """Approved translations of `query` for this corpus: its project's termbase, then the general one.
    Entries are read in both directions (the corpus language can be the entry's source or its target)."""
    c = conn.execute("SELECT lang, project_id FROM corpora WHERE id=?", (corpus_id,)).fetchone()
    if not c:
        return []
    q = " ".join(query.lower().split())
    out: list[str] = []
    for src, tgt in (("src", "tgt"), ("tgt", "src")):
        for r in conn.execute(
                f"""SELECT {tgt}_term AS term FROM terms
                    WHERE status='approved' AND {src}_lang=? AND lower({src}_term)=? AND {tgt}_term<>''
                      AND (project_id IS NULL OR project_id IS ?)
                    ORDER BY project_id IS NULL, id""", (c["lang"], q, c["project_id"])):
            if r["term"] not in out:
                out.append(r["term"])
    return out


def _find_words(toks: list[dict], words: list[str]) -> list[tuple[int, int]]:
    """(first, last) token indexes where the word sequence `words` occurs; each word matches a form or a lemma."""
    n, found = len(words), []
    for i in range(len(toks) - n + 1):
        if all(words[k] in (toks[i + k]["form"].lower(), toks[i + k]["lemma"].lower()) for k in range(n)):
            found.append((i, i + n - 1))
    return found


def _runs(toks: list[dict]) -> list[dict]:
    """Character ranges of the given tokens; neighbouring tokens (a phrase) become one range."""
    out: list[dict] = []
    prev = None
    for t in toks:
        if out and prev is not None and t["pos"] == prev + 1:
            out[-1]["end"] = t["e"]
        else:
            out.append({"start": t["s"], "end": t["e"]})
        prev = t["pos"]
    return out


def bilingual_concordance(conn, scope, q, unit="lemma", width=8, limit=300, sort="doc",
                          case_sensitive=False, any_order=False, sample=None, advanced=False,
                          accent_insensitive=False):
    """Concordance restricted to aligned documents; every line also carries its whole segment and the
    aligned translation. Works from either side: run it on the target corpus to search the translations.

    Each line also has character offsets into the displayed text: `source_marks` (the hit itself) and
    `target_marks` (the likely equivalent: an approved termbase translation, else the best statistical
    candidate of `equivalents`; `guess` is true for the statistical ones, `score` is their Dice)."""
    scope = replace(analysis.as_scope(scope), paired_only=True)
    res = analysis.concordance(conn, scope, q, unit, width, limit, sort, case_sensitive, any_order, sample,
                               advanced, accent_insensitive)
    approved: list[tuple[list[str], float, bool]] = []       # computed once per search, not once per line
    guesses: list[tuple[list[str], float, bool]] = []
    if res["lines"]:
        for term in ([] if advanced else _termbase_translations(conn, scope.corpus_id, q)):
            approved.append((term.lower().split(), 1.0, False))
        rows = equivalents(conn, scope, q, unit, limit=100, case_sensitive=case_sensitive,
                           any_order=any_order, advanced=advanced, accent_insensitive=accent_insensitive)["rows"]
        if rows:
            # One guess per search. Ties on Dice (common in small memories, where every word of the
            # segments co-occurs) go to the candidate that looks most like the query (cognates in es/it).
            best = rows[0]["dice"]
            q_norm = q.lower()
            pick = max((r for r in rows if r["dice"] == best),
                       key=lambda r: len(os.path.commonprefix([r["item"], q_norm])))
            guesses.append(([pick["item"].lower()], pick["dice"], True))
    cache: dict = {}
    corpus = conn.execute("SELECT lang, project_id FROM corpora WHERE id=?", (scope.corpus_id,)).fetchone()
    partner_lang: dict[int, str] = {}
    for line in res["lines"]:
        seg = segment_at(conn, line["doc_id"], line["pos"])
        partner = _pair_of(conn, cache, line["doc_id"])
        span = _partner_span(conn, seg["seg"], partner) if seg and partner else None
        line["source"], src_toks = (segment_tokens(conn, line["doc_id"], seg["start_pos"], seg["end_pos"])
                                    if seg else ("", []))
        line["target"], tgt_toks = (segment_tokens(conn, partner, span["start_pos"], span["end_pos"])
                                    if span else ("", []))
        line["source_marks"] = _runs([t for t in src_toks if t["pos"] in line["matches"]])
        tmarks: list[dict] = []
        for candidates in (approved, guesses):        # an approved translation wins; the guess is the fallback
            taken: set[int] = set()
            for words, score, guess in candidates:
                for a, b in _find_words(tgt_toks, words):
                    idx = set(range(a, b + 1))
                    if idx & taken:
                        continue
                    taken |= idx
                    tmarks.append({"start": tgt_toks[a]["s"], "end": tgt_toks[b]["e"], "score": round(score, 3),
                                   "guess": guess})
            if tmarks:
                break
        line["target_marks"] = sorted(tmarks, key=lambda m: m["start"])
        # termbase hits (forms and lemmas, multi-word) and forbidden translations, as offsets too
        line["source_terms"] = termhits.find(conn, corpus["project_id"], corpus["lang"], src_toks)
        if partner not in partner_lang:
            row = conn.execute("SELECT c.lang FROM documents d JOIN corpora c ON c.id=d.corpus_id WHERE d.id=?",
                               (partner,)).fetchone() if partner else None
            partner_lang[partner] = row["lang"] if row else ""
        line["target_terms"] = (termhits.find(conn, corpus["project_id"], partner_lang[partner], tgt_toks)
                                if partner_lang[partner] else [])
    return res


def equivalents(conn, scope, q, unit="lemma", min_freq=2, exclude_stop=True, pos=None, limit=100,
                case_sensitive=False, any_order=False, advanced=False, accent_insensitive=False):
    """Candidate translation equivalents of a source word or phrase: the target-language lemmas that keep
    turning up in the aligned segments of its occurrences, scored by Dice against how often each lemma
    occurs in the target segments overall (so everyday words that occur everywhere do not win)."""
    scope = replace(analysis.as_scope(scope), paired_only=True)
    hits, _, _ = analysis.search(conn, scope, q, unit, case_sensitive, any_order, advanced, accent_insensitive)
    cache: dict = {}
    segments: set[tuple[int, int]] = set()          # (source doc, segment) containing the term
    for h in hits:
        seg = segment_at(conn, h["doc_id"], h["pos"])
        if seg:
            segments.add((h["doc_id"], seg["seg"]))
    f_node = len(segments)
    co: Counter = Counter()
    pos_of: dict[str, Counter] = {}
    for doc_id, seg in segments:
        partner = _pair_of(conn, cache, doc_id)
        span = _partner_span(conn, seg, partner) if partner else None
        if not span:
            continue
        seen = set()
        for r in conn.execute("SELECT lemma, upos, alpha, stop FROM tokens WHERE doc_id=? AND pos>=? AND pos<?",
                              (partner, span["start_pos"], span["end_pos"])):
            if not r["alpha"] or (exclude_stop and r["stop"]) or (pos and r["upos"] not in pos):
                continue
            pos_of.setdefault(r["lemma"], Counter())[r["upos"]] += 1
            seen.add(r["lemma"])
        co.update(seen)
    cands = [lemma for lemma, c in co.items() if c >= min_freq]
    totals: dict[str, int] = {}
    w, params = scope.where()
    for i in range(0, len(cands), 500):
        chunk = cands[i:i + 500]
        for r in conn.execute(
                f"""SELECT t.lemma AS lemma, COUNT(DISTINCT t.doc_id || ':' || s.seg) AS n
                    FROM tokens t JOIN segments s ON s.doc_id=t.doc_id AND t.pos>=s.start_pos AND t.pos<s.end_pos
                    WHERE t.doc_id IN (SELECT d.pair_doc_id FROM documents d WHERE {w})
                      AND t.alpha=1 AND t.lemma IN ({",".join("?" * len(chunk))})
                    GROUP BY t.lemma""", [*params, *chunk]):
            totals[r["lemma"]] = r["n"]
    rows = []
    for lemma in cands:
        f_t = max(totals.get(lemma, 0), co[lemma])
        dice = 2 * co[lemma] / (f_node + f_t)
        rows.append({"item": lemma, "pos": pos_of[lemma].most_common(1)[0][0], "cooc": co[lemma],
                     "node_segments": f_node, "target_segments": f_t, "dice": round(dice, 3),
                     "logdice": round(14 + math.log2(dice), 2)})
    rows.sort(key=lambda r: (-r["dice"], -r["cooc"], r["item"]))
    return {"node_segments": f_node, "rows": rows[:limit]}
