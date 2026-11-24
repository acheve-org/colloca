"""Adding and re-annotating documents, plus the single-worker background job queue that runs them.

Annotation of a large document takes seconds to minutes, so the API hands it to a job and the UI
polls for progress. One worker thread runs jobs strictly one after another: spaCy pipelines are
not thread-safe, and SQLite allows a single writer anyway.
"""
import hashlib
import itertools
import logging
import math
import re
import threading
import time
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from typing import ClassVar

from . import db, ingest, langcheck, metadata, nlp

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
def add_document(conn, corpus, title: str, text: str, source: str, kind: str, meta: dict | None = None,
                 force_language: bool = False, progress: Callable[[float], None] | None = None,
                 segmented: bool = False) -> dict:
    """Annotate and store a text. `segmented`: every line is a segment of a parallel text (its token span
    is recorded so the segment can be paired with its translation)."""
    meta = meta or {}   # validated by metadata.clean_meta/normalize_tags: tags, text_type, doc_date, author
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
    spans: list[tuple[int, int]] = []
    try:
        pipeline = nlp.pipeline_name(corpus["lang"])
        tokens = list(nlp.annotate(text, corpus["lang"], progress, spans if segmented else None))
    except (RuntimeError, ValueError) as exc:
        raise ImportRejected(500, str(exc), "nlp_error") from exc
    if segmented and (len(spans) != len(text.split("\n")) or any(a == b for a, b in spans)):
        raise ImportRejected(500, "A segment produced no tokens, so the alignment would be off", "alignment")
    n_alpha = sum(t[6] for t in tokens)
    cur = conn.execute(
        """INSERT INTO documents (corpus_id,title,source,kind,text,text_hash,n_tokens,pipeline,lang_check,
                                  text_type,doc_date,author,segmented)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (corpus["id"], title.strip() or "Untitled", source, kind, text, digest, n_alpha,
         pipeline, check["verdict"], meta.get("text_type", ""), meta.get("doc_date", ""),
         meta.get("author", ""), int(segmented)))
    doc_id = cur.lastrowid
    metadata.set_tags(conn, doc_id, meta.get("tags", []))
    conn.executemany("INSERT INTO tokens VALUES (?,?,?,?,?,?,?,?,?,?)", ((doc_id,) + t for t in tokens))
    if segmented:
        conn.executemany("INSERT INTO segments VALUES (?,?,?,?)",
                         ((doc_id, i, a, b) for i, (a, b) in enumerate(spans)))
    warnings = [LANG_WARNINGS[check["verdict"]]] if check["verdict"] in LANG_WARNINGS else []
    if check["verdict"] == "mismatch":
        warnings = [f"Imported although it looks {nlp.SUPPORTED[check['detected']]}."]
    return {"id": doc_id, "title": title, "tokens": n_alpha, "lang_check": check["verdict"],
            "warnings": warnings}


def reannotate_document(conn, doc_id: int, progress: Callable[[float], None] | None = None) -> bool:
    """Re-run the current NLP pipeline on a stored document. False if it no longer exists."""
    row = conn.execute("""SELECT d.id, d.text, d.segmented, c.lang FROM documents d
                          JOIN corpora c ON c.id=d.corpus_id WHERE d.id=?""", (doc_id,)).fetchone()
    if not row:
        return False
    pipeline = nlp.pipeline_name(row["lang"])
    spans: list[tuple[int, int]] = []
    # annotate first: if it fails the old tokens are kept
    tokens = list(nlp.annotate(row["text"], row["lang"], progress, spans if row["segmented"] else None))
    if row["segmented"] and (len(spans) != len(row["text"].split("\n")) or any(a == b for a, b in spans)):
        raise ImportRejected(500, "A segment produced no tokens, so the alignment would be off", "alignment")
    conn.execute("DELETE FROM tokens WHERE doc_id=?", (doc_id,))
    conn.executemany("INSERT INTO tokens VALUES (?,?,?,?,?,?,?,?,?,?)", ((doc_id,) + t for t in tokens))
    if row["segmented"]:
        conn.execute("DELETE FROM segments WHERE doc_id=?", (doc_id,))
        conn.executemany("INSERT INTO segments VALUES (?,?,?,?)",
                         ((doc_id, i, a, b) for i, (a, b) in enumerate(spans)))
    conn.execute("UPDATE documents SET n_tokens=?, pipeline=?, lang_check=? WHERE id=?",
                 (sum(t[6] for t in tokens), pipeline, langcheck.check(row["text"], row["lang"])["verdict"],
                  doc_id))
    return True


# --------------------------------------------------------------------------- sentence files (reference corpora)
SENTENCES_PER_DOC = 5000     # sentence files are split into documents of this many sentences
_LEIPZIG_ID = re.compile(r"^\d+\t")


def parse_sentences(lines: Iterable[str]) -> Iterator[str]:
    """One sentence per line. Leipzig Corpora Collection files (`<id><TAB><sentence>`) lose their id."""
    for line in lines:
        line = _LEIPZIG_ID.sub("", line.rstrip("\r\n")).replace("\t", " ").strip()
        if line:
            yield line


def chunk_sentences(sentences: Iterable[str], size: int | None = None) -> Iterator[list[str]]:
    size = size or SENTENCES_PER_DOC
    chunk: list[str] = []
    for sentence in sentences:
        chunk.append(sentence)
        if len(chunk) >= size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def count_chunks(n_sentences: int, size: int | None = None) -> int:
    return math.ceil(n_sentences / (size or SENTENCES_PER_DOC))


def import_sentence_chunks(corpus_id: int, chunks: Iterable[list[str]], title: str, source: str,
                           force_language: bool = False, total_chunks: int | None = None,
                           progress: Callable[[float], None] | None = None) -> dict:
    """Store each chunk of sentences as its own document (one transaction each, so a failure
    keeps what was already imported). Exact duplicate chunks are skipped."""
    docs = tokens = skipped = 0
    for i, chunk in enumerate(chunks):
        def part(fraction: float, i=i) -> None:
            if progress and total_chunks:
                progress((i + fraction) / total_chunks)
        with db.session() as conn:
            corpus = conn.execute("SELECT * FROM corpora WHERE id=?", (corpus_id,)).fetchone()
            if not corpus:
                raise ImportRejected(404, "Corpus no longer exists", "gone")
            try:
                res = add_document(conn, corpus, f"{title} (part {i + 1})", "\n".join(chunk), source,
                                   "sentences", None, force_language, part)
            except ImportRejected as exc:
                if exc.code != "duplicate":
                    if docs:
                        exc.message += f" ({docs} earlier parts were imported.)"
                    raise
                skipped += 1
                continue
        docs += 1
        tokens += res["tokens"]
    return {"documents": docs, "tokens": tokens, "skipped_duplicates": skipped}


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
    # A big result a job wants to hand back (e.g. an analysis report). Not a dataclass field, so it never
    # travels in the job lists the UI polls; fetch it with GET /api/jobs/{id}/result.
    payload: ClassVar[dict | None] = None

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
    log.info("Job %s queued: %s %s (corpus %s)", job.id, kind, label, corpus_id)
    _executor.submit(_run, job, fn)
    return job


def _run(job: Job, fn: Callable[[Job], dict]) -> None:
    job.status = "running"
    log.info("Job %s started: %s %s (corpus %s)", job.id, job.kind, job.label, job.corpus_id)
    t0 = time.perf_counter()
    try:
        job.result = fn(job) or {}
        job.progress, job.status = 1.0, "done"
        log.info("Job %s done in %.1f s", job.id, time.perf_counter() - t0)
    except ImportRejected as exc:
        job.status, job.error, job.code = "error", exc.message, exc.code
        log.warning("Job %s rejected (%s): %s", job.id, exc.code, exc.message)
    except ingest.IngestError as exc:
        job.status, job.error, job.code = "error", str(exc), "unreadable"
        log.warning("Job %s unreadable: %s", job.id, exc)
    except Exception as exc:  # never let one bad file kill the worker
        log.exception("Job %s (%s) failed", job.id, job.label)
        job.status, job.error, job.code = "error", f"Unexpected error: {exc}", "internal"


def get_job(job_id: int) -> Job | None:
    return _jobs.get(job_id)


def forget_jobs(corpus_id: int) -> None:
    """Drop the job history of a deleted corpus (SQLite may reuse its id for a new one)."""
    with _lock:
        for job_id in [j.id for j in _jobs.values() if j.corpus_id == corpus_id]:
            del _jobs[job_id]


def jobs_for(corpus_id: int) -> list[dict]:
    with _lock:
        return [asdict(j) for j in _jobs.values() if j.corpus_id == corpus_id]


# Work units executed inside the worker thread -------------------------------------------------
def import_text(corpus_id: int, title: str, text: str, source: str, kind: str, meta: dict,
                force_language: bool) -> Callable[[Job], dict]:
    def work(job: Job) -> dict:
        with db.session() as conn:
            corpus = conn.execute("SELECT * FROM corpora WHERE id=?", (corpus_id,)).fetchone()
            if not corpus:
                raise ImportRejected(404, "Corpus no longer exists", "gone")
            return add_document(conn, corpus, title, text, source, kind, meta, force_language,
                                job.set_progress)
    return work


def import_file(corpus_id: int, filename: str, data: bytes, meta: dict,
                force_language: bool, sentences: bool = False) -> Callable[[Job], dict]:
    def work(job: Job) -> dict:
        if sentences:
            lines = list(parse_sentences(ingest.decode_bytes(data).splitlines()))
            if not lines:
                raise ImportRejected(400, "File contains no sentences")
            return import_sentence_chunks(corpus_id, chunk_sentences(lines), filename, filename,
                                          force_language, count_chunks(len(lines)), job.set_progress)
        parsed = ingest.read_file(filename, data)
        return import_text(corpus_id, parsed["title"], parsed["text"], filename, "file", meta,
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
                        conn, doc_id, lambda f, i=i: job.set_progress((i + f) / len(docs)))  # type: ignore[misc]
            except Exception as exc:  # keep going; report at the end
                log.exception("Re-annotation of document %s failed", doc_id)
                failed.append(f"{title}: {exc}")
            job.set_progress((i + 1) / len(docs))
        if failed:
            raise ImportRejected(500, f"{updated} re-annotated, {len(failed)} failed: " + "; ".join(failed),
                                 "partial")
        return {"updated": updated}
    return work
