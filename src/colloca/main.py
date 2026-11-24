"""FastAPI application: JSON API + static single-page UI."""
import csv
import io
import os
import sqlite3
from contextlib import asynccontextmanager
from dataclasses import asdict

import spacy
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import analysis, db, docview, importer, ingest, jobanalysis, metadata, nlp, parallel, termbase, termexport


@asynccontextmanager
async def lifespan(_app):
    db.init_db()
    yield


app = FastAPI(title="Colloca", version="0.1.0", lifespan=lifespan)
# COLLOCA_STATIC_DIR serves a UI build from elsewhere (end-to-end tests); the default is the packaged one.
STATIC = os.environ.get("COLLOCA_STATIC_DIR") or os.path.join(os.path.dirname(__file__), "static")


# --------------------------------------------------------------------------- helpers
def _corpus(conn, corpus_id: int):
    row = conn.execute("SELECT * FROM corpora WHERE id=?", (corpus_id,)).fetchone()
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
               LEFT JOIN corpora c ON c.project_id=p.id AND c.is_reference=0
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
                   FROM corpora c LEFT JOIN documents d ON d.corpus_id=c.id
                   WHERE c.is_reference=? GROUP BY c.id ORDER BY c.id"""


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
    with db.session() as conn:
        _corpus(conn, corpus_id)
        conn.execute("DELETE FROM corpora WHERE id=?", (corpus_id,))
    importer.forget_jobs(corpus_id)


# --------------------------------------------------------------------------- documents
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
    return HTTPException(exc.status, exc.message)


@app.post("/api/preview-url")
def preview_url(body: UrlIn):
    """Fetch and extract a URL without saving, so the user can review and trim it."""
    try:
        return ingest.fetch_url(body.url.strip())
    except ingest.IngestError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # network errors
        raise HTTPException(502, f"Could not fetch URL: {exc}") from exc


def _tags_by_doc(conn, corpus_id: int) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {}
    for r in conn.execute("""SELECT g.doc_id, g.tag FROM doc_tags g JOIN documents d ON d.id=g.doc_id
                             WHERE d.corpus_id=? ORDER BY g.tag""", (corpus_id,)):
        out.setdefault(r["doc_id"], []).append(r["tag"])
    return out


@app.get("/api/corpora/{corpus_id}/documents")
def list_documents(corpus_id: int):
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        rows = conn.execute(
            """SELECT id,title,source,kind,text_type,doc_date,author,n_tokens,pipeline,lang_check,added,
                      segmented,pair_doc_id,LENGTH(text) AS chars
               FROM documents WHERE corpus_id=? ORDER BY id""", (corpus_id,)).fetchall()
        tags = _tags_by_doc(conn, corpus_id)
    try:
        current = nlp.pipeline_name(corpus["lang"])
    except (RuntimeError, ValueError):
        current = None   # no model installed: nothing can be re-annotated, so nothing is "stale"
    return [{**dict(r), "tags": tags.get(r["id"], []),
             "stale": current is not None and importer.is_stale(r["pipeline"], current)} for r in rows]


@app.post("/api/corpora/{corpus_id}/documents", status_code=201)
def add_document(corpus_id: int, body: DocIn, background: bool = False, force_language: bool = False):
    """Add a text. With ?background=true it is queued and answered at once with 202 + a job."""
    meta = _meta(body.tags, body.text_type, body.doc_date, body.author)
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        if not background:
            try:
                return importer.add_document(conn, corpus, body.title, body.text, body.source,
                                             body.kind, meta, force_language)
            except importer.ImportRejected as exc:
                raise _rejected(exc) from exc
    job = importer.submit(corpus_id, "import", body.title or "Pasted text",
                          importer.import_text(corpus_id, body.title, body.text, body.source,
                                               body.kind, meta, force_language))
    return JSONResponse({"job_id": job.id}, status_code=202)


@app.post("/api/corpora/{corpus_id}/upload", status_code=202)
async def upload(corpus_id: int, files: list[UploadFile] = File(...), tags: str = "",
                 text_type: str = "", doc_date: str = "", author: str = "",
                 force_language: bool = False, sentences: bool = False):
    """Queue each file as a background job. Per-file answers: {file, ok, job_id} or {file, ok:false, error}.

    With ?sentences=true a file is read as one sentence per line (Leipzig Corpora Collection files work as
    they are) and split into several documents. `tags`, `text_type`, `doc_date` and `author` apply to every file."""
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
        job = importer.submit(corpus_id, "import", name,
                              importer.import_file(corpus_id, name, data, meta, force_language, sentences))
        results.append({"file": name, "ok": True, "job_id": job.id})
    return results


@app.post("/api/corpora/{corpus_id}/upload-pairs", status_code=202)
async def upload_pairs(corpus_id: int, files: list[UploadFile] = File(...), partner_corpus_id: int | None = None,
                       partner_name: str = "", swap: bool = False, tags: str = "", text_type: str = "",
                       doc_date: str = "", author: str = "", force_language: bool = False):
    """Import aligned texts (TMX, or two-column .tsv/.csv/.docx table) into this corpus and a partner corpus of
    the other language: pass `partner_corpus_id`, or `partner_name` to create the partner corpus (same project).
    This corpus receives the first language / column, the partner the second (`swap` flips two-column files)."""
    meta = _meta(tags, text_type, doc_date, author)
    with db.session() as conn:
        corpus = _corpus(conn, corpus_id)
        if corpus["is_reference"]:
            raise HTTPException(400, "A base corpus cannot hold aligned texts")
        if partner_corpus_id is not None:
            partner = _corpus(conn, partner_corpus_id)
            if partner["id"] == corpus_id or partner["lang"] == corpus["lang"] or partner["is_reference"]:
                raise HTTPException(400, "The partner must be another, non-base corpus in the other language")
            partner_id = partner["id"]
        elif partner_name.strip():
            partner_id = conn.execute(
                "INSERT INTO corpora (name,lang,description,project_id) VALUES (?,?,?,?)",
                (partner_name.strip()[:120], termbase.other_lang(corpus["lang"]),
                 f"Translations of “{corpus['name']}”", corpus["project_id"])).lastrowid
        else:
            raise HTTPException(400, "Choose the partner corpus (partner_corpus_id) or name a new one (partner_name)")
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


@app.get("/api/corpora/{corpus_id}/parallel")
def parallel_info(corpus_id: int):
    """Aligned documents of this corpus and the corpora holding their translations."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        row = conn.execute("""SELECT COUNT(*) AS docs, COALESCE(SUM(s.n),0) AS segments FROM documents d
                              LEFT JOIN (SELECT doc_id, COUNT(*) AS n FROM segments GROUP BY doc_id) s ON s.doc_id=d.id
                              WHERE d.corpus_id=? AND d.segmented=1 AND d.pair_doc_id IS NOT NULL""",
                           (corpus_id,)).fetchone()
        partners = conn.execute("""SELECT DISTINCT c.id, c.name, c.lang FROM documents d
                                   JOIN documents p ON p.id=d.pair_doc_id JOIN corpora c ON c.id=p.corpus_id
                                   WHERE d.corpus_id=? ORDER BY c.name""", (corpus_id,)).fetchall()
        return {"documents": row["docs"], "segments": row["segments"], "partners": [dict(r) for r in partners]}


@app.get("/api/corpora/{corpus_id}/bilingual")
def bilingual(corpus_id: int, q: str, unit: str = "lemma", width: int = Query(8, le=40),
              limit: int = Query(300, ge=1, le=2000), sort: str = "doc", format: str = "json",
              case_sensitive: bool = False, any_order: bool = False, sample: int | None = None,
              sq: ScopeQuery = Depends()):
    """Concordance over aligned documents, each hit with its segment and the aligned translation."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        res = _run(parallel.bilingual_concordance, conn, sq.scope(corpus_id), q, unit, width, limit, sort,
                   case_sensitive, any_order, sample)
    if format == "csv":
        hidden = ("pos", "doc_id", "matches", "source_marks", "target_marks")
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


@app.post("/api/corpora/{corpus_id}/analyse-job", status_code=202)
async def analyse_job(corpus_id: int, file: UploadFile | None = File(None), text: str = Form(""),
                      min_freq: int = Query(2, ge=1), min_corpus_freq: int = Query(3, ge=1),
                      force_language: bool = False, sq: ScopeQuery = Depends()):
    """Analyse a text you are about to translate (an uploaded file, or `text`) against this corpus and its
    project's termbase. Runs as a job; fetch the report from GET /api/jobs/{id}/result. Nothing is stored."""
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

    def work(job):
        body = ingest.read_file(name, data)["text"] if data is not None else text
        with db.session() as conn:
            job.payload = jobanalysis.analyse(conn, scope, corpus, body, min_freq=min_freq,
                                              min_corpus_freq=min_corpus_freq, force_language=force_language,
                                              progress=job.set_progress)
        return {"summary": job.payload["summary"]}
    job = importer.submit(corpus_id, "analysis", name, work)
    return {"job_id": job.id}


_JOB_SECTIONS = ("key_terms", "gaps", "known_terms", "phrases")


@app.get("/api/jobs/{job_id}/result")
def job_result(job_id: int, section: str = "", format: str = "json"):
    """The report of an analysis job; `section` + `format=csv` downloads one table."""
    job = importer.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status != "done" or job.payload is None:
        raise HTTPException(409, "The job has no result (yet)")
    if not section:
        return job.payload
    if section not in _JOB_SECTIONS:
        raise HTTPException(400, f"section must be one of {', '.join(_JOB_SECTIONS)}")
    rows = job.payload[section]
    if section == "known_terms":
        rows = [{"term": r["item"], "occurrences": r["occurrences"], "example": r["example"],
                 "translations": "; ".join(f"{t['term'] or '—'} [{t['status']}]" for t in r["translations"])}
                for r in rows]
    return _reply(rows, format, section)


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
        row = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Document not found")
        tags = [r[0] for r in conn.execute("SELECT tag FROM doc_tags WHERE doc_id=? ORDER BY tag", (doc_id,))]
        return {**dict(row), "tags": tags}


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
        row = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Document not found")
        if "title" in sent and body.title:
            conn.execute("UPDATE documents SET title=? WHERE id=?", (body.title.strip(), doc_id))
        meta = _meta(body.tags if "tags" in sent else None,
                     body.text_type if "text_type" in sent else row["text_type"],
                     body.doc_date if "doc_date" in sent else row["doc_date"],
                     body.author if "author" in sent else row["author"])
        conn.execute("UPDATE documents SET text_type=?, doc_date=?, author=? WHERE id=?",
                     (meta["text_type"], meta["doc_date"], meta["author"], doc_id))
        if "tags" in sent:
            metadata.set_tags(conn, doc_id, meta["tags"])
    return {"ok": True}


@app.delete("/api/documents/{doc_id}", status_code=204)
def delete_document(doc_id: int):
    with db.session() as conn:
        conn.execute("DELETE FROM documents WHERE id=?", (doc_id,))


@app.get("/api/corpora/{corpus_id}/facets")
def facets(corpus_id: int):
    """The metadata values present in a corpus, to build filters."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        tags = conn.execute("""SELECT g.tag AS tag, COUNT(*) AS docs FROM doc_tags g JOIN documents d ON d.id=g.doc_id
                               WHERE d.corpus_id=? GROUP BY g.tag ORDER BY docs DESC, tag""", (corpus_id,))
        types = conn.execute("""SELECT text_type, COUNT(*) AS docs FROM documents WHERE corpus_id=? AND text_type<>''
                                GROUP BY text_type ORDER BY docs DESC, text_type""", (corpus_id,))
        dates = conn.execute("""SELECT MIN(doc_date), MAX(doc_date) FROM documents
                                WHERE corpus_id=? AND doc_date<>''""", (corpus_id,)).fetchone()
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
    return _reply(rows, format, "frequency")


@app.get("/api/corpora/{corpus_id}/concordance")
def concordance(corpus_id: int, q: str, unit: str = "lemma", width: int = Query(8, le=40),
                limit: int = Query(300, ge=1, le=2000), sort: str = "doc", format: str = "json",
                case_sensitive: bool = False, any_order: bool = False, sample: int | None = None,
                sq: ScopeQuery = Depends()):
    """`case_sensitive` matches the written form; `*` starts or ends a word (contrat*, *miento); `any_order`
    finds the words anywhere in one sentence; `sample=<seed>` returns a reproducible random selection of
    `limit` hits; `sort` is doc, left, right, or l1 l2 r1 r2 (the 1st/2nd word to the left/right)."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        res = _run(analysis.concordance, conn, sq.scope(corpus_id), q, unit, width, limit, sort,
                   case_sensitive, any_order, sample)
    if format == "csv":
        return _reply([{k: v for k, v in ln.items() if k not in ("pos", "matches")} for ln in res["lines"]],
                      format, "concordance")
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
    return _reply(res["rows"], format, "collocations") if format == "csv" else res


@app.get("/api/corpora/{corpus_id}/ngrams")
def ngrams(corpus_id: int, n: int = 3, unit: str = "form", min_freq: int = 2, min_docs: int = 1,
           edge_stop: bool = False, limit: int = Query(300, le=3000), format: str = "json",
           sq: ScopeQuery = Depends()):
    with db.session() as conn:
        _corpus(conn, corpus_id)
        rows = _run(analysis.ngrams, conn, sq.scope(corpus_id), n, unit, min_freq, min_docs, edge_stop, limit)
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
    return _reply(rows, format, "keyness")


# --------------------------------------------------------------------------- examples & termbase
@app.get("/api/corpora/{corpus_id}/examples")
def examples(corpus_id: int, q: str, unit: str = "lemma", limit: int = Query(5, ge=1, le=20),
             sq: ScopeQuery = Depends()):
    """Whole sentences containing a word or phrase: candidates for a term's example sentence."""
    with db.session() as conn:
        _corpus(conn, corpus_id)
        return _run(analysis.examples, conn, sq.scope(corpus_id), q, unit, limit)


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


_TERM_CONFLICT = "This term and translation are already in the termbase"


def _term_error(exc: Exception) -> HTTPException:
    return HTTPException(400, str(exc))


@app.get("/api/terms")
def list_terms(project: str = "", src_lang: str = "", tgt_lang: str = "", status: str = "", q: str = "",
               limit: int = Query(5000, le=20000)):
    """Termbase entries. project: '' (all), 'none' (general termbase) or a project id. status: comma list."""
    try:
        with db.session() as conn:
            return termbase.list_terms(conn, project, src_lang, tgt_lang,
                                       tuple(x for x in status.split(",") if x), q, limit)
    except termbase.TermError as exc:
        raise _term_error(exc) from exc


@app.post("/api/terms", status_code=201)
def create_term(body: TermIn):
    try:
        entry = termbase.clean(body.model_dump(exclude={"project_id"}))
        termbase.check_consistency(entry)
    except termbase.TermError as exc:
        raise _term_error(exc) from exc
    with db.session() as conn:
        if body.project_id is not None:
            _project(conn, body.project_id)
        try:
            cur = conn.execute(
                """INSERT INTO terms (project_id,src_lang,tgt_lang,src_term,tgt_term,pos,status,domain,definition,
                                      notes,context,context_source,origin)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (body.project_id, entry["src_lang"], entry["tgt_lang"], entry["src_term"], entry["tgt_term"],
                 entry.get("pos", ""), entry.get("status", "candidate"), entry.get("domain", ""),
                 entry.get("definition", ""), entry.get("notes", ""), entry.get("context", ""),
                 entry.get("context_source", ""), entry.get("origin", "manual")))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, _TERM_CONFLICT) from exc
        return {"id": cur.lastrowid}


@app.patch("/api/terms/{term_id}")
def update_term(term_id: int, body: TermPatch):
    sent = {k: getattr(body, k) for k in body.model_fields_set}
    with db.session() as conn:
        row = conn.execute("SELECT * FROM terms WHERE id=?", (term_id,)).fetchone()
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
            try:
                conn.execute(f"UPDATE terms SET {cols}, updated=CURRENT_TIMESTAMP WHERE id=?",
                             [*changes.values(), term_id])
            except sqlite3.IntegrityError as exc:
                raise HTTPException(409, _TERM_CONFLICT) from exc
    return {"ok": True}


@app.delete("/api/terms/{term_id}", status_code=204)
def delete_term(term_id: int):
    with db.session() as conn:
        conn.execute("DELETE FROM terms WHERE id=?", (term_id,))


_EXPORTS = {"csv": ("text/csv; charset=utf-8", "csv"), "xlsx": (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"),
    "tbx": ("application/xml", "tbx"), "tbx2": ("application/xml", "tbx")}


@app.get("/api/terms/export")
def export_terms(format: str = "tbx", project: str = "", src_lang: str = "", tgt_lang: str = "",
                 status: str = "approved", ids: str = ""):
    """Download the termbase as `tbx` (ISO 30042:2019), `tbx2` (ISO 30042:2008, most CAT tools),
    `xlsx` or `csv`. By default only approved entries; pass status=approved,candidate to include candidates.
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


def _static_app() -> _StaticApp:
    return _StaticApp()


app.mount("/", _static_app(), name="static")
