import sqlite3

import pytest

from colloca import cql, db


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


def v14(path):
    conn = raw(path)
    cql.register(conn)
    for version, sql in db.MIGRATIONS:
        if version <= 14:
            conn.executescript(sql)
    conn.execute("PRAGMA user_version = 14")
    conn.commit()
    return conn


def general_ids(conn):
    return [r[0] for r in conn.execute("SELECT id FROM projects WHERE name = 'General' COLLATE NOCASE")]


def test_v15_moves_projectless_corpora_into_general(tmp_path):
    conn = v14(tmp_path / "a.db")
    conn.execute("INSERT INTO corpora (id, name, lang) VALUES (1, 'work', 'es')")
    conn.execute("INSERT INTO corpora (id, name, lang, is_reference) VALUES (2, 'base', 'es', 1)")
    conn.execute("INSERT INTO corpora (id, name, lang, deleted_at) VALUES (3, 'trashed', 'it', '2026-01-01 00:00:00')")
    conn.commit()
    assert db.migrate(conn) == 15
    (gid,) = general_ids(conn)

    def pid(table, row_id):
        return conn.execute(f"SELECT project_id FROM {table} WHERE id = ?", (row_id,)).fetchone()[0]

    assert pid("corpora", 1) == gid and pid("corpora", 3) == gid
    assert pid("corpora", 2) is None


def test_v15_reuses_an_existing_general_project_case_insensitively(tmp_path):
    conn = v14(tmp_path / "b.db")
    conn.execute("INSERT INTO projects (id, name) VALUES (7, 'general')")
    conn.execute("INSERT INTO corpora (name, lang) VALUES ('work', 'es')")
    conn.commit()
    db.migrate(conn)
    assert conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 1
    assert conn.execute("SELECT project_id FROM corpora").fetchone()[0] == 7


def test_v15_creates_nothing_when_nothing_is_unassigned(tmp_path):
    conn = v14(tmp_path / "c.db")
    conn.execute("INSERT INTO projects (id, name) VALUES (1, 'Acme')")
    conn.execute("INSERT INTO corpora (name, lang, project_id) VALUES ('work', 'es', 1)")
    conn.commit()
    db.migrate(conn)
    assert general_ids(conn) == []
    fresh = raw(tmp_path / "d.db")
    db.migrate(fresh)
    assert general_ids(fresh) == []


def test_v15_is_idempotent(tmp_path):
    conn = v14(tmp_path / "e.db")
    conn.execute("INSERT INTO corpora (name, lang) VALUES ('work', 'es')")
    conn.commit()
    db.migrate(conn)
    db.migrate(conn)
    assert len(general_ids(conn)) == 1


def test_v15_leaves_the_general_termbase_alone_and_creates_no_general_for_it(tmp_path):
    conn = v14(tmp_path / "f.db")
    conn.execute("INSERT INTO terms (src_lang, tgt_lang, src_term) VALUES ('es', 'it', 'casa')")
    conn.execute("INSERT INTO term_rejections (lang, term) VALUES ('es', 'foo')")
    conn.commit()
    assert db.migrate(conn) == 15
    assert general_ids(conn) == []
    assert conn.execute("SELECT project_id FROM terms").fetchone()[0] is None
    assert conn.execute("SELECT project_id FROM term_rejections").fetchone()[0] is None


def test_v15_keeps_null_terms_null_even_when_general_is_created_for_corpora(tmp_path):
    conn = v14(tmp_path / "g.db")
    conn.execute("INSERT INTO corpora (name, lang) VALUES ('work', 'es')")
    conn.execute("INSERT INTO terms (src_lang, tgt_lang, src_term) VALUES ('es', 'it', 'casa')")
    conn.execute("INSERT INTO term_rejections (lang, term) VALUES ('es', 'foo')")
    conn.commit()
    db.migrate(conn)
    assert len(general_ids(conn)) == 1
    assert conn.execute("SELECT project_id FROM terms").fetchone()[0] is None
    assert conn.execute("SELECT project_id FROM term_rejections").fetchone()[0] is None
