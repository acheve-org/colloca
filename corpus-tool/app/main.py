"""FastAPI application: JSON API + static single-page UI."""
import csv
import hashlib
import io
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import analysis, db, ingest, nlp

@asynccontextmanager
async def lifespan(_app):
    db.init_db()
    yield


app = FastAPI(title="Corpus Tool", version="0.1.0", lifespan=lifespan)
STATIC = os.path.join(os.path.dirname(__file__), "static")


# --------------------------------------------------------------------------- helpers
def _corpus(conn, corpus_id: int):
    row = conn.execute("SELECT * FROM corpora WHERE id=?", (corpus_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Corpus not found")
    return row


def _reply(rows: list[dict], fmt: str, name: str):
    """JSON by default; CSV download with ?format=csv."""
    if fmt == "csv":
        buf = io.StringIO()
        if rows:
            w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})
    return rows


def _pos_list(pos: Optional[str]) -> Optional[list[str]]:
    return [p.strip().upper() for p in pos.split(",") if p.strip()] if pos else None


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _add_document(conn, corpus, title: str, text: str, source: str, kind: str, tags: str) -> dict:
    text = ingest.normalize_text(text)
    if len(text) < 20:
        raise HTTPException(400, "Text is too short")
    digest = hashlib.sha256(" ".join(text.split()).lower().encode()).hexdigest()
    if conn.execute("SELECT 1 FROM documents WHERE corpus_id=? AND text_hash=?",
                    (corpus["id"], digest)).fetchone():
        raise HTTPException(409, "An identical document is already in this corpus")
    try:
        pipeline = nlp.pipeline_name(corpus["lang"])
        tokens = list(nlp.annotate(text, corpus["lang"]))
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(500, str(exc)) from exc
    n_alpha = sum(t[6] for t in tokens)
    cur = conn.execute(
        """INSERT INTO documents (corpus_id,title,source,kind,tags,text,text_hash,n_tokens,pipeline)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (corpus["id"], title.strip() or "Untitled", source, kind, tags, text, digest, n_alpha, pipeline))
    doc_id = cur.lastrowid
    conn.executemany("INSERT INTO tokens VALUES (?,?,?,?,?,?,?,?,?,?)",
                     ((doc_id,) + t for t in tokens))
    return {"id": doc_id, "title": title, "tokens": n_alpha}


# --------------------------------------------------------------------------- corpora
class CorpusIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    lang: str
    description: str = ""


@app.get("/api/languages")
def languages():
    return nlp.SUPPORTED


@app.get("/api/corpora")
def list_corpora():
    with db.session() as conn:
        rows = conn.execute(
            """SELECT c.*, COUNT(d.id) AS docs, COALESCE(SUM(d.n_tokens),0) AS tokens
               FROM corpora c LEFT JOIN documents d ON d.corpus_id=c.id GROUP BY c.id ORDER BY c.id""").fetchall()
        return [dict(r) for r in rows]


@app.post("/api/corpora", status_code=201)
def create_corpus(body: CorpusIn):
    if body.lang not in nlp.SUPPORTED:
        raise HTTPException(400, f"Language must be one of {list(nlp.SUPPORTED)}")
    with db.session() as conn:
        cur = conn.execute("INSERT INTO corpora (name,lang,description) VALUES (?,?,?)",
                           (body.name.strip(), body.lang, body.description))
        return {"id": cur.lastrowid}


@app.delete("/api/corpora/{corpus_id}", status_code=204)
def delete_corpus(corpus_id: int):
    with db.session() as conn:
        _corpus(conn, corpus_id)
        conn.execute("DELETE FROM corpora WHERE id=?", (corpus_id,))


# --------------------------------------------------------------------------- documents
class UrlIn(BaseModel):
    url: str


class DocIn(BaseModel):
    title: str = ""
    text: str
    source: str = ""
    kind: str = "paste"
    tags: str = ""


@app.post("/api/preview-url")
def preview_url(body: UrlIn):
    """Fetch and extract a URL without saving, so the user can review and trim it."""
    try:
        return ingest.fetch_url(body.url.strip())
    except ingest.IngestError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # network errors
        raise HTTPException(502, f"Could not fetch URL: {exc}") from exc


@app.get("/api/corpora/{corpus_id}/documents")
def list_documents(corpus_id: int):
    with db.session() as conn:
        _corpus(conn, corpus_id)
        rows = conn.execute(
            """SELECT id,title,source,kind,tags,n_tokens,pipeline,added,LENGTH(text) AS chars
               FROM documents WHERE corpus_id=? ORDER BY id""", (corpus_id,)).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/corpora/{corpus_id}/documents", status_code=201)
def add_document(corpus_id: int, body: DocIn):
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        return _add_document(conn, corpus, body.title, body.text, body.source, body.kind, body.tags)


@app.post("/api/corpora/{corpus_id}/upload")
async def upload(corpus_id: int, files: list[UploadFile] = File(...), tags: str = ""):
    results = []
    for f in files:
        data = await f.read()
        try:
            parsed = ingest.read_file(f.filename or "file", data)
            with db.session() as conn:
                corpus = _corpus(conn, corpus_id)
                doc = _add_document(conn, corpus, parsed["title"], parsed["text"],
                                    f.filename or "", "file", tags)
            results.append({"file": f.filename, "ok": True, **doc})
        except (ingest.IngestError, HTTPException) as exc:
            msg = exc.detail if isinstance(exc, HTTPException) else str(exc)
            results.append({"file": f.filename, "ok": False, "error": msg})
    return results


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: int):
    with db.session() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Document not found")
        return dict(row)


@app.delete("/api/documents/{doc_id}", status_code=204)
def delete_document(doc_id: int):
    with db.session() as conn:
        conn.execute("DELETE FROM documents WHERE id=?", (doc_id,))


# --------------------------------------------------------------------------- analyses
@app.get("/api/corpora/{corpus_id}/frequency")
def frequency(corpus_id: int, unit: str = "lemma", pos: Optional[str] = None, min_freq: int = 1,
              exclude_stop: bool = True, limit: int = Query(500, le=5000), format: str = "json"):
    with db.session() as conn:
        _corpus(conn, corpus_id)
        rows = _run(analysis.frequency, conn, corpus_id, unit, _pos_list(pos), min_freq,
                    exclude_stop, True, limit)
    return _reply(rows, format, "frequency")


@app.get("/api/corpora/{corpus_id}/concordance")
def concordance(corpus_id: int, q: str, unit: str = "lemma", width: int = Query(8, le=40),
                limit: int = Query(300, le=2000), sort: str = "doc", format: str = "json"):
    with db.session() as conn:
        _corpus(conn, corpus_id)
        res = _run(analysis.concordance, conn, corpus_id, q, unit, width, limit, sort)
    if format == "csv":
        return _reply([{k: v for k, v in ln.items() if k != "pos"} for ln in res["lines"]],
                      format, "concordance")
    return res


@app.get("/api/corpora/{corpus_id}/collocations")
def collocations(corpus_id: int, q: str, left: int = Query(4, ge=0, le=15),
                 right: int = Query(4, ge=0, le=15), min_freq: int = 2, exclude_stop: bool = True,
                 pos: Optional[str] = None, limit: int = Query(200, le=2000), format: str = "json"):
    with db.session() as conn:
        _corpus(conn, corpus_id)
        res = _run(analysis.collocations, conn, corpus_id, q, left, right, min_freq,
                   exclude_stop, _pos_list(pos), limit)
    return _reply(res["rows"], format, "collocations") if format == "csv" else res


@app.get("/api/corpora/{corpus_id}/ngrams")
def ngrams(corpus_id: int, n: int = 3, unit: str = "form", min_freq: int = 2, min_docs: int = 1,
           edge_stop: bool = False, limit: int = Query(300, le=3000), format: str = "json"):
    with db.session() as conn:
        _corpus(conn, corpus_id)
        rows = _run(analysis.ngrams, conn, corpus_id, n, unit, min_freq, min_docs, edge_stop, limit)
    return _reply(rows, format, "ngrams")


@app.get("/api/corpora/{corpus_id}/keyness")
def keyness(corpus_id: int, ref: int, unit: str = "lemma", min_freq: int = 3,
            exclude_stop: bool = True, pos: Optional[str] = None,
            limit: int = Query(300, le=3000), format: str = "json"):
    with db.session() as conn:
        c = _corpus(conn, corpus_id)
        r = _corpus(conn, ref)
        if c["lang"] != r["lang"]:
            raise HTTPException(400, "Reference corpus must have the same language")
        rows = _run(analysis.keyness, conn, corpus_id, ref, unit, min_freq, exclude_stop,
                    _pos_list(pos), limit)
    return _reply(rows, format, "keyness")


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
