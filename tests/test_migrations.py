import sqlite3

import pytest

from colloca import db


def columns(conn, table):
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def raw(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def test_fresh_database_reaches_latest_version(tmp_path):
    conn = raw(tmp_path / "a.db")
    assert db.migrate(conn) == db.SCHEMA_VERSION == db.schema_version(conn)
    assert "lang_check" in columns(conn, "documents")
    assert db.migrate(conn) == db.SCHEMA_VERSION            # idempotent


def test_unversioned_mvp_database_is_upgraded_and_backed_up(tmp_path):
    path = tmp_path / "old.db"
    old = raw(path)
    old.executescript(db._V1)                                # what the unversioned MVP created: user_version 0
    old.execute("INSERT INTO corpora (name, lang) VALUES ('Client X', 'es')")
    old.execute("INSERT INTO documents (corpus_id,title,text,text_hash,n_tokens) VALUES (1,'d','hola mundo','h',2)")
    old.commit()
    assert db.schema_version(old) == 0

    backup = tmp_path / "old.db.bak"
    assert db.migrate(old, backup_path=str(backup)) == db.SCHEMA_VERSION

    assert old.execute("SELECT name FROM corpora").fetchone()[0] == "Client X"       # data kept
    doc = old.execute("SELECT title, lang_check FROM documents").fetchone()
    assert (doc["title"], doc["lang_check"]) == ("d", "")                             # new column defaulted
    saved = raw(backup)                                                               # backup = pre-migration state
    assert db.schema_version(saved) == 0 and "lang_check" not in columns(saved, "documents")
    assert saved.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 1


def test_no_backup_for_an_empty_new_database(tmp_path):
    conn = raw(tmp_path / "n.db")
    backup = tmp_path / "n.db.bak"
    db.migrate(conn, backup_path=str(backup))
    assert not backup.exists()


def test_database_from_a_newer_version_is_refused(tmp_path):
    conn = raw(tmp_path / "f.db")
    conn.execute(f"PRAGMA user_version = {db.SCHEMA_VERSION + 1}")
    with pytest.raises(RuntimeError, match="newer"):
        db.migrate(conn)


def test_failed_migration_rolls_back_completely(tmp_path, monkeypatch):
    conn = raw(tmp_path / "x.db")
    db.migrate(conn)
    bad = "CREATE TABLE half_done (id INTEGER); ALTER TABLE no_such_table ADD COLUMN x TEXT;"
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS + [(db.SCHEMA_VERSION + 1, bad)])
    monkeypatch.setattr(db, "SCHEMA_VERSION", db.SCHEMA_VERSION + 1)
    with pytest.raises(sqlite3.Error):
        db.migrate(conn)
    assert db.schema_version(conn) == db.SCHEMA_VERSION - 1                          # version not bumped
    assert conn.execute("SELECT 1 FROM sqlite_master WHERE name='half_done'").fetchone() is None
