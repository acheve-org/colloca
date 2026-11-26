import contextlib
import sqlite3

import pytest

from colloca import cql, db, languages, nlp


def _add_corpus(lang, deleted=False):
    with db.session() as conn:
        conn.execute("INSERT INTO corpora (name,lang,deleted_at) VALUES ('c',?,?)",
                     (lang, "2026-01-01" if deleted else None))


@pytest.fixture()
def xx(client):
    languages.add("xx", "Testish", "sm", "xxx")
    yield
    with db.session() as conn:
        conn.execute("DELETE FROM corpora WHERE lang='xx'")
    with contextlib.suppress(KeyError):
        languages.remove("xx")


def test_add_get_update_remove_roundtrip(xx):
    assert languages.get("xx").name == "Testish"
    with pytest.raises(ValueError):
        languages.add("xx", "Again", None, "")
    languages.update("xx", name="Other", model_size=None, tesseract="yyy")
    got = languages.get("xx")
    assert (got.name, got.model_size, got.tesseract) == ("Other", None, "yyy")
    languages.update("xx", name="Third")                 # model_size left untouched
    assert languages.get("xx").model_size is None
    languages.remove("xx")
    assert languages.get("xx") is None
    with pytest.raises(KeyError):
        languages.update("xx", name="n")


def test_remove_refused_with_live_corpus(xx):
    _add_corpus("xx")
    with pytest.raises(languages.LanguageInUse) as e:
        languages.remove("xx")
    assert e.value.count == 1


def test_remove_refused_when_only_trashed_corpus_exists(xx):
    _add_corpus("xx", deleted=True)
    with pytest.raises(languages.LanguageInUse) as e:
        languages.remove("xx")
    assert e.value.count == 1


def test_registry_mapping_is_live(client):
    assert "xx" not in nlp.SUPPORTED
    languages.add("xx", "Name", None, "")
    try:
        assert nlp.SUPPORTED["xx"] == "Name"
        assert "xx" in list(nlp.SUPPORTED)
    finally:
        languages.remove("xx")
    assert "xx" not in nlp.SUPPORTED


def test_migration_v14_seeds_on_existing_database(tmp_path):
    conn = sqlite3.connect(tmp_path / "a.db")
    conn.row_factory = sqlite3.Row
    conn.executescript(db._V1)
    conn.execute("INSERT INTO corpora (name, lang) VALUES ('Client X', 'es')")
    conn.commit()
    db.migrate(conn)
    rows = conn.execute("SELECT code, name, model_size, tesseract FROM languages ORDER BY added, code").fetchall()
    assert [tuple(r) for r in rows] == [("es", "Spanish", None, "spa"), ("it", "Italian", None, "ita")]


def test_migration_v14_seeds_when_only_terms_exist(tmp_path):
    conn = sqlite3.connect(tmp_path / "t.db")
    cql.register(conn)
    for version, sql in db.MIGRATIONS:
        if version < 14:
            conn.executescript(sql)
    conn.execute("PRAGMA user_version = 13")
    conn.execute("INSERT INTO terms (src_lang, tgt_lang, src_term) VALUES ('es', 'it', 'casa')")
    conn.commit()
    db.migrate(conn)
    assert [r[0] for r in conn.execute("SELECT code FROM languages ORDER BY code")] == ["es", "it"]


def test_fresh_install_sets_up_no_language(tmp_path):
    conn = sqlite3.connect(tmp_path / "fresh.db")
    db.migrate(conn)
    assert conn.execute("SELECT COUNT(*) FROM languages").fetchone()[0] == 0
