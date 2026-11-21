"""SQLite storage. One database file holds every corpus (self-hosted, single user)."""
import os
import sqlite3
from contextlib import contextmanager

DATA_DIR = os.environ.get("CORPUS_DATA_DIR", "./data")
DB_PATH = os.path.join(DATA_DIR, "corpus.db")

SCHEMA = """
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


def connect() -> sqlite3.Connection:
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)


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
