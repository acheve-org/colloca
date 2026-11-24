"""SQLite storage. One database file holds every corpus (self-hosted, single user).

The schema is versioned with SQLite's `PRAGMA user_version` and evolved by the ordered
MIGRATIONS list below. Rules: never edit a released migration, only append a new one.
Before an existing database is migrated, a consistent copy is saved next to it.
"""
import logging
import os
import sqlite3
from contextlib import contextmanager

from . import cql

log = logging.getLogger("colloca.db")

DATA_DIR = os.environ.get("COLLOCA_DATA_DIR", "./data")
DB_PATH = os.path.join(DATA_DIR, "corpus.db")

# --- v1: the original MVP schema (idempotent, so databases created before versioning adopt it)
_V1 = """
CREATE TABLE IF NOT EXISTS corpora (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    lang TEXT NOT NULL,
    description TEXT DEFAULT '',
    created TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY,
    corpus_id INTEGER NOT NULL REFERENCES corpora(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source TEXT DEFAULT '',          -- URL or file name
    kind TEXT DEFAULT 'text',        -- url | file | paste
    tags TEXT DEFAULT '',
    text TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    n_tokens INTEGER DEFAULT 0,      -- alphabetic tokens
    pipeline TEXT DEFAULT '',        -- NLP model name + version, for reproducibility
    added TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (corpus_id, text_hash)
);
CREATE TABLE IF NOT EXISTS tokens (
    doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL,            -- token index inside the document
    sent INTEGER NOT NULL,           -- sentence index inside the document
    form TEXT NOT NULL,
    norm TEXT NOT NULL,              -- lower-cased form
    lemma TEXT NOT NULL,             -- lower-cased lemma
    upos TEXT NOT NULL,
    alpha INTEGER NOT NULL,
    stop INTEGER NOT NULL,
    sp INTEGER NOT NULL,             -- followed by a space in the original text
    PRIMARY KEY (doc_id, pos)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_tokens_lemma ON tokens(lemma);
CREATE INDEX IF NOT EXISTS idx_tokens_norm ON tokens(norm);
CREATE INDEX IF NOT EXISTS idx_docs_corpus ON documents(corpus_id);
"""

# --- v2: result of the language check made at import time ('' = not checked, e.g. older documents)
_V2 = """
ALTER TABLE documents ADD COLUMN lang_check TEXT NOT NULL DEFAULT '';  -- ok|mismatch|uncertain|short
"""

# --- v3: a corpus can be the language's general "base" (reference) corpus; at most one per language
_V3 = """
ALTER TABLE corpora ADD COLUMN is_reference INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_one_reference_per_lang ON corpora(lang) WHERE is_reference = 1;
"""

# --- v4: projects (clients) grouping corpora, and document metadata that analyses can filter on.
# Tags move from the free-text documents.tags column (never used by the UI) to a proper table.
_V4 = r"""
CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created TEXT DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE corpora ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX idx_corpora_project ON corpora(project_id);
ALTER TABLE documents ADD COLUMN text_type TEXT NOT NULL DEFAULT '';   -- e.g. contract, manual, press release
ALTER TABLE documents ADD COLUMN doc_date TEXT NOT NULL DEFAULT '';    -- YYYY, YYYY-MM or YYYY-MM-DD
ALTER TABLE documents ADD COLUMN author TEXT NOT NULL DEFAULT '';
CREATE TABLE doc_tags (
    doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (doc_id, tag)
) WITHOUT ROWID;
CREATE INDEX idx_doc_tags_tag ON doc_tags(tag);
INSERT OR IGNORE INTO doc_tags (doc_id, tag)
    SELECT d.id, lower(trim(j.value))
    FROM documents d,
         json_each('["' || replace(replace(replace(d.tags, char(92), ''), '"', ''), ',', '","') || '"]') j
    WHERE trim(j.value) <> '';
"""

# --- v5: the termbase. One row = one (source term, translation) pair of a project; project_id NULL is
# the general termbase for corpora that belong to no project.
_V5 = """
CREATE TABLE terms (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    src_lang TEXT NOT NULL,
    tgt_lang TEXT NOT NULL,
    src_term TEXT NOT NULL,
    tgt_term TEXT NOT NULL DEFAULT '',            -- '' = candidate still to be translated
    pos TEXT NOT NULL DEFAULT '',                 -- TBX values: noun, verb, adjective, adverb, properNoun, other
    status TEXT NOT NULL DEFAULT 'candidate',     -- candidate | approved | forbidden (do not use this translation)
    domain TEXT NOT NULL DEFAULT '',
    definition TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    context TEXT NOT NULL DEFAULT '',             -- example sentence in the source language
    context_source TEXT NOT NULL DEFAULT '',      -- title of the document it comes from
    origin TEXT NOT NULL DEFAULT 'manual',        -- manual | frequency | keyness | collocation | ngram
    created TEXT DEFAULT CURRENT_TIMESTAMP,
    updated TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_terms_unique ON terms (
    IFNULL(project_id, 0), src_lang, tgt_lang, lower(src_term), lower(tgt_term));
CREATE INDEX idx_terms_project ON terms (project_id, src_lang, tgt_lang);
"""

# --- v6: parallel (aligned) texts. A segmented document is stored one segment per line; `segments` keeps the
# token span of each segment, and `pair_doc_id` points to the document holding the translations: segment N of
# one is the translation of segment N of the other. Both documents live in ordinary corpora of their own language.
_V6 = """
ALTER TABLE documents ADD COLUMN segmented INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN pair_doc_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;
CREATE INDEX idx_docs_pair ON documents(pair_doc_id);
CREATE TABLE segments (
    doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    seg INTEGER NOT NULL,
    start_pos INTEGER NOT NULL,        -- first token of the segment
    end_pos INTEGER NOT NULL,          -- one past the last token
    PRIMARY KEY (doc_id, seg)
) WITHOUT ROWID;
"""

# --- v7: the stop list of candidate review. A term dropped from the candidate tables of a project (NULL = no
# project) in one language is lowercased here and no longer proposed there; other projects are unaffected.
_V7 = """
CREATE TABLE term_rejections (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    lang TEXT NOT NULL,
    term TEXT NOT NULL,                           -- lowercase, whitespace-normalised
    created TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_rejections_unique ON term_rejections (IFNULL(project_id, 0), lang, term);
"""

# --- v8: accent-insensitive search (T13). Expression indexes on the accent-stripped form and lemma: SQLite builds
# (backfills) them from the existing tokens right here, and keeps them current for every later insert. They call
# colloca_ascii(), which connect() and migrate() register; tokens keeps its columns, so nothing else changes.
_V8 = """
CREATE INDEX idx_tokens_norm_ascii ON tokens(colloca_ascii(norm));
CREATE INDEX idx_tokens_lemma_ascii ON tokens(colloca_ascii(lemma));
"""

# --- v9: near-duplicate detection (T16). `fingerprint` is the MinHash sketch of the text (see dedup.py). It is NULL
# for documents imported before this version; dedup.ensure_fingerprints computes it lazily (SQL cannot).
_V9 = """
ALTER TABLE documents ADD COLUMN fingerprint BLOB;
"""

# --- v10: the Trash (T14). Deleting a corpus, document or term sets `deleted_at` instead of removing the row;
# every query ignores rows where it is set, and trash.py restores them or removes them for good (after the
# retention period, or on request). `settings` holds the few user-adjustable values (trash retention).
_V10 = """
ALTER TABLE corpora ADD COLUMN deleted_at TEXT;
ALTER TABLE corpora ADD COLUMN was_reference INTEGER NOT NULL DEFAULT 0;   -- a trashed base corpus gives up its slot
ALTER TABLE documents ADD COLUMN deleted_at TEXT;
ALTER TABLE terms ADD COLUMN deleted_at TEXT;
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
) WITHOUT ROWID;
"""

MIGRATIONS: list[tuple[int, str]] = [(1, _V1), (2, _V2), (3, _V3), (4, _V4), (5, _V5), (6, _V6), (7, _V7), (8, _V8),
                                     (9, _V9), (10, _V10)]
SCHEMA_VERSION = MIGRATIONS[-1][0]


def connect(path: str | None = None) -> sqlite3.Connection:
    path = path or DB_PATH
    if path != ":memory:":
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    cql.register(conn)
    return conn


def schema_version(conn: sqlite3.Connection) -> int:
    return conn.execute("PRAGMA user_version").fetchone()[0]


def _has_data(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='corpora'").fetchone() is not None


def migrate(conn: sqlite3.Connection, backup_path: str | None = None) -> int:
    """Apply pending migrations, each in its own transaction. Returns the final version.

    An existing database (one that already has tables) is copied to `backup_path` first.
    """
    cql.register(conn)
    current = schema_version(conn)
    if current > SCHEMA_VERSION:
        raise RuntimeError(f"Database schema v{current} is newer than this Colloca (v{SCHEMA_VERSION}); "
                           "upgrade Colloca instead of opening it with an older version.")
    pending = [(v, sql) for v, sql in MIGRATIONS if v > current]
    if not pending:
        return current
    if backup_path and _has_data(conn):
        dest = sqlite3.connect(backup_path)
        try:
            conn.backup(dest)
        finally:
            dest.close()
        log.info("Backed up database to %s before migrating v%d -> v%d", backup_path, current, SCHEMA_VERSION)
    for version, sql in pending:
        try:
            # executescript runs the whole script verbatim, so BEGIN..COMMIT makes the schema change
            # and the version bump (user_version is transactional) atomic.
            conn.executescript(f"BEGIN;\n{sql}\nPRAGMA user_version = {version};\nCOMMIT;")
        except Exception:
            if conn.in_transaction:
                conn.rollback()
            log.exception("Migration to v%d failed; database left at v%d", version, schema_version(conn))
            raise
        log.info("Migrated database to v%d", version)
    return SCHEMA_VERSION


def init_db() -> None:
    conn = connect()
    try:
        migrate(conn, backup_path=f"{DB_PATH}.bak-v{schema_version(conn)}")
    finally:
        conn.close()


@contextmanager
def session():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
