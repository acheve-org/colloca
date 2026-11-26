import sqlite3

import pytest

from corpora import candidates, db

from .test_jobanalysis import CLIENT, report
from .test_projects import doc, project

TEXT = ("El contrato fija el plazo de entrega. El plazo de entrega es esencial. "
        "El contrato incluye el plazo de pago y el plazo de entrega.")


@pytest.fixture(autouse=True)
def _clean(client):
    with db.session() as conn:
        conn.execute("DELETE FROM terms")
        conn.execute("DELETE FROM term_rejections")


def corpus_in(client, pid, text=TEXT):
    cid = client.post("/api/corpora", json={"name": f"c{pid}", "lang": "es", "project_id": pid}).json()["id"]
    doc(client, cid, text)
    return cid


def rows(client, cid, path="frequency", **params):
    r = client.get(f"/api/corpora/{cid}/{path}", params={"min_freq": 1, **params})
    assert r.status_code == 200, r.text
    return {x["item"]: x for x in r.json()}


def drop(client, cid, *terms):
    return client.post(f"/api/corpora/{cid}/rejections", json={"terms": list(terms)})


# --------------------------------------------------------------------------- stop list scoping
def test_drop_is_scoped_to_project_and_language(client):
    a, b = project(client), project(client)
    ca, cb = corpus_in(client, a), corpus_in(client, b)
    assert drop(client, ca, "Plazo", " plazo ").json() == {"added": 1}      # case and spaces normalised
    assert rows(client, ca)["plazo"]["dropped"] is True
    assert rows(client, cb)["plazo"]["dropped"] is False                      # other project untouched
    assert rows(client, ca)["contrato"]["dropped"] is False
    # a second corpus of the same project shares the stop list; another language does not
    ca2 = corpus_in(client, a)
    assert rows(client, ca2)["plazo"]["dropped"] is True
    ci = client.post("/api/corpora", json={"name": "it", "lang": "it", "project_id": a}).json()["id"]
    assert client.get(f"/api/corpora/{ci}/rejections").json() == []
    assert [r["term"] for r in client.get(f"/api/corpora/{ca}/rejections").json()] == ["plazo"]


def test_restore(client):
    a = project(client)
    ca = corpus_in(client, a)
    drop(client, ca, "plazo", "contrato")
    assert client.post(f"/api/corpora/{ca}/rejections/restore", json={"terms": ["Plazo"]}).json() == {"restored": 1}
    assert rows(client, ca)["plazo"]["dropped"] is False
    assert rows(client, ca)["contrato"]["dropped"] is True
    assert client.post(f"/api/corpora/{ca}/rejections/restore", json={"terms": ["plazo"]}).json() == {"restored": 0}


def test_dropped_hidden_data_is_marked_in_every_candidate_list(client):
    a = project(client)
    ca = corpus_in(client, a)
    drop(client, ca, "plazo de entrega")
    assert rows(client, ca, "ngrams", n=3)["plazo de entrega"]["dropped"] is True
    col = client.get(f"/api/corpora/{ca}/collocations", params={"q": "contrato"}).json()["rows"]
    assert all({"dropped", "in_termbase"} <= set(r) for r in col)
    assert "dropped" not in client.get(f"/api/corpora/{ca}/frequency", params={"format": "csv"}).text.splitlines()[0]


def test_job_tables_follow_the_stop_list_of_their_project(client):
    a, b = project(client), project(client)
    ca, cb = corpus_in(client, a, CLIENT), corpus_in(client, b, CLIENT)
    rep_a = report(client, ca, min_corpus_freq=5)
    assert {r["item"]: r["dropped"] for r in rep_a["gaps"]}["plazo"] is False
    drop(client, ca, "plazo")
    gaps = lambda c: {r["item"]: r for r in report(client, c, min_corpus_freq=5)["gaps"]}   # noqa: E731
    assert gaps(ca)["plazo"]["dropped"] is True
    assert gaps(cb)["plazo"]["dropped"] is False


# --------------------------------------------------------------------------- in termbase
def test_in_termbase_by_lemma_and_phrase_by_form(client):
    a, b = project(client), project(client)
    ca, cb = corpus_in(client, a), corpus_in(client, b)
    mk = lambda **f: client.post("/api/terms", json={"src_lang": "es", "project_id": a, **f})   # noqa: E731
    assert mk(src_term="plazo", tgt_term="termine", status="admitted").status_code == 201
    assert mk(src_term="plazo de entrega", tgt_term="termine di consegna", status="superseded").status_code == 201
    assert mk(src_term="contratar").status_code == 201                                        # a candidate counts too
    f = rows(client, ca)
    assert f["plazo"]["in_termbase"] == "admitted"
    assert f["contrato"]["in_termbase"] == ""
    assert rows(client, ca, "ngrams", n=3)["plazo de entrega"]["in_termbase"] == "superseded"
    assert rows(client, cb)["plazo"]["in_termbase"] == ""                    # other project's termbase


def test_in_termbase_matches_a_lemma_of_an_inflected_entry_and_follows_edits(client):
    a = project(client)
    ca = corpus_in(client, a)
    r = client.post("/api/terms", json={"src_lang": "es", "project_id": a, "src_term": "plazos",
                                        "tgt_term": "termini", "status": "approved"})
    tid = r.json()["id"]
    assert rows(client, ca)["plazo"]["in_termbase"] == "approved"            # entry lemma == candidate lemma
    client.patch(f"/api/terms/{tid}", json={"status": "forbidden"})
    assert rows(client, ca)["plazo"]["in_termbase"] == "forbidden"           # cache follows the termbase version
    client.post("/api/terms/delete", json={"ids": [tid]})
    assert rows(client, ca)["plazo"]["in_termbase"] == ""


def test_term_status_endpoint_and_job_report(client):
    a = project(client)
    ca = corpus_in(client, a, CLIENT)
    client.post("/api/terms", json={"src_lang": "es", "project_id": a, "src_term": "plazo", "tgt_term": "t",
                                    "status": "approved"})
    got = client.post(f"/api/corpora/{ca}/term-status", json={"terms": ["Plazo", "casa"]}).json()
    assert [(r["item"], r["in_termbase"]) for r in got] == [("Plazo", "approved"), ("casa", "")]
    gaps = {r["item"]: r for r in report(client, ca, min_corpus_freq=5)["gaps"]}
    assert gaps["plazo"]["in_termbase"] == "approved"


def test_index_is_cached_per_termbase_version(client, monkeypatch):
    a = project(client)
    ca = corpus_in(client, a)
    client.post("/api/terms", json={"src_lang": "es", "project_id": a, "src_term": "plazo", "tgt_term": "t",
                                    "status": "approved"})
    calls = []
    real = candidates._build
    monkeypatch.setattr(candidates, "_build", lambda *args: calls.append(1) or real(*args))
    rows(client, ca)
    rows(client, ca)
    assert len(calls) <= 1
    client.post("/api/terms", json={"src_lang": "es", "project_id": a, "src_term": "garantía"})
    rows(client, ca)
    assert len(calls) <= 2 and len(calls) >= 1


# --------------------------------------------------------------------------- migration
def test_migration_adds_rejections_and_keeps_data(tmp_path):
    path = tmp_path / "v6.db"
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    for version, sql in db.MIGRATIONS[:6]:
        conn.executescript(f"BEGIN;\n{sql}\nPRAGMA user_version = {version};\nCOMMIT;")
    conn.execute("INSERT INTO projects (name) VALUES ('P')")
    conn.execute("INSERT INTO terms (project_id, src_lang, tgt_lang, src_term) VALUES (1,'es','it','plazo')")
    conn.commit()
    assert db.schema_version(conn) == 6
    assert db.migrate(conn) == db.SCHEMA_VERSION >= 7
    assert conn.execute("SELECT src_term FROM terms").fetchone()[0] == "plazo"
    conn.execute("INSERT INTO term_rejections (project_id, lang, term) VALUES (1,'es','plazo')")
    conn.execute("INSERT INTO term_rejections (project_id, lang, term) VALUES (NULL,'es','plazo')")
    for pid in (1, None):                                       # unique per project (NULL counts as one scope)
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO term_rejections (project_id, lang, term) VALUES (?,'es','plazo')", (pid,))
    conn.execute("DELETE FROM projects WHERE id=1")             # the stop list goes with its project
    assert conn.execute("SELECT COUNT(*) FROM term_rejections").fetchone()[0] == 1
