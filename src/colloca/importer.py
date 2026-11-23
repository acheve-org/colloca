"""Adding and re-annotating documents, plus the single-worker background job queue that runs them.

Annotation of a large document takes seconds to minutes, so the API hands it to a job and the UI
polls for progress. One worker thread runs jobs strictly one after another: spaCy pipelines are
not thread-safe, and SQLite allows a single writer anyway.
"""
import hashlib
import itertools
import logging
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field

from . import db, ingest, langcheck, nlp

log = logging.getLogger("colloca.importer")

MIN_CHARS = 20
LANG_WARNINGS = {
    "uncertain": "The text does not look like Spanish or Italian (another language, a list or codes?).",
    "short": "The text is too short to verify its language.",
}


class ImportRejected(Exception):
    """A document that cannot be added; `status` is the HTTP code the API should answer with."""

    def __init__(self, status: int, message: str, code: str = "rejected"):
        super().__init__(message)
        self.status, self.message, self.code = status, message, code


# --------------------------------------------------------------------------- documents
def add_document(conn, corpus, title: str, text: str, source: str, kind: str, tags: str,
                 force_language: bool = False, progress: Callable[[float], None] | None = None) -> dict:
    text = ingest.normalize_text(text)
    if len(text) < MIN_CHARS:
        raise ImportRejected(400, "Text is too short")
    if len(text) > ingest.MAX_TEXT_CHARS:
        raise ImportRejected(413, f"Text is larger than {ingest.MAX_TEXT_CHARS // 1024 // 1024} MB "
                                  "(raise MAX_TEXT_MB or split the document)", "too_large")
    digest = hashlib.sha256(" ".join(text.split()).lower().encode()).hexdigest()
    if conn.execute("SELECT 1 FROM documents WHERE corpus_id=? AND text_hash=?",
                    (corpus["id"], digest)).fetchone():
        raise ImportRejected(409, "An identical document is already in this corpus", "duplicate")
    check = langcheck.check(text, corpus["lang"])
    if check["verdict"] == "mismatch" and not force_language:
        raise ImportRejected(
            422, f"This text looks {nlp.SUPPORTED[check['detected']]}, but the corpus is "
                 f"{nlp.SUPPORTED[corpus['lang']]}. Tick “import even if the language looks wrong” "
                 "to add it anyway (its lemmas will be unreliable).", "language_mismatch")
    try:
        pipeline = nlp.pipeline_name(corpus["lang"])
        tokens = list(nlp.annotate(text, corpus["lang"], progress))
    except (RuntimeError, ValueError) as exc:
        raise ImportRejected(500, str(exc), "nlp_error") from exc
    n_alpha = sum(t[6] for t in tokens)
    cur = conn.execute(
        """INSERT INTO documents (corpus_id,title,source,kind,tags,text,text_hash,n_tokens,pipeline,lang_check)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (corpus["id"], title.strip() or "Untitled", source, kind, tags, text, digest, n_alpha,
         pipeline, check["verdict"]))
    doc_id = cur.lastrowid
    conn.executemany("INSERT INTO tokens VALUES (?,?,?,?,?,?,?,?,?,?)", ((doc_id,) + t for t in tokens))
    warnings = [LANG_WARNINGS[check["verdict"]]] if check["verdict"] in LANG_WARNINGS else []
    if check["verdict"] == "mismatch":
        warnings = [f"Imported although it looks {nlp.SUPPORTED[check['detected']]}."]
    return {"id": doc_id, "title": title, "tokens": n_alpha, "lang_check": check["verdict"],
            "warnings": warnings}


def reannotate_document(conn, doc_id: int, progress: Callable[[float], None] | None = None) -> bool:
    """Re-run the current NLP pipeline on a stored document. False if it no longer exists."""
    row = conn.execute("""SELECT d.id, d.text, c.lang FROM documents d
                          JOIN corpora c ON c.id=d.corpus_id WHERE d.id=?""", (doc_id,)).fetchone()
    if not row:
        return False
    pipeline = nlp.pipeline_name(row["lang"])
    tokens = list(nlp.annotate(row["text"], row["lang"], progress))  # annotate first: failure keeps old tokens
    conn.execute("DELETE FROM tokens WHERE doc_id=?", (doc_id,))
    conn.executemany("INSERT INTO tokens VALUES (?,?,?,?,?,?,?,?,?,?)", ((doc_id,) + t for t in tokens))
    conn.execute("UPDATE documents SET n_tokens=?, pipeline=?, lang_check=? WHERE id=?",
                 (sum(t[6] for t in tokens), pipeline, langcheck.check(row["text"], row["lang"])["verdict"],
                  doc_id))
    return True


def is_stale(doc_pipeline: str, current: str) -> bool:
    return doc_pipeline != current


# --------------------------------------------------------------------------- jobs
@dataclass
class Job:
    id: int
    corpus_id: int
    kind: str                     # import | reannotate
    label: str
    status: str = "queued"        # queued | running | done | error
    progress: float = 0.0
    error: str = ""
    code: str = ""
    result: dict = field(default_factory=dict)

    def set_progress(self, fraction: float) -> None:
        self.progress = round(min(max(fraction, 0.0), 1.0), 3)


_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="colloca-job")
_jobs: dict[int, Job] = {}
_ids = itertools.count(1)
_lock = threading.Lock()
KEEP_FINISHED = 200


def submit(corpus_id: int, kind: str, label: str, fn: Callable[[Job], dict]) -> Job:
    with _lock:
        job = Job(next(_ids), corpus_id, kind, label)
        _jobs[job.id] = job
        finished = [j for j in _jobs.values() if j.status in ("done", "error")]
        for old in finished[:-KEEP_FINISHED]:
            _jobs.pop(old.id, None)
    _executor.submit(_run, job, fn)
    return job


def _run(job: Job, fn: Callable[[Job], dict]) -> None:
    job.status = "running"
    try:
        job.result = fn(job) or {}
        job.progress, job.status = 1.0, "done"
    except ImportRejected as exc:
        job.status, job.error, job.code = "error", exc.message, exc.code
    except ingest.IngestError as exc:
        job.status, job.error, job.code = "error", str(exc), "unreadable"
    except Exception as exc:  # never let one bad file kill the worker
        log.exception("Job %s (%s) failed", job.id, job.label)
        job.status, job.error, job.code = "error", f"Unexpected error: {exc}", "internal"


def get_job(job_id: int) -> Job | None:
    return _jobs.get(job_id)


def jobs_for(corpus_id: int) -> list[dict]:
    with _lock:
        return [asdict(j) for j in _jobs.values() if j.corpus_id == corpus_id]


# Work units executed inside the worker thread -------------------------------------------------
def import_text(corpus_id: int, title: str, text: str, source: str, kind: str, tags: str,
                force_language: bool) -> Callable[[Job], dict]:
    def work(job: Job) -> dict:
        with db.session() as conn:
            corpus = conn.execute("SELECT * FROM corpora WHERE id=?", (corpus_id,)).fetchone()
            if not corpus:
                raise ImportRejected(404, "Corpus no longer exists", "gone")
            return add_document(conn, corpus, title, text, source, kind, tags, force_language,
                                job.set_progress)
    return work


def import_file(corpus_id: int, filename: str, data: bytes, tags: str,
                force_language: bool) -> Callable[[Job], dict]:
    def work(job: Job) -> dict:
        parsed = ingest.read_file(filename, data)
        return import_text(corpus_id, parsed["title"], parsed["text"], filename, "file", tags,
                           force_language)(job)
    return work


def reannotate_corpus(corpus_id: int, only_stale: bool) -> Callable[[Job], dict]:
    def work(job: Job) -> dict:
        with db.session() as conn:
            corpus = conn.execute("SELECT lang FROM corpora WHERE id=?", (corpus_id,)).fetchone()
            if not corpus:
                raise ImportRejected(404, "Corpus no longer exists", "gone")
            current = nlp.pipeline_name(corpus["lang"])
            docs = [(r["id"], r["title"]) for r in conn.execute(
                "SELECT id, title, pipeline FROM documents WHERE corpus_id=? ORDER BY id", (corpus_id,))
                if not only_stale or is_stale(r["pipeline"], current)]
        updated, failed = 0, []
        for i, (doc_id, title) in enumerate(docs):
            try:
                with db.session() as conn:
                    updated += reannotate_document(
                        conn, doc_id, lambda f, i=i: job.set_progress((i + f) / len(docs)))
            except Exception as exc:  # keep going; report at the end
                log.exception("Re-annotation of document %s failed", doc_id)
                failed.append(f"{title}: {exc}")
            job.set_progress((i + 1) / len(docs))
        if failed:
            raise ImportRejected(500, f"{updated} re-annotated, {len(failed)} failed: " + "; ".join(failed),
                                 "partial")
        return {"updated": updated}
    return work
