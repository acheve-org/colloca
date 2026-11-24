"""The Trash: soft delete of corpora, documents and terms (T14).

Deleting sets `deleted_at`; every query in the application ignores such rows. A trashed row keeps all of its
data (tokens, segments, tags, its link to the aligned partner), so restoring it brings everything back. Rows
are removed for good by `delete_forever` / `empty`, or by `purge_expired` once they are older than the
retention period (setting `trash_days`, default 30; 0 keeps the Trash until it is emptied by hand).
"""
import sqlite3

KINDS = ("corpus", "document", "term")
_TABLE = {"corpus": "corpora", "document": "documents", "term": "terms"}
DEFAULT_DAYS = 30
MAX_DAYS = 3650
_NOW = "strftime('%Y-%m-%d %H:%M:%S','now')"


class TrashError(ValueError):
    """A request the Trash cannot honour (status is the HTTP code to answer with)."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# --------------------------------------------------------------------------- retention
def retention_days(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT value FROM settings WHERE key='trash_days'").fetchone()
    try:
        return max(0, min(MAX_DAYS, int(row["value"]))) if row else DEFAULT_DAYS
    except (TypeError, ValueError):
        return DEFAULT_DAYS


def set_retention_days(conn: sqlite3.Connection, days: int) -> int:
    if not 0 <= days <= MAX_DAYS:
        raise TrashError(f"Retention must be between 0 (keep until emptied) and {MAX_DAYS} days")
    conn.execute("INSERT INTO settings (key, value) VALUES ('trash_days', ?) "
                 "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(days),))
    return days


def purge_expired(conn: sqlite3.Connection) -> dict[str, int]:
    """Remove what has been in the Trash longer than the retention period."""
    days = retention_days(conn)
    out = {k: 0 for k in KINDS}
    if days <= 0:
        return out
    limit = f"datetime('now', '-{int(days)} days')"
    for kind in KINDS:     # corpora first: their documents go with them
        out[kind] = conn.execute(f"DELETE FROM {_TABLE[kind]} WHERE deleted_at IS NOT NULL AND deleted_at <= {limit}"
                                 ).rowcount
    return out


# --------------------------------------------------------------------------- move to the Trash
def _mark(conn, kind: str, ids: list[int]) -> int:
    if not ids:
        return 0
    marks = ",".join("?" * len(ids))
    return conn.execute(f"UPDATE {_TABLE[kind]} SET deleted_at={_NOW} WHERE deleted_at IS NULL AND id IN ({marks})",
                        ids).rowcount


def trash_corpus(conn, corpus_id: int) -> int:
    """A base (reference) corpus gives up its place while in the Trash (only one per language is allowed, and a
    new one may be wanted); restoring it takes the place back if it is still free."""
    conn.execute("UPDATE corpora SET was_reference=is_reference, is_reference=0 WHERE id=? AND deleted_at IS NULL",
                 (corpus_id,))
    return _mark(conn, "corpus", [corpus_id])


def trash_documents(conn, ids: list[int]) -> int:
    return _mark(conn, "document", ids)


def trash_terms(conn, ids: list[int]) -> int:
    return _mark(conn, "term", ids)


# --------------------------------------------------------------------------- the listing
def listing(conn: sqlite3.Connection) -> dict:
    corpora = conn.execute(
        """SELECT c.id, c.name, c.lang, c.was_reference AS is_reference, c.deleted_at, COUNT(d.id) AS docs,
                  COALESCE(SUM(d.n_tokens), 0) AS tokens
           FROM corpora c LEFT JOIN documents d ON d.corpus_id=c.id AND d.deleted_at IS NULL
           WHERE c.deleted_at IS NOT NULL GROUP BY c.id ORDER BY c.deleted_at DESC, c.id DESC""").fetchall()
    # documents of a trashed corpus are not listed apart: they come back with the corpus
    docs = conn.execute(
        """SELECT d.id, d.title, d.source, d.n_tokens, d.deleted_at, d.corpus_id, c.name AS corpus,
                  (d.pair_doc_id IS NOT NULL) AS aligned, p.title AS partner
           FROM documents d JOIN corpora c ON c.id=d.corpus_id LEFT JOIN documents p ON p.id=d.pair_doc_id
           WHERE d.deleted_at IS NOT NULL AND c.deleted_at IS NULL
           ORDER BY d.deleted_at DESC, d.id DESC""").fetchall()
    terms = conn.execute(
        """SELECT t.id, t.src_term, t.tgt_term, t.src_lang, t.tgt_lang, t.status, t.deleted_at, p.name AS project
           FROM terms t LEFT JOIN projects p ON p.id=t.project_id WHERE t.deleted_at IS NOT NULL
           ORDER BY t.deleted_at DESC, t.id DESC""").fetchall()
    days = retention_days(conn)
    return {"retention_days": days, "corpora": [dict(r) for r in corpora], "documents": [dict(r) for r in docs],
            "terms": [dict(r) for r in terms]}


# --------------------------------------------------------------------------- restore and remove for good
def restore(conn: sqlite3.Connection, kind: str, ids: list[int]) -> int:
    if kind not in KINDS:
        raise TrashError(f"kind must be one of {', '.join(KINDS)}")
    if not ids:
        return 0
    marks = ",".join("?" * len(ids))
    if kind == "document":
        blocked = conn.execute(
            f"""SELECT DISTINCT c.name FROM documents d JOIN corpora c ON c.id=d.corpus_id
                WHERE d.id IN ({marks}) AND d.deleted_at IS NOT NULL AND c.deleted_at IS NOT NULL""", ids).fetchall()
        if blocked:
            raise TrashError("Restore the corpus first: " + ", ".join(r["name"] for r in blocked), 409)
    n = conn.execute(f"UPDATE {_TABLE[kind]} SET deleted_at=NULL WHERE deleted_at IS NOT NULL AND id IN ({marks})",
                     ids).rowcount
    if kind == "corpus":
        for cid in ids:
            row = conn.execute("SELECT lang FROM corpora WHERE id=? AND was_reference=1 AND is_reference=0",
                               (cid,)).fetchone()
            if row and not conn.execute("SELECT 1 FROM corpora WHERE lang=? AND is_reference=1",
                                        (row["lang"],)).fetchone():
                conn.execute("UPDATE corpora SET is_reference=1, project_id=NULL WHERE id=?", (cid,))
            conn.execute("UPDATE corpora SET was_reference=0 WHERE id=?", (cid,))
    return n


def delete_forever(conn: sqlite3.Connection, kind: str, ids: list[int]) -> int:
    """Remove trashed rows for good (only rows already in the Trash can be removed this way)."""
    if kind not in KINDS:
        raise TrashError(f"kind must be one of {', '.join(KINDS)}")
    if not ids:
        return 0
    marks = ",".join("?" * len(ids))
    return conn.execute(f"DELETE FROM {_TABLE[kind]} WHERE deleted_at IS NOT NULL AND id IN ({marks})", ids).rowcount


def empty(conn: sqlite3.Connection) -> dict[str, int]:
    return {kind: conn.execute(f"DELETE FROM {_TABLE[kind]} WHERE deleted_at IS NOT NULL").rowcount
            for kind in KINDS}


def trashed_corpus_ids(conn: sqlite3.Connection, ids: list[int]) -> list[int]:
    if not ids:
        return []
    return [r[0] for r in conn.execute(
        f"SELECT id FROM corpora WHERE deleted_at IS NOT NULL AND id IN ({','.join('?' * len(ids))})", ids)]
