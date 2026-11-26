"""Read a document around one hit, without sending the whole text to the browser (the "open the document at
this hit" view). A document is shown as blocks: sentences, or for an aligned document its segments with the
aligned segment of the partner document beside them."""
import re

from . import analysis, parallel

MAX_RADIUS = 50
MAX_BLOCKS = 500


def _meta(conn, doc_id: int) -> dict | None:
    row = conn.execute(f"""SELECT d.id, d.corpus_id, d.title, d.source, d.kind, d.author, d.doc_date, d.text_type,
                                  d.n_tokens, d.segmented,
                                  CASE WHEN {analysis.PARTNER_LIVE.format(a='d')} THEN d.pair_doc_id END AS pair_doc_id
                           FROM documents d JOIN corpora c ON c.id=d.corpus_id
                           WHERE d.id=? AND d.deleted_at IS NULL AND c.deleted_at IS NULL""", (doc_id,)).fetchone()
    if not row:
        return None
    tags = [r[0] for r in conn.execute("SELECT tag FROM doc_tags WHERE doc_id=? ORDER BY tag", (doc_id,))]
    return {"id": row["id"], "corpus_id": row["corpus_id"], "title": row["title"], "source": row["source"],
            "kind": row["kind"], "author": row["author"], "date": row["doc_date"], "text_type": row["text_type"],
            "tags": tags, "tokens": row["n_tokens"], "aligned": bool(row["segmented"] and row["pair_doc_id"]),
            "pair_doc_id": row["pair_doc_id"]}


def _marks(toks: list[dict], start: int, end: int) -> list[dict]:
    """Character range covering the tokens at positions [start, end) of one block."""
    hit = [t for t in toks if start <= t["pos"] < end]
    return [{"start": hit[0]["s"], "end": hit[-1]["e"]}] if hit else []


def context(conn, doc_id: int, pos: int, span: int = 1, radius: int = 3) -> dict:
    """The hit at token `pos` (`span` tokens) with `radius` blocks before and after it.

    Returns the document's metadata, `blocks` ([{n, text, hit, marks, pair}]; `pair` is the aligned partner
    text of the same segment, only for aligned documents), and whether more blocks exist on either side."""
    doc = _meta(conn, doc_id)
    if doc is None:
        raise LookupError("Document not found")
    if not conn.execute("SELECT 1 FROM tokens WHERE doc_id=? AND pos=?", (doc_id, pos)).fetchone():
        raise ValueError("No such position in this document")
    radius = max(0, min(radius, MAX_RADIUS))
    span = max(1, min(span, 200))
    if doc["aligned"]:
        seg = parallel.segment_at(conn, doc_id, pos)
        if seg is None:
            raise ValueError("No segment at this position")
        first, last = max(seg["seg"] - radius, 0), seg["seg"] + radius
        spans = conn.execute("SELECT seg, start_pos, end_pos FROM segments WHERE doc_id=? AND seg BETWEEN ? AND ? "
                             "ORDER BY seg", (doc_id, first, last)).fetchall()
        partner = {r["seg"]: r for r in conn.execute(
            "SELECT seg, start_pos, end_pos FROM segments WHERE doc_id=? AND seg BETWEEN ? AND ?",
            (doc["pair_doc_id"], first, last))}
        blocks = []
        for sp in spans:
            text, toks = parallel.segment_tokens(conn, doc_id, sp["start_pos"], sp["end_pos"])
            other = partner.get(sp["seg"])
            pair = parallel.segment_text(conn, doc["pair_doc_id"], other["start_pos"], other["end_pos"]) \
                if other else ""
            is_hit = sp["seg"] == seg["seg"]
            blocks.append({"n": sp["seg"], "text": text, "hit": is_hit, "pair": pair,
                           "marks": _marks(toks, pos, pos + span) if is_hit else []})
        total = conn.execute("SELECT COUNT(*) FROM segments WHERE doc_id=?", (doc_id,)).fetchone()[0]
        before, after = first > 0, last < total - 1
    else:
        sent = conn.execute("SELECT sent FROM tokens WHERE doc_id=? AND pos=?", (doc_id, pos)).fetchone()["sent"]
        first, last = max(sent - radius, 0), sent + radius
        rows = conn.execute("""SELECT pos, sent, form, lemma, sp FROM tokens WHERE doc_id=? AND sent BETWEEN ? AND ?
                               ORDER BY pos""", (doc_id, first, last)).fetchall()
        groups: dict[int, list] = {}
        for r in rows:
            groups.setdefault(r["sent"], []).append(r)
        blocks = []
        for n, grp in groups.items():
            text, toks = _tokens_text(grp)
            is_hit = n == sent
            blocks.append({"n": n, "text": text, "hit": is_hit, "pair": "",
                           "marks": _marks(toks, pos, pos + span) if is_hit else []})
        top = conn.execute("SELECT MAX(sent) FROM tokens WHERE doc_id=?", (doc_id,)).fetchone()[0] or 0
        before, after = first > 0, last < top
    return {"document": {k: v for k, v in doc.items() if k != "pair_doc_id"}, "blocks": blocks,
            "more_before": before, "more_after": after}


def _paragraphs(text: str) -> list[str]:
    """Paragraphs of a plain text: split on blank lines, or on single line breaks when it has no blank line."""
    pieces = re.split(r"\n\s*\n", text)
    if len(pieces) == 1 and "\n" in text:
        pieces = text.split("\n")
    return [p.strip() for p in pieces if p.strip()]


def blocks(conn, doc_id: int, start: int = 0, limit: int = 100) -> dict:
    """`limit` blocks of a whole document from block `start` on, for reading it page by page.

    Blocks are the aligned segments (with the partner's segment as `pair`) of an aligned document, else the
    paragraphs of its original text. Returns the document's metadata (as `context`), `blocks` ([{n, text,
    pair}]) and `total`, the number of blocks in the document."""
    doc = _meta(conn, doc_id)
    if doc is None:
        raise LookupError("Document not found")
    start = max(start, 0)
    limit = max(1, min(limit, MAX_BLOCKS))
    if doc["aligned"]:
        spans = conn.execute("SELECT seg, start_pos, end_pos FROM segments WHERE doc_id=? ORDER BY seg "
                             "LIMIT ? OFFSET ?", (doc_id, limit, start)).fetchall()
        partner = {}
        if spans:
            partner = {r["seg"]: r for r in conn.execute(
                "SELECT seg, start_pos, end_pos FROM segments WHERE doc_id=? AND seg BETWEEN ? AND ?",
                (doc["pair_doc_id"], spans[0]["seg"], spans[-1]["seg"]))}
        out = []
        for sp in spans:
            other = partner.get(sp["seg"])
            out.append({"n": sp["seg"], "text": parallel.segment_text(conn, doc_id, sp["start_pos"], sp["end_pos"]),
                        "pair": parallel.segment_text(conn, doc["pair_doc_id"], other["start_pos"],
                                                      other["end_pos"]) if other else ""})
        total = conn.execute("SELECT COUNT(*) FROM segments WHERE doc_id=?", (doc_id,)).fetchone()[0]
    else:
        text = conn.execute("SELECT text FROM documents WHERE id=?", (doc_id,)).fetchone()["text"] or ""
        paras = _paragraphs(text)
        out = [{"n": n, "text": t, "pair": ""} for n, t in enumerate(paras[start:start + limit], start)]
        total = len(paras)
    return {"document": {k: v for k, v in doc.items() if k != "pair_doc_id"}, "blocks": out, "total": total}


def _tokens_text(rows) -> tuple[str, list[dict]]:
    """Text of consecutive token rows (form + sp) and their character offsets, as `segment_tokens` does."""
    raw, toks = "", []
    for r in rows:
        toks.append({"pos": r["pos"], "s": len(raw), "e": len(raw) + len(r["form"])})
        raw += r["form"] + (" " if r["sp"] else "")
    lead = len(raw) - len(raw.lstrip())
    text = raw.strip()
    for t in toks:
        t["s"] = min(max(t["s"] - lead, 0), len(text))
        t["e"] = min(max(t["e"] - lead, 0), len(text))
    return text, toks
