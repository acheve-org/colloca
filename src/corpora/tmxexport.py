"""TMX export of aligned corpora (T20): the translation memory built or cleaned in Corpora, back to a CAT tool.

TMX 1.4b, level 1 for text; the inline markup of an imported TMX is written back when it was kept (see db v12), so a
round trip does not lose formatting codes. Each translation unit carries the document's metadata as `prop`s."""
import sqlite3
from datetime import UTC, datetime
from xml.etree import ElementTree as StdET
from xml.sax.saxutils import escape, quoteattr

from defusedxml import DefusedXmlException
from defusedxml import ElementTree as SafeET

from . import analysis

# The inline elements TMX 1.4b allows inside <seg>; anything else in stored markup is dropped.
INLINE = {"bpt", "ept", "it", "ph", "hi", "ut", "sub"}
_PROPS = (("x-document", "title"), ("x-source", "source"), ("x-text-type", "text_type"), ("x-date", "doc_date"),
          ("x-author", "author"))


def partners(conn: sqlite3.Connection, corpus_id: int, scope: analysis.Scope | None = None) -> list[dict]:
    """The corpora holding the translations of this corpus's aligned documents, with how many documents and
    segments each pairs with."""
    scope = scope or analysis.Scope(corpus_id)
    where, params = scope.where("d")
    live = analysis.PARTNER_LIVE.format(a="d")
    rows = conn.execute(f"""SELECT c.id, c.name, c.lang, COUNT(*) AS docs
                            FROM documents d JOIN documents p ON p.id=d.pair_doc_id JOIN corpora c ON c.id=p.corpus_id
                            WHERE {where} AND d.segmented=1 AND {live} GROUP BY c.id ORDER BY c.name""", params)
    return [dict(r) for r in rows]


def _seg(text: str, raw: str | None) -> str:
    """The <seg> element: the stored inline markup when it is still well formed and uses only TMX inline elements."""
    if raw:
        try:
            node = SafeET.fromstring(f"<seg>{raw}</seg>")
            if all(e.tag in INLINE for e in node.iter() if e is not node):
                inner = escape(node.text or "") + "".join(StdET.tostring(c, encoding="unicode") for c in node)
                return f"<seg>{inner}</seg>"
        except (SafeET.ParseError, DefusedXmlException):
            pass
    return f"<seg>{escape(text)}</seg>"


def _lines(text: str) -> list[str]:
    return text.split("\n")


def to_tmx(conn: sqlite3.Connection, corpus_id: int, partner_id: int, scope: analysis.Scope | None = None,
           markup: bool = True, project: str = "") -> tuple[bytes, dict]:
    """(the TMX file, {"units", "documents", "skipped_documents"}) for this corpus (the source language) and its
    partner corpus. `scope` narrows the documents of this corpus (the document filter of the screens)."""
    scope = scope or analysis.Scope(corpus_id)
    src = conn.execute("SELECT lang FROM corpora WHERE id=?", (corpus_id,)).fetchone()["lang"]
    tgt = conn.execute("SELECT lang FROM corpora WHERE id=?", (partner_id,)).fetchone()["lang"]
    where, params = scope.where("d")
    live = analysis.PARTNER_LIVE.format(a="d")
    docs = conn.execute(f"""SELECT d.id, d.title, d.source, d.text_type, d.doc_date, d.author, d.text,
                                   p.id AS pid, p.text AS ptext
                            FROM documents d JOIN documents p ON p.id=d.pair_doc_id
                            WHERE {where} AND d.segmented=1 AND {live} AND p.corpus_id=? ORDER BY d.id""",
                        (*params, partner_id)).fetchall()
    out = ['<?xml version="1.0" encoding="UTF-8"?>\n<tmx version="1.4">\n',
           f'<header creationtool="Corpora" creationtoolversion="0.1" segtype="sentence" o-tmf="Corpora" '
           f'adminlang="en" srclang="{src}" datatype="plaintext" '
           f'creationdate="{datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")}">\n']
    if project:
        out.append(f'<prop type="x-project">{escape(project)}</prop>\n')
    out.append("</header>\n<body>\n")
    units = used = skipped = 0
    for d in docs:
        a, b = _lines(d["text"]), _lines(d["ptext"])
        if len(a) != len(b):         # not one segment per line on both sides: cannot be paired line by line
            skipped += 1
            continue
        tags = [r[0] for r in conn.execute("SELECT tag FROM doc_tags WHERE doc_id=? ORDER BY tag", (d["id"],))]
        raws: dict[tuple[int, int], str] = {}
        if markup:
            for r in conn.execute("SELECT doc_id, seg, raw FROM segment_markup WHERE doc_id IN (?,?)",
                                  (d["id"], d["pid"])):
                raws[(r["doc_id"], r["seg"])] = r["raw"]
        props = "".join(f"<prop type={quoteattr(t)}>{escape(d[k])}</prop>" for t, k in _PROPS if d[k])
        if tags:
            props += f"<prop type=\"x-tags\">{escape(', '.join(tags))}</prop>"
        for i, (x, y) in enumerate(zip(a, b, strict=True)):
            out.append(f"<tu>{props}<tuv xml:lang=\"{src}\">{_seg(x, raws.get((d['id'], i)))}</tuv>"
                       f"<tuv xml:lang=\"{tgt}\">{_seg(y, raws.get((d['pid'], i)))}</tuv></tu>\n")
            units += 1
        used += 1
    out.append("</body>\n</tmx>\n")
    return "".join(out).encode("utf-8"), {"units": units, "documents": used, "skipped_documents": skipped}

