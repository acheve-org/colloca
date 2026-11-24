"""Backup and restore (T14): export a project or the whole database to one zip file, and import such a file.

A backup zip holds
- `manifest.json`: what it is (format, version, schema, date, counts);
- `data.json`: the portable form, readable by any Colloca version that knows `format_version` 1: projects,
  corpora, documents (text and metadata, tags, aligned-partner links), termbase entries and the candidate stop
  list. Tokens are NOT stored (they are by far the largest part and can be rebuilt): the import starts the
  existing re-annotation job, which recreates tokens and segments from the texts;
- `corpus.db` (whole-database backup only): a consistent SQLite copy made with the backup API, tokens included,
  for disaster recovery (stop Colloca, put it in place of `corpus.db`).

Importing is safe by construction: the zip is never extracted (only `manifest.json` and `data.json` are read,
from memory, with size limits), a member name that could escape a directory rejects the file, every field is
validated, and a conflict report says what was created and what already existed. The import runs in one
transaction; a dry run runs the same code and rolls it back, so the report is exact.
"""
import hashlib
import io
import json
import os
import re
import sqlite3
import tempfile
import zipfile
from datetime import UTC, datetime
from typing import Any

from . import dedup, ingest, metadata, nlp, termbase

FORMAT = "colloca-export"
FORMAT_VERSION = 1
MAX_BACKUP_BYTES = int(os.environ.get("MAX_BACKUP_MB", "512")) * 1024 * 1024        # uploaded file
MAX_JSON_BYTES = 4 * MAX_BACKUP_BYTES                                               # data.json once decompressed
MAX_MEMBERS = 16
MAX_DOCS = 200_000
MAX_TERMS = 500_000
REPORT_LIMIT = 100          # conflicts listed in a report (the counts are always complete)
_NAME_OK = ("manifest.json", "data.json", "corpus.db")


class BackupError(ValueError):
    """The file cannot be read as a backup (status is the HTTP code to answer with)."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# --------------------------------------------------------------------------- export
def _rows(conn, sql: str, params=()) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, params)]


def build_payload(conn: sqlite3.Connection, project_id: int | None = None) -> dict:
    """The portable form of one project (corpora, documents, termbase) or, with `project_id` None, of everything
    that is not in the Trash. Links to aligned partners outside the export are dropped and counted."""
    if project_id is None:
        projects = _rows(conn, "SELECT id, name, notes FROM projects ORDER BY id")
        corpora = _rows(conn, """SELECT id, name, lang, description, is_reference, project_id FROM corpora
                                 WHERE deleted_at IS NULL ORDER BY id""")
        terms = _rows(conn, "SELECT * FROM terms WHERE deleted_at IS NULL ORDER BY id")
        rejections = _rows(conn, "SELECT project_id, lang, term FROM term_rejections ORDER BY id")
    else:
        projects = _rows(conn, "SELECT id, name, notes FROM projects WHERE id=?", (project_id,))
        corpora = _rows(conn, """SELECT id, name, lang, description, is_reference, project_id FROM corpora
                                 WHERE deleted_at IS NULL AND project_id=? ORDER BY id""", (project_id,))
        terms = _rows(conn, "SELECT * FROM terms WHERE deleted_at IS NULL AND project_id=? ORDER BY id",
                      (project_id,))
        rejections = _rows(conn, "SELECT project_id, lang, term FROM term_rejections WHERE project_id=? ORDER BY id",
                           (project_id,))
    ids = [c["id"] for c in corpora]
    docs: list[dict] = []
    if ids:
        marks = ",".join("?" * len(ids))
        docs = _rows(conn, f"""SELECT id, corpus_id, title, source, kind, text, text_type, doc_date, author,
                                      lang_check, added, segmented, pair_doc_id FROM documents
                               WHERE deleted_at IS NULL AND corpus_id IN ({marks}) ORDER BY id""", ids)
    tags: dict[int, list[str]] = {}
    for r in conn.execute("SELECT doc_id, tag FROM doc_tags ORDER BY tag"):
        tags.setdefault(r["doc_id"], []).append(r["tag"])
    exported = {d["id"] for d in docs}
    external = 0
    for d in docs:
        d["tags"] = tags.get(d["id"], [])
        if d["pair_doc_id"] is not None and d["pair_doc_id"] not in exported:
            external += 1
            d["pair_doc_id"] = None
    return {
        "format": FORMAT, "format_version": FORMAT_VERSION, "scope": "database" if project_id is None else "project",
        "projects": [{"ref": p["id"], "name": p["name"], "notes": p["notes"]} for p in projects],
        "corpora": [{"ref": c["id"], "name": c["name"], "lang": c["lang"], "description": c["description"],
                     "is_reference": bool(c["is_reference"]), "project_ref": c["project_id"]} for c in corpora],
        "documents": [{"ref": d["id"], "corpus_ref": d["corpus_id"], "title": d["title"], "source": d["source"],
                       "kind": d["kind"], "text": d["text"], "text_type": d["text_type"], "doc_date": d["doc_date"],
                       "author": d["author"], "tags": d["tags"], "lang_check": d["lang_check"], "added": d["added"],
                       "segmented": bool(d["segmented"]), "pair_ref": d["pair_doc_id"]} for d in docs],
        "terms": [{"project_ref": t["project_id"], **{k: t[k] for k in _TERM_FIELDS}, "created": t["created"],
                   "updated": t["updated"], "concept_ref": t["concept_id"]} for t in terms],
        "rejections": [{"project_ref": r["project_id"], "lang": r["lang"], "term": r["term"]} for r in rejections],
        "unexported_links": external,
    }


_TERM_FIELDS = ("src_lang", "tgt_lang", "src_term", "tgt_term", "pos", "status", "domain", "definition", "notes",
                "context", "context_source", "origin", "src_gender", "src_number", "src_note", "tgt_gender",
                "tgt_number", "tgt_note")


def _manifest(payload: dict, with_db: bool) -> dict:
    from .db import SCHEMA_VERSION
    return {"format": FORMAT, "format_version": FORMAT_VERSION, "schema_version": SCHEMA_VERSION,
            "scope": payload["scope"], "created": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "counts": {k: len(payload[k]) for k in ("projects", "corpora", "documents", "terms", "rejections")},
            "tokens_included": False, "sqlite_copy": with_db, "unexported_links": payload["unexported_links"]}


def write_zip(conn: sqlite3.Connection, project_id: int | None = None, with_db: bool = False) -> str:
    """Build the backup zip in a temporary file and return its path (the caller removes it)."""
    payload = build_payload(conn, project_id)
    fd, path = tempfile.mkstemp(suffix=".zip", prefix="colloca-export-")
    os.close(fd)
    try:
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("manifest.json", json.dumps(_manifest(payload, with_db), indent=2))
            z.writestr("data.json", json.dumps(payload, ensure_ascii=False))
            if with_db:
                with tempfile.TemporaryDirectory(prefix="colloca-snapshot-") as tmp:
                    snap = os.path.join(tmp, "corpus.db")
                    dest = sqlite3.connect(snap)
                    try:
                        conn.backup(dest)            # a consistent copy even while the application writes
                    finally:
                        dest.close()
                    z.write(snap, "corpus.db")
    except Exception:
        os.unlink(path)
        raise
    return path


# --------------------------------------------------------------------------- reading a file safely
def _read_member(z: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int) -> bytes:
    if info.file_size > limit:
        raise BackupError(f"{info.filename} is larger than the limit ({limit // 1024 // 1024} MB)", 413)
    with z.open(info) as f:
        data = f.read(limit + 1)             # the declared size can lie: never read more than the limit
    if len(data) > limit:
        raise BackupError(f"{info.filename} is larger than the limit ({limit // 1024 // 1024} MB)", 413)
    return data


def read_backup(data: bytes) -> dict:
    """The validated-by-shape payload of an uploaded file (a backup zip or a bare data.json)."""
    if len(data) > MAX_BACKUP_BYTES:
        raise BackupError(f"File is larger than {MAX_BACKUP_BYTES // 1024 // 1024} MB (set MAX_BACKUP_MB to change)",
                          413)
    if data[:2] == b"PK":
        try:
            z = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile as exc:
            raise BackupError("Not a valid zip file") from exc
        with z:
            infos = z.infolist()
            if len(infos) > MAX_MEMBERS:
                raise BackupError("Too many files in the archive")
            for i in infos:
                name = i.filename
                if name.startswith(("/", "\\")) or "\\" in name or re.search(r"(^|/)\.\.(/|$)", name) \
                        or re.match(r"^[A-Za-z]:", name):
                    raise BackupError(f"Unsafe file name in the archive: {name!r}")
            info = next((i for i in infos if i.filename == "data.json"), None)
            if info is None:
                raise BackupError("This zip has no data.json (is it a Colloca export?)")
            raw = _read_member(z, info, MAX_JSON_BYTES)
    else:
        raw = data
    try:
        payload = json.loads(raw)
    except (ValueError, RecursionError) as exc:
        raise BackupError("data.json is not valid JSON") from exc
    if not isinstance(payload, dict) or payload.get("format") != FORMAT:
        raise BackupError("This is not a Colloca export")
    if payload.get("format_version") != FORMAT_VERSION:
        raise BackupError(f"Unsupported export version {payload.get('format_version')!r} "
                          f"(this Colloca reads version {FORMAT_VERSION})")
    return payload


# --------------------------------------------------------------------------- importing
class _Report:
    def __init__(self) -> None:
        self.created = {k: 0 for k in ("projects", "corpora", "documents", "terms", "rejections", "links")}
        self.existing = {k: 0 for k in self.created}      # found already there: merged / skipped
        self.rejected = 0
        self.conflicts: list[dict] = []
        self.n_conflicts = 0
        self.corpus_ids: list[int] = []         # corpora that received documents (to re-annotate)

    def conflict(self, kind: str, message: str, **extra) -> None:
        self.n_conflicts += 1
        if len(self.conflicts) < REPORT_LIMIT:
            self.conflicts.append({"kind": kind, "message": message, **extra})

    def as_dict(self, dry_run: bool) -> dict:
        return {"dry_run": dry_run, "created": self.created, "existing": self.existing, "rejected": self.rejected,
                "conflicts": self.conflicts, "conflict_count": self.n_conflicts}


def _str(d: dict, key: str, limit: int, default: str = "") -> str:
    v = d.get(key, default)
    if v is None:
        return default
    if not isinstance(v, str):
        raise ValueError(f"{key} must be text")
    if len(v) > limit:
        raise ValueError(f"{key} is longer than {limit} characters")
    return v


def _list(payload: dict, key: str, limit: int) -> list[dict]:
    v = payload.get(key, [])
    if not isinstance(v, list) or any(not isinstance(x, dict) for x in v):
        raise BackupError(f"'{key}' must be a list of objects")
    if len(v) > limit:
        raise BackupError(f"Too many entries in '{key}' (limit {limit})", 413)
    return v


def _ref(value: Any):
    return value if isinstance(value, int | str) and not isinstance(value, bool) else None


def import_payload(conn: sqlite3.Connection, payload: dict, *, project_id: int | None = None) -> _Report:
    """Write the payload into the database (the caller commits, or rolls back for a dry run).

    `project_id`: put everything into this existing project instead of the projects named in the file.
    Merging rules: a project is matched by name, a corpus by (project, name, language), a document by its text
    inside the corpus and a termbase entry by (project, languages, source, translation); whatever exists is kept
    and reported, never overwritten."""
    rep = _Report()
    projects = _list(payload, "projects", 10_000)
    corpora = _list(payload, "corpora", 10_000)
    docs = _list(payload, "documents", MAX_DOCS)
    terms = _list(payload, "terms", MAX_TERMS)
    rejections = _list(payload, "rejections", MAX_TERMS)

    # projects
    pmap: dict[Any, int | None] = {None: project_id}
    for p in projects:
        try:
            name = " ".join(_str(p, "name", 120).split())
            if not name:
                raise ValueError("a project has no name")
            notes = _str(p, "notes", 20_000)
        except ValueError as exc:
            rep.rejected += 1
            rep.conflict("project", str(exc))
            continue
        if project_id is not None:
            pmap[_ref(p.get("ref"))] = project_id
            continue
        row = conn.execute("SELECT id FROM projects WHERE name=? COLLATE NOCASE", (name,)).fetchone()
        if row:
            pmap[_ref(p.get("ref"))] = row["id"]
            rep.existing["projects"] += 1
            rep.conflict("project", f"Project “{name}” already exists: its contents are merged into it",
                         name=name)
        else:
            pmap[_ref(p.get("ref"))] = conn.execute("INSERT INTO projects (name, notes) VALUES (?, ?)",
                                                    (name, notes)).lastrowid
            rep.created["projects"] += 1

    # corpora
    cmap: dict[Any, int] = {}
    for c in corpora:
        try:
            name = " ".join(_str(c, "name", 120).split())
            lang = _str(c, "lang", 8)
            desc = _str(c, "description", 5000)
            if not name:
                raise ValueError("a corpus has no name")
            if lang not in nlp.SUPPORTED:
                raise ValueError(f"corpus “{name}”: language must be one of {', '.join(nlp.SUPPORTED)}")
            is_ref = bool(c.get("is_reference"))
        except ValueError as exc:
            rep.rejected += 1
            rep.conflict("corpus", str(exc))
            continue
        pid = pmap.get(_ref(c.get("project_ref")), project_id) if c.get("project_ref") is not None else project_id
        if is_ref:
            pid = None
            row = conn.execute("SELECT id FROM corpora WHERE lang=? AND is_reference=1", (lang,)).fetchone()
            if row:
                rep.existing["corpora"] += 1
                cmap[_ref(c.get("ref"))] = row["id"]
                rep.conflict("corpus", f"A base corpus for {lang} already exists: documents of “{name}” are "
                                       "merged into it", name=name)
                continue
        else:
            row = conn.execute("""SELECT id FROM corpora WHERE name=? COLLATE NOCASE AND lang=? AND is_reference=0
                                  AND deleted_at IS NULL AND IFNULL(project_id,0)=?""",
                               (name, lang, pid or 0)).fetchone()
            if row:
                cmap[_ref(c.get("ref"))] = row["id"]
                rep.existing["corpora"] += 1
                rep.conflict("corpus", f"Corpus “{name}” already exists: its documents are merged into it", name=name)
                continue
        cmap[_ref(c.get("ref"))] = conn.execute(
            "INSERT INTO corpora (name, lang, description, is_reference, project_id) VALUES (?,?,?,?,?)",
            (name, lang, desc, int(is_ref), pid)).lastrowid or 0
        rep.created["corpora"] += 1

    # documents
    dmap: dict[Any, int] = {}
    for d in docs:
        corpus = conn.execute("SELECT id, lang FROM corpora WHERE id=?", (cmap.get(_ref(d.get("corpus_ref"))),)
                              ).fetchone()
        try:
            if not corpus:
                raise ValueError("its corpus was not imported")
            title = " ".join(_str(d, "title", 300).split()) or "Untitled"
            text = ingest.normalize_text(_str(d, "text", ingest.MAX_TEXT_CHARS))
            if not text:
                raise ValueError("it has no text")
            meta = metadata.clean_meta(_str(d, "text_type", 200), _str(d, "doc_date", 20), _str(d, "author", 200))
            tags = metadata.normalize_tags(d.get("tags") if isinstance(d.get("tags"), list) else None)
            kind = _str(d, "kind", 20, "file")
            source = _str(d, "source", 2000)
            added = _str(d, "added", 40)
            check = _str(d, "lang_check", 20)
        except (ValueError, metadata.MetadataError) as exc:
            rep.rejected += 1
            rep.conflict("document", f"Document “{str(d.get('title'))[:60]}”: {exc}")
            continue
        digest = hashlib.sha256(" ".join(text.split()).lower().encode()).hexdigest()
        twin = conn.execute("SELECT id, deleted_at FROM documents WHERE corpus_id=? AND text_hash=?",
                            (corpus["id"], digest)).fetchone()
        if twin:
            rep.existing["documents"] += 1
            if twin["deleted_at"]:
                rep.conflict("document", f"“{title}” is in the Trash of its corpus: it was skipped", title=title)
            else:
                dmap[_ref(d.get("ref"))] = twin["id"]
                rep.conflict("document", f"“{title}” is already in the corpus: skipped", title=title)
            continue
        doc_id = conn.execute(
            """INSERT INTO documents (corpus_id,title,source,kind,text,text_hash,n_tokens,pipeline,lang_check,
                                      text_type,doc_date,author,segmented,fingerprint,added)
               VALUES (?,?,?,?,?,?,0,'',?,?,?,?,?,?,COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP))""",
            (corpus["id"], title, source, kind, text, digest, check, meta["text_type"], meta["doc_date"],
             meta["author"], int(bool(d.get("segmented"))), dedup.sketch(text), added)).lastrowid or 0
        metadata.set_tags(conn, doc_id, tags)
        dmap[_ref(d.get("ref"))] = doc_id
        rep.created["documents"] += 1

    # aligned links (both directions, only between documents that exist now and are not linked yet)
    for d in docs:
        a = dmap.get(_ref(d.get("ref")))
        b = dmap.get(_ref(d.get("pair_ref"))) if d.get("pair_ref") is not None else None
        if not a or not b or a == b:
            continue
        if conn.execute("SELECT pair_doc_id FROM documents WHERE id=?", (a,)).fetchone()[0] is None \
                and conn.execute("SELECT pair_doc_id FROM documents WHERE id=?", (b,)).fetchone()[0] is None:
            conn.execute("UPDATE documents SET pair_doc_id=? WHERE id=?", (b, a))
            conn.execute("UPDATE documents SET pair_doc_id=? WHERE id=?", (a, b))
            rep.created["links"] += 1

    # termbase (the concepts of the file become concepts here: rows that were synonyms stay synonyms)
    concepts: dict[Any, int] = {}
    for t in terms:
        try:
            fields = {k: t.get(k, "") for k in _TERM_FIELDS}
            for k, v in fields.items():
                if v is not None and not isinstance(v, str):
                    raise ValueError(f"{k} must be text")
            entry = termbase.clean({k: v for k, v in fields.items() if v})
            entry.setdefault("status", "candidate")
            entry.setdefault("tgt_term", "")
            termbase.check_consistency(entry)
        except (ValueError, termbase.TermError) as exc:
            rep.rejected += 1
            rep.conflict("term", f"Term “{str(t.get('src_term'))[:60]}”: {exc}")
            continue
        pid = pmap.get(_ref(t.get("project_ref")), project_id) if t.get("project_ref") is not None else project_id
        twin = conn.execute(
            """SELECT id, status, deleted_at FROM terms WHERE IFNULL(project_id,0)=? AND src_lang=? AND tgt_lang=?
               AND lower(src_term)=lower(?) AND lower(tgt_term)=lower(?)""",
            (pid or 0, entry["src_lang"], entry["tgt_lang"], entry["src_term"], entry["tgt_term"])).fetchone()
        if twin and not twin["deleted_at"]:
            rep.existing["terms"] += 1
            if twin["status"] != entry.get("status", "candidate"):
                rep.conflict("term", f"“{entry['src_term']}” → “{entry['tgt_term']}” exists with status "
                                     f"{twin['status']} (file: {entry.get('status', 'candidate')}); kept as it is",
                             term=entry["src_term"])
            continue
        if twin:
            conn.execute("DELETE FROM terms WHERE id=?", (twin["id"],))
        ref = _ref(t.get("concept_ref")) if t.get("concept_ref") is not None else None
        try:
            concept = termbase.assign_concept(conn, pid, entry["src_lang"], entry["tgt_lang"], entry["src_term"],
                                              concepts.get(ref) if ref is not None else None)
        except termbase.TermError:
            concept = termbase.assign_concept(conn, pid, entry["src_lang"], entry["tgt_lang"], entry["src_term"])
        if ref is not None:
            concepts.setdefault(ref, concept)
        conn.execute(
            """INSERT INTO terms (project_id,src_lang,tgt_lang,src_term,tgt_term,pos,status,domain,definition,notes,
                                  context,context_source,origin,concept_id,src_gender,src_number,tgt_gender,
                                  tgt_number,src_note,tgt_note)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (pid, entry["src_lang"], entry["tgt_lang"], entry["src_term"], entry["tgt_term"], entry.get("pos", ""),
             entry.get("status", "candidate"), entry.get("domain", ""), entry.get("definition", ""),
             entry.get("notes", ""), entry.get("context", ""), entry.get("context_source", ""),
             entry.get("origin", "manual"), concept, entry.get("src_gender", ""), entry.get("src_number", ""),
             entry.get("tgt_gender", ""), entry.get("tgt_number", ""), entry.get("src_note", ""),
             entry.get("tgt_note", "")))
        rep.created["terms"] += 1

    for r in rejections:
        try:
            lang, term = _str(r, "lang", 8), " ".join(_str(r, "term", 200).lower().split())
            if lang not in nlp.SUPPORTED or not term:
                raise ValueError("bad entry")
        except ValueError:
            rep.rejected += 1
            continue
        pid = pmap.get(_ref(r.get("project_ref")), project_id) if r.get("project_ref") is not None else project_id
        cur = conn.execute("INSERT OR IGNORE INTO term_rejections (project_id, lang, term) VALUES (?,?,?)",
                           (pid, lang, term))
        rep.created["rejections"] += cur.rowcount
        rep.existing["rejections"] += 1 - cur.rowcount

    rep.corpus_ids = sorted(set(cmap.values()))
    return rep
