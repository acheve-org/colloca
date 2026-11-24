"""FastAPI application: JSON API + static single-page UI."""
import asyncio
import csv
import io
import json
import logging
import os
import sqlite3
import tempfile
import time
from contextlib import asynccontextmanager
from dataclasses import asdict
from typing import Literal

import spacy
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from . import (
    align,
    analysis,
    auth,
    backup,
    backupcrypt,
    candidates,
    db,
    dedup,
    docview,
    importer,
    ingest,
    jobanalysis,
    jobreports,
    logsetup,
    metadata,
    nlp,
    parallel,
    related,
    segmentlookup,
    termbase,
    termexport,
    termhits,
    termimport,
    tmxexport,
    trash,
)


@asynccontextmanager
async def lifespan(_app):
    logsetup.configure()
    db.init_db()
    with db.session() as conn:
        trash.purge_expired(conn)
    yield


app = FastAPI(title="Colloca", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def log_requests(request, call_next):
    """One warning line for every request slower than COLLOCA_SLOW_MS or ending in a server error."""
    t0 = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logging.getLogger("colloca.http").exception("%s %s failed", request.method, request.url.path)
        raise
    ms = (time.perf_counter() - t0) * 1000
    if response.status_code >= 500:
        logging.getLogger("colloca.http").error("%s %s -> %s (%.0f ms)", request.method, request.url.path,
                                                response.status_code, ms)
    elif logsetup.slow_ms() and ms >= logsetup.slow_ms():
        logging.getLogger("colloca.http").warning("Slow: %s %s took %.0f ms", request.method, request.url.path, ms)
    return response


@app.middleware("http")
async def require_login(request, call_next):
    """With COLLOCA_PASSWORD set, nothing but the login page answers without a session (see auth.py)."""
    path = request.url.path
    if auth.enabled() and path not in auth.PUBLIC and not auth.authenticated(request.headers, request.cookies):
        if path.startswith("/api/"):
            return JSONResponse({"detail": "Authentication required"}, status_code=401,
                                headers={"WWW-Authenticate": "Bearer"})
        return RedirectResponse(auth.login_redirect(path, request.url.query), status_code=303)
    return await call_next(request)


def _client_address(request) -> str:
    """The address failed logins are counted against (the first X-Forwarded-For hop only if COLLOCA_TRUST_PROXY=1)."""
    if os.environ.get("COLLOCA_TRUST_PROXY") == "1":
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


def _secure(request) -> bool:
    proto = request.headers.get("x-forwarded-proto", "") if os.environ.get("COLLOCA_TRUST_PROXY") == "1" else ""
    return request.url.scheme == "https" or proto == "https"


@app.get("/api/auth/status")
def auth_status(request: Request):
    """Whether a password is required and whether this request is signed in (public)."""
    return {"required": auth.enabled(), "authenticated": auth.authenticated(request.headers, request.cookies)}


@app.get("/login", include_in_schema=False)
def login_form(request: Request, next: str = "/"):
    target = auth.safe_next(next)
    if not auth.enabled() or auth.authenticated(request.headers, request.cookies):
        return RedirectResponse(target, status_code=303)
    return HTMLResponse(auth.login_page(auth.language(request.headers.get("accept-language", "")), target))


@app.post("/login", include_in_schema=False)
async def login(request: Request, password: str = Form(""), next: str = Form("/")):
    target = auth.safe_next(next)
    lang = auth.language(request.headers.get("accept-language", ""))
    if not auth.enabled():
        return RedirectResponse(target, status_code=303)
    who = _client_address(request)
    wait = auth.retry_after(who)
    if wait:
        return HTMLResponse(auth.login_page(lang, target, "limited", wait), status_code=429,
                            headers={"Retry-After": str(wait)})
    if not auth.check_password(password):
        auth.record_failure(who)
        logging.getLogger("colloca.auth").warning("Failed login from %s", who)
        await asyncio.sleep(0.5)                       # slows a guessing script a little more
        return HTMLResponse(auth.login_page(lang, target, "wrong"), status_code=401)
    auth.clear_failures(who)
    value, life = auth.make_cookie()
    response = RedirectResponse(target, status_code=303)
    response.set_cookie(auth.COOKIE, value, max_age=life, httponly=True, samesite="strict", secure=_secure(request))
    return response


@app.post("/logout", include_in_schema=False)
def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(auth.COOKIE)
    return response


@app.get("/healthz", include_in_schema=False)
def healthz():
    """For a reverse proxy or container health check; answers without a login and reveals nothing."""
    return {"ok": True}


# COLLOCA_STATIC_DIR serves a UI build from elsewhere (end-to-end tests); the default is the packaged one.
STATIC = os.environ.get("COLLOCA_STATIC_DIR") or os.path.join(os.path.dirname(__file__), "static")


# --------------------------------------------------------------------------- helpers
def _corpus(conn, corpus_id: int):
    row = conn.execute("SELECT * FROM corpora WHERE id=? AND deleted_at IS NULL", (corpus_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Corpus not found")
    return row


_csv_safe = termexport.csv_safe


def _reply(rows: list[dict], fmt: str, name: str):
    """JSON by default; CSV download with ?format=csv."""
    if fmt == "csv":
        buf = io.StringIO()
        if rows:
            w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows({k: _csv_safe(v) for k, v in row.items()} for row in rows)
        return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})
    return rows


def _base_corpus_id(conn, corpus) -> int:
    """The language's base corpus, for comparing `corpus` against general language."""
    if corpus["is_reference"]:
        raise HTTPException(400, "This is the base corpus itself; pick another corpus to compare against")
    lang = nlp.SUPPORTED[corpus["lang"]]
    ref = analysis.reference_corpus(conn, corpus["lang"])
    if not ref:
        raise HTTPException(400, f"There is no {lang} base corpus yet (create and fill it in the Base corpora tab)")
    if analysis.corpus_size(conn, ref["id"]) == 0:
        raise HTTPException(400, f"The {lang} base corpus is empty")
    return ref["id"]


def _meta(tags=None, text_type: str = "", doc_date: str = "", author: str = "") -> dict:
    try:
        return {"tags": metadata.normalize_tags(tags), **metadata.clean_meta(text_type, doc_date, author)}
    except metadata.MetadataError as exc:
        raise HTTPException(400, str(exc)) from exc


class ScopeQuery:
    """Query parameters restricting an analysis to some documents of the corpus.

    tags=a,b (documents with ALL tags) · text_type · date_from / date_to (YYYY, YYYY-MM, YYYY-MM-DD)
    · docs=1,2,3 (explicit document ids).
    """

    def __init__(self, tags: str = "", text_type: str = "", date_from: str = "", date_to: str = "",
                 docs: str = ""):
        self.tags, self.text_type, self.date_from, self.date_to, self.docs = tags, text_type, date_from, date_to, docs

    def scope(self, corpus_id: int) -> analysis.Scope:
        try:
            ids = tuple(int(x) for x in self.docs.split(",") if x.strip())
            return analysis.Scope(
                corpus_id, tuple(metadata.normalize_tags(self.tags)),
                " ".join(self.text_type.split()).lower(),
                metadata.normalize_date(self.date_from), metadata.normalize_date(self.date_to), ids)
        except (metadata.MetadataError, ValueError) as exc:
            raise HTTPException(400, f"Invalid filter: {exc}") from exc


def _pos_list(pos: str | None) -> list[str] | None:
    return [p.strip().upper() for p in pos.split(",") if p.strip()] if pos else None


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


# --------------------------------------------------------------------------- projects (clients)
class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    notes: str = Field(default="", max_length=5000)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    notes: str | None = Field(default=None, max_length=5000)


def _project(conn, project_id: int):
    row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Project not found")
    return row


@app.get("/api/projects")
def list_projects():
    with db.session() as conn:
        rows = conn.execute(
            """SELECT p.*, COUNT(c.id) AS corpora FROM projects p
               LEFT JOIN corpora c ON c.project_id=p.id AND c.is_reference=0 AND c.deleted_at IS NULL
               GROUP BY p.id ORDER BY p.name COLLATE NOCASE""").fetchall()
        return [dict(r) for r in rows]


@app.post("/api/projects", status_code=201)
def create_project(body: ProjectIn):
    with db.session() as conn:
        name = body.name.strip()
        if conn.execute("SELECT 1 FROM projects WHERE name=? COLLATE NOCASE", (name,)).fetchone():
            raise HTTPException(409, f"A project called '{name}' already exists")
        return {"id": conn.execute("INSERT INTO projects (name, notes) VALUES (?, ?)",
                                   (name, body.notes)).lastrowid}


@app.patch("/api/projects/{project_id}")
def update_project(project_id: int, body: ProjectPatch):
    with db.session() as conn:
        _project(conn, project_id)
        if body.name is not None:
            name = body.name.strip()
            if conn.execute("SELECT 1 FROM projects WHERE name=? COLLATE NOCASE AND id<>?",
                            (name, project_id)).fetchone():
                raise HTTPException(409, f"A project called '{name}' already exists")
            conn.execute("UPDATE projects SET name=? WHERE id=?", (name, project_id))
        if body.notes is not None:
            conn.execute("UPDATE projects SET notes=? WHERE id=?", (body.notes, project_id))
    return {"ok": True}


@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: int):
    """Removes the grouping only: its corpora are kept and become unassigned."""
    with db.session() as conn:
        _project(conn, project_id)
        conn.execute("DELETE FROM projects WHERE id=?", (project_id,))


# --------------------------------------------------------------------------- corpora
class CorpusIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    lang: str
    description: str = ""
    project_id: int | None = None


class CorpusPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    project_id: int | None = None      # send null to take the corpus out of its project


@app.get("/api/languages")
def languages():
    return nlp.SUPPORTED


@app.get("/api/status")
def status():
    """The spaCy model in use for each language (name, version, size), without loading it."""
    return {"spacy": spacy.__version__, "models": nlp.status()}


_CORPUS_STATS = """SELECT c.*, COUNT(d.id) AS docs, COALESCE(SUM(d.n_tokens),0) AS tokens
                   FROM corpora c LEFT JOIN documents d ON d.corpus_id=c.id AND d.deleted_at IS NULL
                   WHERE c.is_reference=? AND c.deleted_at IS NULL GROUP BY c.id ORDER BY c.id"""


@app.get("/api/corpora")
def list_corpora():
    """Your own corpora. The per-language base corpora are listed by /api/references."""
    with db.session() as conn:
        return [dict(r) for r in conn.execute(_CORPUS_STATS, (0,)).fetchall()]


class ReferenceIn(BaseModel):
    lang: str
    name: str = Field(default="", max_length=120)


@app.get("/api/references")
def list_references():
    """The general (base) corpus of each language, used as reference for keyness and frequency comparison."""
    with db.session() as conn:
        return [dict(r) for r in conn.execute(_CORPUS_STATS, (1,)).fetchall()]


@app.post("/api/references", status_code=201)
def create_reference(body: ReferenceIn):
    """Create the (empty) base corpus of a language; fill it through the normal upload endpoints
    (`?sentences=true` for Leipzig-style sentence files) or with `colloca-import-reference`."""
    if body.lang not in nlp.SUPPORTED:
        raise HTTPException(400, f"Language must be one of {list(nlp.SUPPORTED)}")
    with db.session() as conn:
        if analysis.reference_corpus(conn, body.lang):
            raise HTTPException(409, f"A base corpus for {nlp.SUPPORTED[body.lang]} already exists "
                                     "(delete it first to replace it)")
        name = body.name.strip() or f"General {nlp.SUPPORTED[body.lang]} (base corpus)"
        cur = conn.execute("INSERT INTO corpora (name,lang,description,is_reference) VALUES (?,?,?,1)",
                           (name, body.lang, "General-language reference corpus"))
        return {"id": cur.lastrowid}


@app.post("/api/corpora", status_code=201)
def create_corpus(body: CorpusIn):
    if body.lang not in nlp.SUPPORTED:
        raise HTTPException(400, f"Language must be one of {list(nlp.SUPPORTED)}")
    with db.session() as conn:
        if body.project_id is not None:
            _project(conn, body.project_id)
        cur = conn.execute("INSERT INTO corpora (name,lang,description,project_id) VALUES (?,?,?,?)",
                           (body.name.strip(), body.lang, body.description, body.project_id))
        return {"id": cur.lastrowid}


@app.patch("/api/corpora/{corpus_id}")
def update_corpus(corpus_id: int, body: CorpusPatch):
    """Rename a corpus, change its description, or move it to another project (project_id null = none)."""
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        if "project_id" in body.model_fields_set:
            if corpus["is_reference"]:
                raise HTTPException(400, "A base corpus belongs to no project")
            if body.project_id is not None:
                _project(conn, body.project_id)
            conn.execute("UPDATE corpora SET project_id=? WHERE id=?", (body.project_id, corpus_id))
        if body.name is not None:
            conn.execute("UPDATE corpora SET name=? WHERE id=?", (body.name.strip(), corpus_id))
        if body.description is not None:
            conn.execute("UPDATE corpora SET description=? WHERE id=?", (body.description, corpus_id))
    return {"ok": True}


@app.delete("/api/corpora/{corpus_id}", status_code=204)
def delete_corpus(corpus_id: int):
    """Moves the corpus (with its documents) to the Trash; DELETE /api/trash removes it for good."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        trash.trash_corpus(conn, corpus_id)


# --------------------------------------------------------------------------- documents
Similar = Literal["warn", "import", "replace"]   # what an import does with a near-duplicate


class UrlIn(BaseModel):
    url: str


class DocIn(BaseModel):
    title: str = ""
    text: str = Field(max_length=ingest.MAX_TEXT_CHARS)
    source: str = ""
    kind: str = "paste"
    tags: str | list[str] = ""          # comma-separated or a list
    text_type: str = ""
    doc_date: str = ""                  # YYYY, YYYY-MM or YYYY-MM-DD
    author: str = ""


class DocPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    tags: str | list[str] | None = None
    text_type: str | None = None
    doc_date: str | None = None
    author: str | None = None


def _rejected(exc: importer.ImportRejected) -> HTTPException:
    return HTTPException(exc.status, {"message": exc.message, "code": exc.code, **exc.details}
                         if exc.details else exc.message)


@app.post("/api/preview-url")
def preview_url(body: UrlIn):
    """Fetch and extract a URL without saving, so the user can review and trim it."""
    try:
        return ingest.fetch_url(body.url.strip())
    except ingest.IngestError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # network errors
        raise HTTPException(502, f"Could not fetch URL: {exc}") from exc


@app.post("/api/discover-links")
def discover_links_endpoint(body: UrlIn):
    """List the links of an index page or feed (nothing is fetched beyond that page, nothing is imported)."""
    try:
        return ingest.discover_links(body.url.strip())
    except ingest.IngestError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # network errors
        raise HTTPException(502, f"Could not fetch URL: {exc}") from exc


class UrlListIn(BaseModel):
    urls: list[str] = Field(max_length=500)   # one address each; blank lines and # comments are ignored
    tags: str | list[str] = ""
    text_type: str = ""
    doc_date: str = ""
    author: str = ""
    force_language: bool = False
    similar: Similar = "warn"


@app.post("/api/corpora/{corpus_id}/urls", status_code=202)
def add_urls(corpus_id: int, body: UrlListIn):
    """Import a list of web pages or PDFs without the preview step. Each address becomes a background job; the
    answer has one entry per line: {url, ok, job_id} or {url, ok: false, error}. Requests to one host are
    spaced (URL_DELAY_SECONDS), a list holds at most MAX_URL_LIST addresses and MAX_URLS_PER_HOST per host,
    and the same address checks as the single-URL preview apply. The metadata applies to every document."""
    meta = _meta(body.tags, body.text_type, body.doc_date, body.author)
    with db.session() as conn:
        _corpus(conn, corpus_id)
    urls, rejected = ingest.parse_url_list(body.urls)
    if not urls and not rejected:
        raise HTTPException(400, "The list has no addresses")
    results = [{"url": r["url"], "ok": False, "error": r["error"]} for r in rejected]
    for url in urls:
        def build(policy: str, url=url):
            return importer.import_url(corpus_id, url, meta, body.force_language, policy)
        job = importer.submit(corpus_id, "import", url, build(body.similar), build)
        results.append({"url": url, "ok": True, "job_id": job.id})
    return results


@app.post("/api/preview-file")
async def preview_file(file: UploadFile = File(...), corpus_id: int | None = None, columns: str = ""):
    """Read an uploaded file without saving it, like the URL preview: the text, the reader's warnings and, for a
    PDF, the quality of the extracted text (`quality`: score, level, issues), so it can be checked and trimmed
    before it is added. `corpus_id` gives the language for OCR and for an XLIFF side."""
    lang = None
    if corpus_id is not None:
        with db.session() as conn:
            lang = _corpus(conn, corpus_id)["lang"]
    data = await file.read(ingest.MAX_UPLOAD_BYTES + 1)
    if len(data) > ingest.MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File is larger than {ingest.MAX_UPLOAD_BYTES // 1024 // 1024} MB")
    try:
        parsed = await run_in_threadpool(ingest.read_file, file.filename or "file", data, lang, columns)
    except ingest.IngestError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"source": file.filename or "file", **parsed}


def _tags_by_doc(conn, corpus_id: int) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {}
    for r in conn.execute("""SELECT g.doc_id, g.tag FROM doc_tags g JOIN documents d ON d.id=g.doc_id
                             WHERE d.corpus_id=? AND d.deleted_at IS NULL ORDER BY g.tag""", (corpus_id,)):
        out.setdefault(r["doc_id"], []).append(r["tag"])
    return out


@app.get("/api/corpora/{corpus_id}/documents")
def list_documents(corpus_id: int):
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        rows = conn.execute(
            f"""SELECT id,title,source,kind,text_type,doc_date,author,n_tokens,pipeline,lang_check,added,
                      segmented,LENGTH(text) AS chars,
                      CASE WHEN {analysis.PARTNER_LIVE.format(a='documents')} THEN pair_doc_id END AS pair_doc_id
               FROM documents WHERE corpus_id=? AND deleted_at IS NULL ORDER BY id""", (corpus_id,)).fetchall()
        tags = _tags_by_doc(conn, corpus_id)
    try:
        current = nlp.pipeline_name(corpus["lang"])
    except (RuntimeError, ValueError):
        current = None   # no model installed: nothing can be re-annotated, so nothing is "stale"
    return [{**dict(r), "tags": tags.get(r["id"], []),
             "stale": current is not None and importer.is_stale(r["pipeline"], current)} for r in rows]


@app.post("/api/corpora/{corpus_id}/documents", status_code=201)
def add_document(corpus_id: int, body: DocIn, background: bool = False, force_language: bool = False,
                 similar: Similar = "warn"):
    """Add a text. With ?background=true it is queued and answered at once with 202 + a job.

    A text very similar to one already in the corpus is answered with 409 (`code: near_duplicate`, the matches
    and what overlaps in the body); send it again with `similar=import` to add it anyway or `similar=replace`
    to replace the most similar older document."""
    meta = _meta(body.tags, body.text_type, body.doc_date, body.author)
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        if not background:
            try:
                return importer.add_document(conn, corpus, body.title, body.text, body.source,
                                             body.kind, meta, force_language, similar=similar)
            except importer.ImportRejected as exc:
                raise _rejected(exc) from exc

    def build(policy: str):
        return importer.import_text(corpus_id, body.title, body.text, body.source, body.kind, meta,
                                    force_language, policy)
    job = importer.submit(corpus_id, "import", body.title or "Pasted text", build(similar), build)
    return JSONResponse({"job_id": job.id}, status_code=202)


@app.post("/api/corpora/{corpus_id}/upload", status_code=202)
async def upload(corpus_id: int, files: list[UploadFile] = File(...), tags: str = "",
                 text_type: str = "", doc_date: str = "", author: str = "",
                 force_language: bool = False, sentences: bool = False, columns: str = "",
                 similar: Similar = "warn"):
    """Queue each file as a background job. Per-file answers: {file, ok, job_id} or {file, ok:false, error}.

    With ?sentences=true a file is read as one sentence per line (Leipzig Corpora Collection files work as
    they are) and split into several documents. `columns` (spreadsheets and CSV) lists the text columns to
    import, by number or header name ("2,4" or "Texto"); empty = detect them. `tags`, `text_type`, `doc_date`
    and `author` apply to every file."""
    meta = _meta(tags, text_type, doc_date, author)
    with db.session() as conn:
        _corpus(conn, corpus_id)
    if len(files) > ingest.MAX_UPLOAD_FILES:
        raise HTTPException(413, f"Too many files in one upload (limit {ingest.MAX_UPLOAD_FILES})")
    limit_mb = ingest.MAX_UPLOAD_BYTES // 1024 // 1024
    results = []
    for f in files:
        name = f.filename or "file"
        data = await f.read(ingest.MAX_UPLOAD_BYTES + 1)   # never buffer more than the limit
        if len(data) > ingest.MAX_UPLOAD_BYTES:
            results.append({"file": name, "ok": False,
                            "error": f"File is larger than {limit_mb} MB (set MAX_UPLOAD_MB to change)"})
            continue
        def build(policy: str, name=name, data=data):
            return importer.import_file(corpus_id, name, data, meta, force_language, sentences, columns, policy)
        job = importer.submit(corpus_id, "import", name, build(similar), build)
        results.append({"file": name, "ok": True, "job_id": job.id})
    return results


def _partner_corpus(corpus_id: int, partner_corpus_id: int | None, partner_name: str) -> int:
    """The corpus that receives the translations: an existing one, or a new one in the same project."""
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        if corpus["is_reference"]:
            raise HTTPException(400, "A base corpus cannot hold aligned texts")
        if partner_corpus_id is not None:
            partner = _corpus(conn, partner_corpus_id)
            if partner["id"] == corpus_id or partner["lang"] == corpus["lang"] or partner["is_reference"]:
                raise HTTPException(400, "The partner must be another, non-base corpus in the other language")
            return partner["id"]
        if partner_name.strip():
            return conn.execute(
                "INSERT INTO corpora (name,lang,description,project_id) VALUES (?,?,?,?)",
                (partner_name.strip()[:120], termbase.other_lang(corpus["lang"]),
                 f"Translations of “{corpus['name']}”", corpus["project_id"])).lastrowid
    raise HTTPException(400, "Choose the partner corpus (partner_corpus_id) or name a new one (partner_name)")


@app.post("/api/corpora/{corpus_id}/upload-pairs", status_code=202)
async def upload_pairs(corpus_id: int, files: list[UploadFile] = File(...), partner_corpus_id: int | None = None,
                       partner_name: str = "", swap: bool = False, tags: str = "", text_type: str = "",
                       doc_date: str = "", author: str = "", force_language: bool = False):
    """Import aligned texts (TMX, XLIFF, or two-column .tsv/.csv/.docx table) into this corpus and a partner corpus of
    the other language: pass `partner_corpus_id`, or `partner_name` to create the partner corpus (same project).
    This corpus receives the first language / column, the partner the second (`swap` flips two-column files)."""
    meta = _meta(tags, text_type, doc_date, author)
    partner_id = _partner_corpus(corpus_id, partner_corpus_id, partner_name)
    if len(files) > ingest.MAX_UPLOAD_FILES:
        raise HTTPException(413, f"Too many files in one upload (limit {ingest.MAX_UPLOAD_FILES})")
    results = []
    for f in files:
        name = f.filename or "file"
        data = await f.read(ingest.MAX_UPLOAD_BYTES + 1)
        if len(data) > ingest.MAX_UPLOAD_BYTES:
            results.append({"file": name, "ok": False, "error": "File is larger than "
                            f"{ingest.MAX_UPLOAD_BYTES // 1024 // 1024} MB (set MAX_UPLOAD_MB to change)"})
            continue
        job = importer.submit(corpus_id, "import", name, parallel.import_pairs(
            corpus_id, partner_id, name, data, swap, meta, force_language))
        results.append({"file": name, "ok": True, "job_id": job.id, "partner_corpus_id": partner_id})
    return results


class LookupIn(BaseModel):
    text: str = Field(max_length=segmentlookup.MAX_QUERY_CHARS * 2)
    min_percent: int = Field(default=50, ge=10, le=100)
    limit: int = Field(default=10, ge=1, le=50)


@app.post("/api/corpora/{corpus_id}/segment-lookup")
def segment_lookup(corpus_id: int, body: LookupIn, sq: ScopeQuery = Depends()):
    """Paste a source segment, get the most similar source segments of this corpus's aligned documents, each with
    a match percentage (token-level edit distance: 100 only for identical words; case, punctuation and inline tags
    ignored), its band (100, 95-99, 85-94, 75-84, below 75), the aligned translation and the word-level
    difference (`extra`: in the stored segment only, `missing`: in your segment only). A lookup aid, not a CAT
    tool's match: see docs in the README."""
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        return _run(segmentlookup.lookup, conn, sq.scope(corpus_id), corpus["lang"], body.text, body.min_percent,
                    body.limit)


@app.get("/api/corpora/{corpus_id}/related")
def related_terms(corpus_id: int, q: str, source: str = "corpus", pos: str | None = None,
                  limit: int = Query(20, ge=1, le=100), with_base: bool = False, sq: ScopeQuery = Depends()):
    """Statistical "related terms" for a lemma: the words that keep similar company. `source=corpus` trains word
    vectors on this corpus (PPMI + SVD; `with_base=true` adds the language's base corpus); `source=model` uses the
    vectors of the spaCy md/lg model (general language; none in sm); `both` gives the two lists. Nothing is added
    to the termbase. The answer says what each source could do (`sources`) so a screen can explain an empty list."""
    if source not in ("corpus", "model", "both"):
        raise HTTPException(400, "source must be corpus, model or both")
    lemma = " ".join(q.lower().split())
    if not lemma:
        raise HTTPException(400, "Type a word (lemma)")
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        lang = corpus["lang"]
        wanted = {p.strip().upper() for p in pos.split(",") if p.strip()} if pos else None
        out: dict = {"query": lemma, "sources": {}, "related": {}}
        if source in ("corpus", "both"):
            emb = related.embedding(conn, sq.scope(corpus_id), lang, with_base)
            if emb is None:
                out["sources"]["corpus"] = {"trained": False, "tokens": 0, "small": True,
                                            "reason": "There is too little text to learn from (at least a few "
                                                      "thousand words, with words that repeat)"}
                out["related"]["corpus"] = []
            else:
                known = lemma in emb.index
                out["sources"]["corpus"] = {
                    "trained": True, "tokens": emb.tokens, "vocabulary": len(emb.lemmas),
                    "small": emb.tokens < related.SMALL_CORPUS, "known": known,
                    "reason": "" if known else f"“{lemma}” is too rare in this corpus to have a vector "
                                               f"(it needs {related.MIN_FREQ} occurrences and a place among the "
                                               f"{related.MAX_VOCAB} most frequent content words)"}
                out["related"]["corpus"] = emb.neighbours(lemma, limit, wanted) if known else []
        if source in ("model", "both"):
            info = related.available(lang)
            found = None
            if info["available"]:
                found = related.model_neighbours(nlp.load_model(lang), lemma, limit)
            out["sources"]["model"] = {**info, "known": found is not None,
                                       "reason": "" if found is not None else (
                                           "The spaCy model in use has no word vectors (use the md or lg model)"
                                           if not info["available"] else f"The model does not know “{lemma}”")}
            out["related"]["model"] = found or []
    return out


@app.get("/api/corpora/{corpus_id}/aligned-partners")
def aligned_partners(corpus_id: int, sq: ScopeQuery = Depends()):
    """The corpora that hold translations of this corpus's aligned documents (what a TMX export can pair it with)."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        return tmxexport.partners(conn, corpus_id, sq.scope(corpus_id))


@app.get("/api/corpora/{corpus_id}/export-tmx")
def export_tmx(corpus_id: int, partner_corpus_id: int | None = None, markup: bool = True,
               sq: ScopeQuery = Depends()):
    """Download this corpus and its aligned partner as a TMX 1.4b translation memory (this corpus's language is the
    source language). `partner_corpus_id` is needed when the aligned documents have several partner corpora;
    `markup=false` leaves out the inline markup kept from imported TMX files; the document filter narrows the
    documents. Each unit carries its document's title, source, type, date, author and tags as properties."""
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        scope = sq.scope(corpus_id)
        found = tmxexport.partners(conn, corpus_id, scope)
        if not found:
            raise HTTPException(409, "This corpus has no aligned documents (in the selected documents) to export")
        if partner_corpus_id is None:
            if len(found) > 1:
                raise HTTPException(400, "Several corpora hold translations; choose one with partner_corpus_id: "
                                    + ", ".join(f"{p['id']} ({p['name']})" for p in found))
            partner_corpus_id = found[0]["id"]
        elif partner_corpus_id not in {p["id"] for p in found}:
            raise HTTPException(400, "That corpus holds no translations of these documents")
        project = ""
        if corpus["project_id"]:
            row = conn.execute("SELECT name FROM projects WHERE id=?", (corpus["project_id"],)).fetchone()
            project = row["name"] if row else ""
        body, stats = tmxexport.to_tmx(conn, corpus_id, partner_corpus_id, scope, markup, project)
    name = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in corpus["name"]).strip("-") or "memory"
    return Response(body, media_type="application/x-tmx+xml; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="{name}.tmx"',
        "X-Colloca-Units": str(stats["units"]), "X-Colloca-Skipped-Documents": str(stats["skipped_documents"])})


class AlignLink(BaseModel):
    src: list[str] = Field(max_length=200)
    tgt: list[str] = Field(max_length=200)
    low: bool = False


class AlignConfirm(BaseModel):
    links: list[AlignLink] = Field(max_length=100_000)
    title: str = Field(default="", max_length=200)
    partner_corpus_id: int | None = None
    partner_name: str = ""
    tags: str = ""
    text_type: str = ""
    doc_date: str = ""
    author: str = ""
    force_language: bool = False


async def _read_upload(f: UploadFile) -> dict:
    data = await f.read(ingest.MAX_UPLOAD_BYTES + 1)
    if len(data) > ingest.MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"{f.filename or 'file'} is larger than {ingest.MAX_UPLOAD_BYTES // 1024 // 1024} MB "
                                 "(set MAX_UPLOAD_MB to change)")
    try:
        return await run_in_threadpool(ingest.read_file, f.filename or "file", data)
    except ingest.IngestError as exc:
        raise HTTPException(400, f"{f.filename or 'file'}: {exc}") from exc


@app.post("/api/corpora/{corpus_id}/align/propose")
async def align_propose(corpus_id: int, source: UploadFile = File(...), target: UploadFile = File(...)):
    """Align a document (this corpus's language) with its translation (the other language). Only proposes:
    nothing is stored until `/align/confirm`. Paragraph breaks of the files are used as anchors."""
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
    if corpus["is_reference"]:
        raise HTTPException(400, "A base corpus cannot hold aligned texts")
    src_lang, tgt_lang = corpus["lang"], termbase.other_lang(corpus["lang"])
    a, b = await _read_upload(source), await _read_upload(target)
    links = await run_in_threadpool(align.propose, a["text"], b["text"], src_lang, tgt_lang)
    return {"title": a["title"], "source_lang": src_lang, "target_lang": tgt_lang,
            "links": [{"src": lk.src, "tgt": lk.tgt, "type": lk.type, "confidence": lk.confidence, "low": lk.low}
                      for lk in links],
            "report": align.links_report(links)}


@app.post("/api/corpora/{corpus_id}/align/confirm", status_code=202)
def align_confirm(corpus_id: int, body: AlignConfirm):
    """Store the reviewed links as an aligned document pair (a background job, like any aligned import).
    Merged sentences become one segment; links with an empty side are not stored (counted in the report)."""
    meta = _meta(body.tags, body.text_type, body.doc_date, body.author)
    pairs, rep = align.confirm_pairs([(lk.src, lk.tgt, lk.low) for lk in body.links])
    if not pairs:
        raise HTTPException(400, "No link has a text on both sides, nothing to store")
    partner_id = _partner_corpus(corpus_id, body.partner_corpus_id, body.partner_name)
    title = body.title.strip() or "Aligned documents"
    work = parallel.import_pairs(corpus_id, partner_id, f"{title}.align", b"", False, meta, body.force_language,
                                 preread=pairs)

    def run(job: importer.Job) -> dict:
        return {**work(job), "report": rep}
    job = importer.submit(corpus_id, "import", title, run)
    return {"job_id": job.id, "partner_corpus_id": partner_id, "report": rep}


@app.get("/api/corpora/{corpus_id}/parallel")
def parallel_info(corpus_id: int):
    """Aligned documents of this corpus and the corpora holding their translations."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        row = conn.execute(f"""SELECT COUNT(*) AS docs, COALESCE(SUM(s.n),0) AS segments FROM documents d
                              LEFT JOIN (SELECT doc_id, COUNT(*) AS n FROM segments GROUP BY doc_id) s ON s.doc_id=d.id
                              WHERE d.corpus_id=? AND d.deleted_at IS NULL AND d.segmented=1
                                AND {analysis.PARTNER_LIVE.format(a='d')}""",
                           (corpus_id,)).fetchone()
        partners = conn.execute("""SELECT DISTINCT c.id, c.name, c.lang FROM documents d
                                   JOIN documents p ON p.id=d.pair_doc_id JOIN corpora c ON c.id=p.corpus_id
                                   WHERE d.corpus_id=? AND d.deleted_at IS NULL AND p.deleted_at IS NULL
                                     AND c.deleted_at IS NULL ORDER BY c.name""", (corpus_id,)).fetchall()
        return {"documents": row["docs"], "segments": row["segments"], "partners": [dict(r) for r in partners]}


@app.get("/api/corpora/{corpus_id}/bilingual")
def bilingual(corpus_id: int, q: str, unit: str = "lemma", width: int = Query(8, le=40),
              limit: int = Query(300, ge=1, le=2000), sort: str = "doc", format: str = "json",
              case_sensitive: bool = False, any_order: bool = False, sample: int | None = None,
              advanced: bool = False, accent_insensitive: bool = False, sq: ScopeQuery = Depends()):
    """Concordance over aligned documents, each hit with its segment and the aligned translation."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        res = _run(parallel.bilingual_concordance, conn, sq.scope(corpus_id), q, unit, width, limit, sort,
                   case_sensitive, any_order, sample, advanced, accent_insensitive)
    if format == "csv":
        hidden = ("pos", "doc_id", "span", "matches", "source_marks", "target_marks", "source_terms", "target_terms")
        return _reply([{k: v for k, v in ln.items() if k not in hidden} for ln in res["lines"]],
                      format, "bilingual")
    return res


@app.get("/api/corpora/{corpus_id}/equivalents")
def equivalents(corpus_id: int, q: str, unit: str = "lemma", min_freq: int = 2, exclude_stop: bool = True,
                pos: str | None = None, limit: int = Query(100, le=1000), format: str = "json",
                sq: ScopeQuery = Depends()):
    """Candidate translations of a word or phrase, from the aligned segments of its occurrences."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        res = _run(parallel.equivalents, conn, sq.scope(corpus_id), q, unit, min_freq, exclude_stop,
                   _pos_list(pos), limit)
    return _reply(res["rows"], format, "equivalents") if format == "csv" else res


@app.get("/api/corpora/{corpus_id}/jobs")
def list_jobs(corpus_id: int):
    return importer.jobs_for(corpus_id)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: int):
    job = importer.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return asdict(job)


class ResolveIn(BaseModel):
    action: Literal["import", "replace", "skip"]


@app.post("/api/jobs/{job_id}/resolve", status_code=202)
def resolve_job(job_id: int, body: ResolveIn):
    """Decide a held import (a job that failed with code `near_duplicate`): import it anyway, replace the
    older document, or skip it. Import and replace queue a new job and answer `{job_id}`."""
    job = importer.resolve_near_duplicate(job_id, body.action)
    if not job:
        raise HTTPException(404, "Nothing is waiting for a decision on this job (the server may have restarted)")
    return {"job_id": job.id}


@app.get("/api/corpora/{corpus_id}/near-duplicates")
def near_duplicates(corpus_id: int, threshold: float = Query(dedup.THRESHOLD, ge=0.5, le=1.0)):
    """Pairs of documents of this corpus whose wording overlaps at least `threshold` (0.5 to 1). Documents
    imported before fingerprints existed are fingerprinted on the first call."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        return dedup.report(conn, corpus_id, threshold)


@app.post("/api/corpora/{corpus_id}/analyse-job", status_code=202)
async def analyse_job(corpus_id: int, file: UploadFile | None = File(None), text: str = Form(""),
                      min_freq: int = Query(2, ge=1), min_corpus_freq: int = Query(3, ge=1),
                      force_language: bool = False, keep_text: bool = False, leverage: bool = False,
                      sq: ScopeQuery = Depends()):
    """Analyse a text you are about to translate (an uploaded file, or `text`) against this corpus and its
    project's termbase. Runs as a job; fetch the report from GET /api/jobs/{id}/result. Nothing is stored unless
    you save the report (POST /api/jobs/{id}/save); the analysed text is kept with a saved report only when
    `keep_text=true` was sent here. `leverage=true` adds a rough figure of how much of the text the aligned documents
    of the corpus already translate (`summary.leverage`, see segmentlookup.py)."""
    with db.session() as conn:
        corpus = dict(_corpus(conn, corpus_id))
    if corpus["is_reference"]:
        raise HTTPException(400, "Pick one of your own corpora, not a base corpus")
    scope = sq.scope(corpus_id)
    if file is not None and file.filename:
        data = await file.read(ingest.MAX_UPLOAD_BYTES + 1)
        if len(data) > ingest.MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"File is larger than {ingest.MAX_UPLOAD_BYTES // 1024 // 1024} MB")
        name = file.filename
    elif text.strip():
        data, name = None, "pasted text"
    else:
        raise HTTPException(400, "Upload a file or paste the text to analyse")
    params = {"min_freq": min_freq, "min_corpus_freq": min_corpus_freq, "force_language": force_language,
              "leverage": leverage,
              "tags": list(scope.tags), "text_type": scope.text_type, "date_from": scope.date_from,
              "date_to": scope.date_to, "docs": list(scope.doc_ids)}

    def work(job):
        parsed = ingest.read_file(name, data, corpus["lang"], progress=lambda f: job.set_progress(f * 0.5)) \
            if data is not None else {"text": text, "warnings": []}
        body = parsed["text"]
        with db.session() as conn:
            job.payload = jobanalysis.analyse(conn, scope, corpus, body, min_freq=min_freq,
                                              min_corpus_freq=min_corpus_freq, force_language=force_language,
                                              leverage=leverage, progress=job.set_progress)
        job.meta = {"source": "" if data is None else name, "params": params}
        job.text = body if keep_text else None
        return {"summary": job.payload["summary"], "warnings": parsed["warnings"]}
    job = importer.submit(corpus_id, "analysis", name, work)
    return {"job_id": job.id}


_JOB_SECTIONS = ("key_terms", "gaps", "known_terms", "phrases")


def _annotated_report(payload: dict, corpus_id: int) -> dict:
    """The report with `in_termbase` / `dropped` on its candidate tables, as of now (the termbase and the stop
    list may have changed since the analysis ran)."""
    report = dict(payload)
    with db.session() as conn:
        corpus = conn.execute("SELECT * FROM corpora WHERE id=?", (corpus_id,)).fetchone()
        if corpus:
            for name in ("key_terms", "gaps", "phrases"):
                report[name] = candidates.annotate(conn, corpus, [dict(r) for r in report[name]])
    return report


def _report_reply(payload: dict, corpus_id: int, section: str, fmt: str, title: str, source: str):
    """Shared by a finished job and a saved report: the whole report as JSON or one workbook (`format=xlsx`),
    or one table as JSON or CSV (`section`)."""
    if not section:
        if fmt == "xlsx":
            media, ext = _EXPORTS["xlsx"]
            body = jobreports.to_xlsx(payload, title, source)
            return Response(body, media_type=media, headers={"Content-Disposition": 'attachment; '
                                                             f'filename="job-report.{ext}"'})
        return _annotated_report(payload, corpus_id)
    if section not in _JOB_SECTIONS:
        raise HTTPException(400, f"section must be one of {', '.join(_JOB_SECTIONS)}")
    rows = payload[section]
    if section == "known_terms":
        rows = [{"term": r["item"], "occurrences": r["occurrences"], "example": r["example"],
                 "translations": "; ".join(f"{t['term'] or '—'} [{t['status']}]" for t in r["translations"])}
                for r in rows]
    return _reply(rows, fmt, section)


@app.get("/api/jobs/{job_id}/result")
def job_result(job_id: int, section: str = "", format: str = "json"):
    """The report of an analysis job; `section` + `format=csv` downloads one table, `format=xlsx` the whole
    report as one workbook."""
    job = importer.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status != "done" or job.payload is None:
        raise HTTPException(409, "The job has no result (yet)")
    meta = job.meta or {}
    return _report_reply(job.payload, job.corpus_id, section, format, job.label, meta.get("source", ""))


class ReportSave(BaseModel):
    title: str = Field(default="", max_length=200)


@app.post("/api/jobs/{job_id}/save")
def save_report(job_id: int, body: ReportSave):
    """Keep the report of a finished analysis (with the analysed text only if `keep_text` was asked when it ran)
    so it can be reopened after a restart. Saving twice returns the same report."""
    job = importer.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status != "done" or job.payload is None:
        raise HTTPException(409, "The job has no result (yet)")
    with db.session() as conn:
        corpus = conn.execute("SELECT id FROM corpora WHERE id=? AND deleted_at IS NULL", (job.corpus_id,)).fetchone()
        if not corpus:
            raise HTTPException(404, "Corpus not found")
        if job.report_id is not None and jobreports.get(conn, job.report_id):
            return {"id": job.report_id, "saved_before": True}
        meta = job.meta or {}
        source = meta.get("source", "")
        title = body.title.strip() or f"{source or 'Pasted text'} · {time.strftime('%Y-%m-%d %H:%M')}"
        job.report_id = jobreports.save(  # type: ignore[misc]   # per-job attribute, see importer.Job
            conn, job.corpus_id, job.payload, title, source, meta.get("params", {}), job.text)
    return {"id": job.report_id, "saved_before": False}


def _stored_report(conn, report_id: int):
    row = jobreports.get(conn, report_id)
    if not row:
        raise HTTPException(404, "Report not found")
    return row


@app.get("/api/corpora/{corpus_id}/reports")
def list_reports(corpus_id: int):
    """The saved job reports of this corpus, newest first."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        return jobreports.listing(conn, corpus_id)


@app.get("/api/reports/{report_id}/result")
def report_result(report_id: int, section: str = "", format: str = "json"):
    """A saved report, as GET /api/jobs/{id}/result gives it (the table flags are as of now), plus `title`,
    `source`, `created` and `has_text`."""
    with db.session() as conn:
        row = _stored_report(conn, report_id)
    payload = json.loads(row["payload"])
    res = _report_reply(payload, row["corpus_id"], section, format, row["title"], row["source"])
    if isinstance(res, dict):
        res.update({"report_id": row["id"], "title": row["title"], "source": row["source"],
                    "created": row["created"], "has_text": row["text"] is not None,
                    "params": json.loads(row["params"])})
    return res


@app.get("/api/reports/{report_id}/text")
def report_text(report_id: int):
    """The analysed text, if it was kept with the report."""
    with db.session() as conn:
        row = _stored_report(conn, report_id)
        if row["text"] is None:
            raise HTTPException(404, "The text was not kept with this report")
        lang = conn.execute("SELECT lang FROM corpora WHERE id=?", (row["corpus_id"],)).fetchone()["lang"]
    return {"text": row["text"], "lang": lang}


@app.delete("/api/reports/{report_id}", status_code=204)
def delete_report(report_id: int):
    """Delete a saved report for good, with the text kept in it."""
    with db.session() as conn:
        _stored_report(conn, report_id)
        jobreports.delete(conn, report_id)
    return Response(status_code=204)


@app.post("/api/corpora/{corpus_id}/reannotate", status_code=202)
def reannotate(corpus_id: int, only_stale: bool = True):
    """Re-run the current NLP model over the stored texts (all documents, or just outdated ones)."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
    job = importer.submit(corpus_id, "reannotate", "Re-annotate documents",
                          importer.reannotate_corpus(corpus_id, only_stale))
    return {"job_id": job.id}


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: int):
    with db.session() as conn:
        row = conn.execute("""SELECT d.* FROM documents d JOIN corpora c ON c.id=d.corpus_id
                              WHERE d.id=? AND d.deleted_at IS NULL AND c.deleted_at IS NULL""", (doc_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Document not found")
        tags = [r[0] for r in conn.execute("SELECT tag FROM doc_tags WHERE doc_id=? ORDER BY tag", (doc_id,))]
        doc = dict(row)
        doc.pop("fingerprint")      # internal: a binary sketch, not for the API
        return {**doc, "tags": tags}


@app.get("/api/documents/{doc_id}/context")
def document_context(doc_id: int, pos: int = Query(ge=0), span: int = Query(1, ge=1, le=200),
                     radius: int = Query(3, ge=0, le=docview.MAX_RADIUS)):
    """The text around the token at `pos`: `radius` sentences (or aligned segments, with their translations)
    on each side, the hit marked by character offsets, and the document's metadata. For 'open the document
    at this hit' without downloading the whole text."""
    with db.session() as conn:
        try:
            return docview.context(conn, doc_id, pos, span, radius)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc


@app.patch("/api/documents/{doc_id}")
def update_document(doc_id: int, body: DocPatch):
    """Edit a document's title and metadata (only the fields you send are changed)."""
    sent = body.model_fields_set
    with db.session() as conn:
        row = conn.execute("""SELECT d.* FROM documents d JOIN corpora c ON c.id=d.corpus_id
                              WHERE d.id=? AND d.deleted_at IS NULL AND c.deleted_at IS NULL""", (doc_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Document not found")
        if "title" in sent and body.title:
            conn.execute("UPDATE documents SET title=? WHERE id=?", (body.title.strip(), doc_id))
        meta = _meta(body.tags if "tags" in sent else None,
                     (body.text_type if "text_type" in sent else row["text_type"]) or "",
                     (body.doc_date if "doc_date" in sent else row["doc_date"]) or "",
                     (body.author if "author" in sent else row["author"]) or "")
        conn.execute("UPDATE documents SET text_type=?, doc_date=?, author=? WHERE id=?",
                     (meta["text_type"], meta["doc_date"], meta["author"], doc_id))
        if "tags" in sent:
            metadata.set_tags(conn, doc_id, meta["tags"])
    return {"ok": True}


@app.delete("/api/documents/{doc_id}", status_code=204)
def delete_document(doc_id: int):
    """Moves the document to the Trash (its metadata and aligned-partner link are kept for a restore)."""
    with db.session() as conn:
        trash.trash_documents(conn, [doc_id])


@app.get("/api/corpora/{corpus_id}/facets")
def facets(corpus_id: int):
    """The metadata values present in a corpus, to build filters."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        tags = conn.execute("""SELECT g.tag AS tag, COUNT(*) AS docs FROM doc_tags g JOIN documents d ON d.id=g.doc_id
                               WHERE d.corpus_id=? AND d.deleted_at IS NULL
                               GROUP BY g.tag ORDER BY docs DESC, tag""", (corpus_id,))
        types = conn.execute("""SELECT text_type, COUNT(*) AS docs FROM documents
                                WHERE corpus_id=? AND deleted_at IS NULL AND text_type<>''
                                GROUP BY text_type ORDER BY docs DESC, text_type""", (corpus_id,))
        dates = conn.execute("""SELECT MIN(doc_date), MAX(doc_date) FROM documents
                                WHERE corpus_id=? AND deleted_at IS NULL AND doc_date<>''""", (corpus_id,)).fetchone()
        return {"tags": [dict(r) for r in tags], "text_types": [dict(r) for r in types],
                "date_min": dates[0] or "", "date_max": dates[1] or ""}


@app.get("/api/corpora/{corpus_id}/scope")
def scope_info(corpus_id: int, sq: ScopeQuery = Depends()):
    """How many documents and words a filter selects (the size every analysis will then use)."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        scope = sq.scope(corpus_id)
        return {"filtered": scope.filtered, "docs": analysis.n_docs(conn, scope),
                "words": analysis.corpus_size(conn, scope),
                "total_docs": analysis.n_docs(conn, corpus_id), "total_words": analysis.corpus_size(conn, corpus_id)}


# --------------------------------------------------------------------------- analyses
@app.get("/api/corpora/{corpus_id}/frequency")
def frequency(corpus_id: int, unit: str = "lemma", pos: str | None = None, min_freq: int = 1,
              exclude_stop: bool = True, limit: int = Query(500, le=5000), format: str = "json",
              with_reference: bool = False, sq: ScopeQuery = Depends()):
    """`with_reference=true` adds ref_freq / ref_per_million from the language's base corpus."""
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        ref_id = _base_corpus_id(conn, corpus) if with_reference else None
        rows = _run(analysis.frequency, conn, sq.scope(corpus_id), unit, _pos_list(pos), min_freq,
                    exclude_stop, True, limit)
        if ref_id:
            analysis.add_reference_columns(conn, rows, ref_id, unit)
        if format != "csv":
            candidates.annotate(conn, corpus, rows)
    return _reply(rows, format, "frequency")


@app.get("/api/query/explain")
def explain_query(q: str, unit: str = "lemma", case_sensitive: bool = False, advanced: bool = False,
                  accent_insensitive: bool = False):
    """The query in words, or `ok: false` with the message and the 1-based `position` of the mistake."""
    try:
        return {"ok": True, "parsed": analysis.explain(q, unit, case_sensitive, advanced, accent_insensitive)}
    except ValueError as exc:
        return {"ok": False, "error": str(exc), "position": getattr(exc, "position", None)}


@app.get("/api/corpora/{corpus_id}/concordance")
def concordance(corpus_id: int, q: str, unit: str = "lemma", width: int = Query(8, le=40),
                limit: int = Query(300, ge=1, le=2000), sort: str = "doc", format: str = "json",
                case_sensitive: bool = False, any_order: bool = False, sample: int | None = None,
                advanced: bool = False, accent_insensitive: bool = False, sq: ScopeQuery = Depends()):
    """`case_sensitive` matches the written form; `*` starts or ends a word (contrat*, *miento); `any_order`
    finds the words anywhere in one sentence; `sample=<seed>` returns a reproducible random selection of
    `limit` hits; `sort` is doc, left, right, or l1 l2 r1 r2 (the 1st/2nd word to the left/right).
    `advanced=true` reads `q` as a token query (regex, lemma/pos conditions, `|`, gaps; docs/analysis.md, "Advanced query language")
    and returns it in words as `parsed`; `accent_insensitive=true` makes `cafe` find `café`."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        res = _run(analysis.concordance, conn, sq.scope(corpus_id), q, unit, width, limit, sort,
                   case_sensitive, any_order, sample, advanced, accent_insensitive)
        termhits.mark_kwic(conn, corpus_id, res["lines"], width)
    if format == "csv":
        hidden = ("pos", "matches", "span", "left_terms", "node_terms", "right_terms")
        return _reply([{k: v for k, v in ln.items() if k not in hidden} for ln in res["lines"]],
                      format, "concordance")
    return res


@app.get("/api/corpora/{corpus_id}/dispersion")
def dispersion(corpus_id: int, q: str, unit: str = "lemma", format: str = "json", case_sensitive: bool = False,
               any_order: bool = False, advanced: bool = False, accent_insensitive: bool = False,
               sq: ScopeQuery = Depends()):
    """Where a query occurs across the documents (a "plot"): per document the hit count, the figure per million
    words and the relative position of each hit. Takes the same query options as the concordance, so the
    counts match it; documents without a hit are listed too. CSV: one row per document."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        res = _run(analysis.dispersion, conn, sq.scope(corpus_id), q, unit, case_sensitive, any_order, advanced,
                   accent_insensitive)
    if format == "csv":
        return _reply([{k: v for k, v in d.items() if k not in ("marks", "length")} for d in res["docs"]],
                      format, "dispersion")
    return res


@app.get("/api/corpora/{corpus_id}/collocations")
def collocations(corpus_id: int, q: str, left: int = Query(4, ge=0, le=15),
                 right: int = Query(4, ge=0, le=15), min_freq: int = 2, exclude_stop: bool = True,
                 pos: str | None = None, limit: int = Query(200, le=2000), format: str = "json",
                 with_reference: bool = False, sq: ScopeQuery = Depends()):
    """`with_reference=true` adds the collocate's ref_freq / ref_per_million from the base corpus."""
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        ref_id = _base_corpus_id(conn, corpus) if with_reference else None
        res = _run(analysis.collocations, conn, sq.scope(corpus_id), q, left, right, min_freq,
                   exclude_stop, _pos_list(pos), limit)
        if ref_id:
            analysis.add_reference_columns(conn, res["rows"], ref_id, "lemma")
        if format != "csv":
            candidates.annotate(conn, corpus, res["rows"])
    return _reply(res["rows"], format, "collocations") if format == "csv" else res


@app.get("/api/corpora/{corpus_id}/ngrams")
def ngrams(corpus_id: int, n: int = 3, unit: str = "form", min_freq: int = 2, min_docs: int = 1,
           edge_stop: bool = False, limit: int = Query(300, le=3000), format: str = "json",
           sq: ScopeQuery = Depends()):
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        rows = _run(analysis.ngrams, conn, sq.scope(corpus_id), n, unit, min_freq, min_docs, edge_stop, limit)
        if format != "csv":
            candidates.annotate(conn, corpus, rows)
    return _reply(rows, format, "ngrams")


@app.get("/api/corpora/{corpus_id}/keyness")
def keyness(corpus_id: int, ref: int | None = None, unit: str = "lemma", min_freq: int = 3,
            exclude_stop: bool = True, pos: str | None = None,
            both_directions: bool = False,
            limit: int = Query(300, le=3000), format: str = "json", sq: ScopeQuery = Depends()):
    """Compare (the selected documents of) this corpus with `ref`, or, when omitted, with the language's
    base corpus. The filter narrows the studied corpus only, never the reference. `both_directions` also
    lists the words found only in the reference (under-used), each row tagged with `direction`."""
    with db.session() as conn:
        c = _corpus(conn, corpus_id)
        if ref is None:
            ref = _base_corpus_id(conn, c)
        elif ref == corpus_id:
            raise HTTPException(400, "A corpus cannot be compared with itself")
        elif _corpus(conn, ref)["lang"] != c["lang"]:
            raise HTTPException(400, "Reference corpus must have the same language")
        rows = _run(analysis.keyness, conn, sq.scope(corpus_id), ref, unit, min_freq, exclude_stop,
                    _pos_list(pos), limit, both_directions)
        if format != "csv":
            candidates.annotate(conn, c, rows)
    return _reply(rows, format, "keyness")


# --------------------------------------------------------------------------- examples & termbase
@app.get("/api/corpora/{corpus_id}/examples")
def examples(corpus_id: int, q: str, unit: str = "lemma", limit: int = Query(5, ge=1, le=20),
             sq: ScopeQuery = Depends()):
    """Whole sentences containing a word or phrase: candidates for a term's example sentence."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        return _run(analysis.examples, conn, sq.scope(corpus_id), q, unit, limit)


# --- candidate review: the stop list (T02)
class RejectionIn(BaseModel):
    terms: list[str] = Field(min_length=1, max_length=5000)


@app.get("/api/corpora/{corpus_id}/rejections")
def list_rejections(corpus_id: int):
    """Terms dropped from this corpus's project and language (the stop list)."""
    with db.session() as conn:
        return candidates.list_rejections(conn, _corpus(conn, corpus_id))


@app.post("/api/corpora/{corpus_id}/rejections")
def reject_terms(corpus_id: int, body: RejectionIn):
    with db.session() as conn:
        return {"added": candidates.reject(conn, _corpus(conn, corpus_id), body.terms)}


@app.post("/api/corpora/{corpus_id}/rejections/restore")
def restore_terms(corpus_id: int, body: RejectionIn):
    with db.session() as conn:
        return {"restored": candidates.restore(conn, _corpus(conn, corpus_id), body.terms)}


@app.post("/api/corpora/{corpus_id}/term-status")
def term_status(corpus_id: int, body: RejectionIn):
    """`in_termbase` and `dropped` for arbitrary terms (candidates kept on the client)."""
    with db.session() as conn:
        rows = [{"item": t} for t in body.terms]
        return candidates.annotate(conn, _corpus(conn, corpus_id), rows)


class TermIn(BaseModel):
    project_id: int | None = None
    src_lang: str
    tgt_lang: str = ""
    src_term: str
    tgt_term: str = ""
    pos: str = ""
    status: str = "candidate"
    domain: str = ""
    definition: str = ""
    notes: str = ""
    context: str = ""
    context_source: str = ""
    origin: str = "manual"
    concept_id: int | None = None      # join this concept as a synonym (same project and language pair)
    src_gender: str = ""
    src_number: str = ""
    tgt_gender: str = ""
    tgt_number: str = ""
    src_note: str = ""
    tgt_note: str = ""


class TermPatch(BaseModel):
    src_term: str | None = None
    tgt_term: str | None = None
    pos: str | None = None
    status: str | None = None
    domain: str | None = None
    definition: str | None = None
    notes: str | None = None
    context: str | None = None
    context_source: str | None = None
    src_gender: str | None = None
    src_number: str | None = None
    tgt_gender: str | None = None
    tgt_number: str | None = None
    src_note: str | None = None
    tgt_note: str | None = None


_TERM_CONFLICT = "This term and translation are already in the termbase"


def _term_error(exc: Exception) -> HTTPException:
    return HTTPException(400, str(exc))


@app.get("/api/terms")
def list_terms(project: str = "", src_lang: str = "", tgt_lang: str = "", status: str = "", q: str = "",
               limit: int = Query(5000, le=20000), sort: str = "", dir: str = "asc", domain: str = "",
               pos: str = "", modified_since: str = ""):
    """Termbase entries. project: '' (all), 'none' (general termbase) or a project id. status: comma list.
    sort: a column name (src_term, tgt_term, pos, status, domain, updated...), dir: asc or desc;
    domain, pos and modified_since (YYYY-MM-DD) filter."""
    try:
        with db.session() as conn:
            return termbase.list_terms(conn, project, src_lang, tgt_lang,
                                       tuple(x for x in status.split(",") if x), q, limit, sort=sort,
                                       desc=dir == "desc", domain=domain, pos=pos, modified_since=modified_since)
    except termbase.TermError as exc:
        raise _term_error(exc) from exc


@app.post("/api/terms", status_code=201)
def create_term(body: TermIn):
    try:
        entry = termbase.clean(body.model_dump(exclude={"project_id", "concept_id"}))
        termbase.check_consistency(entry)
    except termbase.TermError as exc:
        raise _term_error(exc) from exc
    with db.session() as conn:
        if body.project_id is not None:
            _project(conn, body.project_id)
        termbase.drop_trashed_twin(conn, body.project_id, entry["src_lang"], entry["tgt_lang"], entry["src_term"],
                                   entry["tgt_term"])
        try:
            concept = termbase.assign_concept(conn, body.project_id, entry["src_lang"], entry["tgt_lang"],
                                              entry["src_term"], body.concept_id)
        except termbase.TermError as exc:
            raise _term_error(exc) from exc
        try:
            cur = conn.execute(
                """INSERT INTO terms (project_id,src_lang,tgt_lang,src_term,tgt_term,pos,status,domain,definition,
                                      notes,context,context_source,origin,concept_id,src_gender,src_number,
                                      tgt_gender,tgt_number,src_note,tgt_note)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (body.project_id, entry["src_lang"], entry["tgt_lang"], entry["src_term"], entry["tgt_term"],
                 entry.get("pos", ""), entry.get("status", "candidate"), entry.get("domain", ""),
                 entry.get("definition", ""), entry.get("notes", ""), entry.get("context", ""),
                 entry.get("context_source", ""), entry.get("origin", "manual"), concept,
                 entry.get("src_gender", ""), entry.get("src_number", ""), entry.get("tgt_gender", ""),
                 entry.get("tgt_number", ""), entry.get("src_note", ""), entry.get("tgt_note", "")))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, _TERM_CONFLICT) from exc
        return {"id": cur.lastrowid, "concept_id": concept}


class TermBulk(BaseModel):
    ids: list[int] = Field(max_length=20000)
    status: str | None = None
    domain: str | None = None


@app.patch("/api/terms")
def bulk_update_terms(body: TermBulk):
    """Set the status and/or domain of the selected entries (all or nothing)."""
    try:
        with db.session() as conn:
            return {"updated": termbase.bulk_update(conn, body.ids, status=body.status, domain=body.domain)}
    except termbase.TermError as exc:
        raise _term_error(exc) from exc


class TermIds(BaseModel):
    ids: list[int] = Field(max_length=20000)


@app.post("/api/terms/delete")
def bulk_delete_terms(body: TermIds):
    try:
        with db.session() as conn:
            return {"deleted": termbase.bulk_delete(conn, body.ids)}
    except termbase.TermError as exc:
        raise _term_error(exc) from exc


@app.patch("/api/terms/{term_id}")
def update_term(term_id: int, body: TermPatch):
    sent = {k: getattr(body, k) for k in body.model_fields_set}
    with db.session() as conn:
        row = conn.execute("SELECT * FROM terms WHERE id=? AND deleted_at IS NULL", (term_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Term not found")
        try:
            changes = termbase.clean(sent, partial=True)
            termbase.check_consistency({**dict(row), **changes})
            if "src_term" in changes and not changes["src_term"]:
                raise termbase.TermError("The source term is required")
        except termbase.TermError as exc:
            raise _term_error(exc) from exc
        if changes:
            cols = ", ".join(f"{k}=?" for k in changes)
            merged = {**dict(row), **changes}
            termbase.drop_trashed_twin(conn, row["project_id"], merged["src_lang"], merged["tgt_lang"],
                                       merged["src_term"], merged["tgt_term"], keep_id=term_id)
            try:
                conn.execute(f"UPDATE terms SET {cols}, updated=CURRENT_TIMESTAMP WHERE id=?",
                             [*changes.values(), term_id])
            except sqlite3.IntegrityError as exc:
                raise HTTPException(409, _TERM_CONFLICT) from exc
    return {"ok": True}


@app.delete("/api/terms/{term_id}", status_code=204)
def delete_term(term_id: int):
    """Moves the entry to the Trash."""
    with db.session() as conn:
        trash.trash_terms(conn, [term_id])


_EXPORTS = {"csv": ("text/csv; charset=utf-8", "csv"), "xlsx": (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"),
    "tbx": ("application/xml", "tbx"), "tbx2": ("application/xml", "tbx")}


@app.get("/api/terms/export")
def export_terms(format: str = "tbx", project: str = "", src_lang: str = "", tgt_lang: str = "",
                 status: str = "approved,admitted", ids: str = ""):
    """Download the termbase as `tbx` (ISO 30042:2019), `tbx2` (ISO 30042:2008, most CAT tools),
    `xlsx` or `csv`. By default approved and admitted entries; add `candidate` to status to include candidates.
    `ids=1,2,3` exports exactly those entries (any status), e.g. the glossary of an analysed job."""
    if format not in _EXPORTS:
        raise HTTPException(400, f"format must be one of {', '.join(_EXPORTS)}")
    try:
        with db.session() as conn:
            if ids:
                wanted = {int(x) for x in ids.split(",") if x.strip().isdigit()}
                rows = [r for r in termbase.list_terms(conn, project, src_lang, tgt_lang) if r["id"] in wanted]
            else:
                rows = termbase.list_terms(conn, project, src_lang, tgt_lang,
                                           tuple(x for x in status.split(",") if x))
    except termbase.TermError as exc:
        raise _term_error(exc) from exc
    if format == "csv":
        body = termexport.to_csv(rows).encode("utf-8")
    elif format == "xlsx":
        body = termexport.to_xlsx(rows)
    else:
        body = termexport.to_tbx(rows, 2 if format == "tbx2" else 3)
    media, ext = _EXPORTS[format]
    return Response(body, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="termbase.{ext}"'})


# --------------------------------------------------------------------------- glossary import (T03)
async def _import_input(file: UploadFile, project_id: int | None):
    data = await file.read(termimport.MAX_BYTES + 1)
    if project_id is not None:
        with db.session() as conn:
            _project(conn, project_id)
    return data, file.filename or ""


@app.post("/api/terms/import/preview")
async def import_preview(file: UploadFile = File(...)):
    """The first rows of a spreadsheet and a guessed column mapping (or just `kind: tbx`)."""
    data, name = await _import_input(file, None)
    try:
        return termimport.preview(data, name)
    except termimport.ImportFailure as exc:
        raise _term_error(exc) from exc


@app.post("/api/terms/import")
async def import_terms(file: UploadFile = File(...), dry_run: bool = Form(True), project_id: int | None = Form(None),
                       src_lang: str = Form(""), tgt_lang: str = Form(""), mapping: str = Form("{}"),
                       header: bool = Form(True), default_status: str = Form("candidate")):
    """Import a glossary (.xlsx, .csv, .tsv, .tbx). `dry_run` (the default) only reports what would be added,
    skipped as duplicates and rejected; send the same request with dry_run=false to store the new rows.
    `mapping` is JSON {field: column index (0-based)} for a spreadsheet; a TBX file needs none."""
    data, name = await _import_input(file, project_id)
    try:
        columns = json.loads(mapping or "{}")
        if not isinstance(columns, dict):
            raise ValueError
    except ValueError as exc:
        raise HTTPException(400, "mapping must be a JSON object {field: column index}") from exc
    try:
        with db.session() as conn:
            return termimport.run(conn, data, name, project_id=project_id, src_lang=src_lang, tgt_lang=tgt_lang,
                                  mapping=columns, header=header, default_status=default_status, dry_run=dry_run)
    except termimport.ImportFailure as exc:
        raise _term_error(exc) from exc


# --------------------------------------------------------------------------- check text (termbase hits)
class CheckTextIn(BaseModel):
    text: str = Field(max_length=termhits.MAX_CHECK_CHARS)
    lang: str = ""            # language of the text: the corpus's (a source segment) or the other (a draft translation)


@app.post("/api/corpora/{corpus_id}/check-text")
def check_text(corpus_id: int, body: CheckTextIn):
    """Mark the termbase hits of the corpus's project (and the general termbase) in a pasted source segment or
    draft translation, and flag forbidden translations. Returns the text per line with character offsets."""
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        lang = body.lang or corpus["lang"]
        if lang not in nlp.SUPPORTED:
            raise HTTPException(400, f"lang must be one of {', '.join(nlp.SUPPORTED)}")
        if not body.text.strip():
            raise HTTPException(400, "Paste the text to check")
        return termhits.check(conn, corpus["project_id"], lang, body.text)


_UI_MISSING = (
    "<!doctype html><meta charset=utf-8><title>Colloca</title>"
    "<h1>UI not built</h1><p>Run <code>mise run ui:build</code> and reload.</p>"
)


class _StaticApp:
    """Serves the built UI, or a 503 page when it is missing.

    STATIC is looked up per request so the check follows the directory's current state.
    """

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and not os.path.isfile(os.path.join(STATIC, "index.html")):
            await HTMLResponse(_UI_MISSING, status_code=503)(scope, receive, send)
            return
        await StaticFiles(directory=STATIC, html=True)(scope, receive, send)


# --------------------------------------------------------------------------- Trash
@app.get("/api/trash")
def list_trash():
    """Everything that was deleted and can still be restored (corpora, documents, terms) and the retention."""
    with db.session() as conn:
        trash.purge_expired(conn)
        return trash.listing(conn)


class TrashItems(BaseModel):
    kind: Literal["corpus", "document", "term"]
    ids: list[int] = Field(max_length=20000)


class TrashSettings(BaseModel):
    retention_days: int = Field(ge=0, le=trash.MAX_DAYS)


@app.put("/api/trash/settings")
def trash_settings(body: TrashSettings):
    """How long deleted items stay in the Trash (days; 0 = until emptied by hand)."""
    with db.session() as conn:
        return {"retention_days": trash.set_retention_days(conn, body.retention_days)}


@app.post("/api/trash/restore")
def restore_from_trash(body: TrashItems):
    try:
        with db.session() as conn:
            return {"restored": trash.restore(conn, body.kind, body.ids)}
    except trash.TrashError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.post("/api/trash/delete")
def delete_from_trash(body: TrashItems):
    """Permanently removes the chosen items (they must already be in the Trash). This cannot be undone."""
    try:
        with db.session() as conn:
            gone = trash.trashed_corpus_ids(conn, body.ids) if body.kind == "corpus" else []
            removed = trash.delete_forever(conn, body.kind, body.ids)
    except trash.TrashError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    for corpus_id in gone:
        importer.forget_jobs(corpus_id)
    return {"deleted": removed}


@app.delete("/api/trash")
def empty_trash(confirm: bool = False):
    """Permanently removes everything in the Trash; needs `confirm=true`."""
    if not confirm:
        raise HTTPException(400, "Emptying the Trash cannot be undone: pass confirm=true")
    with db.session() as conn:
        gone = [r[0] for r in conn.execute("SELECT id FROM corpora WHERE deleted_at IS NOT NULL")]
        removed = trash.empty(conn)
    for corpus_id in gone:
        importer.forget_jobs(corpus_id)
    return {"deleted": removed}


# --------------------------------------------------------------------------- backup and restore
def _zip_response(path: str, name: str) -> FileResponse:
    return FileResponse(path, media_type="application/zip", filename=name, background=BackgroundTask(os.unlink, path))


@app.get("/api/backup")
def backup_database(include_sqlite: bool = True):
    """The whole database as one zip: portable data.json (+ a consistent SQLite copy with tokens). Trash excluded."""
    with db.session() as conn:
        path = backup.write_zip(conn, None, with_db=include_sqlite)
    return _zip_response(path, f"colloca-backup-{time.strftime('%Y%m%d-%H%M%S')}.zip")


class EncryptedBackupIn(BaseModel):
    passphrase: str = Field(min_length=backupcrypt.MIN_PASSPHRASE, max_length=500)
    include_sqlite: bool = True
    project_id: int | None = None      # one project (no tokens) instead of the whole database


@app.post("/api/backup/encrypted")
def backup_encrypted(body: EncryptedBackupIn):
    """The same zip as GET /api/backup (or one project's export), encrypted with a passphrase (AES-256-GCM, see
    backupcrypt.py). A POST, so the passphrase is never in a URL or a log line. Import it with the same
    passphrase; there is no way to recover a backup whose passphrase is lost."""
    with db.session() as conn:
        if body.project_id is not None:
            _project(conn, body.project_id)
        plain = backup.write_zip(conn, body.project_id, with_db=body.include_sqlite and body.project_id is None)
    fd, path = tempfile.mkstemp(suffix=".enc", prefix="colloca-export-")
    os.close(fd)
    try:
        backupcrypt.encrypt_file(plain, path, body.passphrase)
    except Exception:
        os.unlink(path)
        raise
    finally:
        os.unlink(plain)
    name = f"colloca-{'project' if body.project_id is not None else 'backup'}-{time.strftime('%Y%m%d-%H%M%S')}.zip.enc"
    return FileResponse(path, media_type="application/octet-stream", filename=name,
                        background=BackgroundTask(os.unlink, path))


@app.get("/api/projects/{project_id}/export")
def export_project(project_id: int):
    """One project (its corpora, documents, aligned links and termbase) as a zip, without tokens."""
    with db.session() as conn:
        project = _project(conn, project_id)
        path = backup.write_zip(conn, project_id)
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in project["name"])[:40] or "project"
    return _zip_response(path, f"colloca-project-{safe}-{time.strftime('%Y%m%d')}.zip")


@app.post("/api/import")
async def import_backup(file: UploadFile = File(...), dry_run: bool = Form(True), project_id: int | None = Form(None),
                        annotate: bool = Form(True), passphrase: str = Form("")):
    """Import an export zip (or its data.json). A dry run (the default) returns the same conflict report
    without writing anything. With `annotate`, the re-annotation job starts for every corpus that received
    documents, which rebuilds tokens and aligned segments. `project_id` puts everything into that project.
    An encrypted export (POST /api/backup/encrypted) needs its `passphrase`."""
    data = await file.read(backup.MAX_BACKUP_BYTES + 1)
    try:
        if backupcrypt.is_encrypted(data):
            if not passphrase:
                raise backup.BackupError("This file is encrypted: enter its passphrase", 400)
            try:
                data = await run_in_threadpool(backupcrypt.decrypt_bytes, data, passphrase, backup.MAX_BACKUP_BYTES)
            except backupcrypt.CryptError as exc:
                raise backup.BackupError(str(exc), 400) from exc
        payload = backup.read_backup(data)
        del data
        conn = db.connect()
        try:
            if project_id is not None:
                _project(conn, project_id)
            report = backup.import_payload(conn, payload, project_id=project_id)
            if dry_run:
                conn.rollback()
            else:
                conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    except backup.BackupError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    out = report.as_dict(dry_run)
    out["jobs"] = []
    if not dry_run and annotate:
        for corpus_id in report.corpus_ids:
            job = importer.submit(corpus_id, "reannotate", "Annotate imported documents",
                                  importer.reannotate_corpus(corpus_id, True))
            out["jobs"].append({"corpus_id": corpus_id, "job_id": job.id})
    return out


def _static_app() -> _StaticApp:
    return _StaticApp()


app.mount("/", _static_app(), name="static")
