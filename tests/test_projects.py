import itertools
import sqlite3

import pytest

from colloca import analysis, db, metadata

from .test_api import ES_TEXT, add, make_corpus, wait_for_jobs

_project_seq = itertools.count(1)


def project(client, name=None):
    """A new project; names are unique per call because the test database is shared by the whole run."""
    r = client.post("/api/projects", json={"name": name or f"Client {next(_project_seq)}"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def doc(client, cid, text, **fields):
    r = client.post(f"/api/corpora/{cid}/documents", json={"title": fields.pop("title", "d"), "text": text, **fields})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def freq(client, cid, **params):
    return {r["item"]: r for r in client.get(f"/api/corpora/{cid}/frequency", params={"min_freq": 1, **params}).json()}


CONTRACT = "El contrato establece las obligaciones del arrendador y las garantías del inquilino durante el plazo."
MANUAL = "El manual describe el funcionamiento del motor y las instrucciones de mantenimiento del equipo."


# --------------------------------------------------------------------------- projects
def test_project_crud_and_corpus_assignment(client):
    pid = project(client, "Client X")
    assert client.post("/api/projects", json={"name": "client x"}).status_code == 409   # case-insensitive
    cid = client.post("/api/corpora", json={"name": "c", "lang": "es", "project_id": pid}).json()["id"]
    assert client.post("/api/corpora", json={"name": "c", "lang": "es", "project_id": 9999}).status_code == 404
    assert next(c for c in client.get("/api/corpora").json() if c["id"] == cid)["project_id"] == pid
    assert next(p for p in client.get("/api/projects").json() if p["id"] == pid)["corpora"] == 1

    assert client.patch(f"/api/projects/{pid}", json={"name": "Client Y", "notes": "NDA"}).status_code == 200
    assert next(p for p in client.get("/api/projects").json() if p["id"] == pid)["name"] == "Client Y"
    assert client.delete(f"/api/projects/{pid}").status_code == 204


def test_move_and_rename_corpus(client):
    a, b = project(client, "A"), project(client, "B")
    cid = make_corpus(client, "es", "old")
    client.patch(f"/api/corpora/{cid}", json={"project_id": a, "name": "new name"})
    c = next(c for c in client.get("/api/corpora").json() if c["id"] == cid)
    assert (c["project_id"], c["name"]) == (a, "new name")
    client.patch(f"/api/corpora/{cid}", json={"project_id": b})
    assert next(c for c in client.get("/api/corpora").json() if c["id"] == cid)["project_id"] == b
    client.patch(f"/api/corpora/{cid}", json={"description": "only this"})             # project untouched
    c = next(c for c in client.get("/api/corpora").json() if c["id"] == cid)
    assert c["project_id"] == b and c["description"] == "only this"
    client.patch(f"/api/corpora/{cid}", json={"project_id": None})
    assert next(c for c in client.get("/api/corpora").json() if c["id"] == cid)["project_id"] is None
    assert client.patch(f"/api/corpora/{cid}", json={"project_id": 9999}).status_code == 404


def test_deleting_a_project_keeps_its_corpora(client):
    pid = project(client)
    cid = client.post("/api/corpora", json={"name": "kept", "lang": "es", "project_id": pid}).json()["id"]
    add(client, cid, ES_TEXT)
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    c = next(c for c in client.get("/api/corpora").json() if c["id"] == cid)
    assert c["project_id"] is None and c["docs"] == 1


def test_base_corpus_cannot_join_a_project(client):
    ref = client.post("/api/references", json={"lang": "es"}).json()["id"]
    assert client.patch(f"/api/corpora/{ref}", json={"project_id": project(client)}).status_code == 400


# --------------------------------------------------------------------------- metadata
def test_metadata_normalisation():
    assert metadata.normalize_tags(" Contrato, cliente  X ,,CONTRATO") == ["contrato", "cliente x"]
    assert metadata.normalize_tags(["A", "a ", "b"]) == ["a", "b"]
    with pytest.raises(metadata.MetadataError):
        metadata.normalize_tags("x" * 41)
    with pytest.raises(metadata.MetadataError):
        metadata.normalize_tags([str(i) for i in range(21)])
    good = ["", "2024", "2024-05", "2024-02-29"]
    assert [metadata.normalize_date(d) for d in good] == good
    for bad in ("24", "2024-13", "2023-02-29", "2024/05/01", "yesterday"):
        with pytest.raises(metadata.MetadataError):
            metadata.normalize_date(bad)


def test_document_metadata_roundtrip_and_validation(client):
    cid = make_corpus(client)
    did = doc(client, cid, ES_TEXT, tags="Contrato, Cliente X", text_type="Contract", doc_date="2023-05",
              author="  Ana  García ")
    d = client.get(f"/api/documents/{did}").json()
    assert d["tags"] == ["cliente x", "contrato"] and d["text_type"] == "contract"
    assert d["doc_date"] == "2023-05" and d["author"] == "Ana García"
    listed = client.get(f"/api/corpora/{cid}/documents").json()[0]
    assert listed["tags"] == ["cliente x", "contrato"] and listed["text_type"] == "contract"
    r = client.post(f"/api/corpora/{cid}/documents", json={"text": MANUAL, "doc_date": "2023-13"})
    assert r.status_code == 400 and "Month" in r.json()["detail"]


def test_patch_document_changes_only_what_is_sent(client):
    cid = make_corpus(client)
    did = doc(client, cid, ES_TEXT, tags="a,b", text_type="manual", doc_date="2022", author="X")
    assert client.patch(f"/api/documents/{did}", json={"tags": ["b", "c"]}).status_code == 200
    d = client.get(f"/api/documents/{did}").json()
    assert d["tags"] == ["b", "c"] and d["text_type"] == "manual" and d["doc_date"] == "2022"
    client.patch(f"/api/documents/{did}", json={"doc_date": "", "title": "Renamed", "tags": ""})
    d = client.get(f"/api/documents/{did}").json()
    assert d["doc_date"] == "" and d["title"] == "Renamed" and d["tags"] == [] and d["author"] == "X"
    assert client.patch(f"/api/documents/{did}", json={"doc_date": "soon"}).status_code == 400
    assert client.patch("/api/documents/999999", json={"tags": "x"}).status_code == 404


def test_upload_applies_metadata_to_every_file(client):
    cid = make_corpus(client)
    files = [("files", ("a.txt", ES_TEXT.encode(), "text/plain")), ("files", ("b.txt", MANUAL.encode(), "text/plain"))]
    client.post(f"/api/corpora/{cid}/upload", files=files,
                params={"tags": "pack1", "text_type": "report", "doc_date": "2024"})
    wait_for_jobs(client, cid)
    docs = client.get(f"/api/corpora/{cid}/documents").json()
    assert len(docs) == 2 and all(d["tags"] == ["pack1"] and d["doc_date"] == "2024" for d in docs)
    bad = client.post(f"/api/corpora/{cid}/upload", files=files, params={"doc_date": "nope"})
    assert bad.status_code == 400


def test_facets(client):
    cid = make_corpus(client)
    doc(client, cid, ES_TEXT, tags="a,b", text_type="contract", doc_date="2021-03")
    doc(client, cid, CONTRACT, tags="a", text_type="contract", doc_date="2023")
    doc(client, cid, MANUAL)
    f = client.get(f"/api/corpora/{cid}/facets").json()
    assert f["tags"] == [{"tag": "a", "docs": 2}, {"tag": "b", "docs": 1}]
    assert f["text_types"] == [{"text_type": "contract", "docs": 2}]
    assert (f["date_min"], f["date_max"]) == ("2021-03", "2023")


# --------------------------------------------------------------------------- filtering analyses
@pytest.fixture()
def filtered(client):
    cid = make_corpus(client)
    ids = {
        "contract": doc(client, cid, CONTRACT, title="contract", tags="legal,2023", text_type="contract",
                        doc_date="2023-04-10"),
        "manual": doc(client, cid, MANUAL, title="manual", tags="technical", text_type="manual", doc_date="2021"),
        "other": doc(client, cid, ES_TEXT, title="other", tags="legal"),
    }
    return cid, ids


def test_filter_by_tag_restricts_counts_and_sizes(client, filtered):
    cid, _ = filtered
    whole = freq(client, cid)
    legal = freq(client, cid, tags="legal")
    assert "contrato" in legal and "motor" not in legal and "motor" in whole
    legal_only = client.get(f"/api/corpora/{cid}/scope", params={"tags": "legal"}).json()
    all_scope = client.get(f"/api/corpora/{cid}/scope").json()
    assert legal_only["filtered"] and legal_only["docs"] == 2 and not all_scope["filtered"] and all_scope["docs"] == 3
    assert legal_only["words"] < all_scope["words"] == legal_only["total_words"]
    # per-million figures use the size of the selected documents
    assert legal["contrato"]["per_million"] == round(legal["contrato"]["freq"] * 1e6 / legal_only["words"], 1)
    assert legal["contrato"]["docs_pct"] == 50.0                                   # 1 of the 2 selected documents


def test_tags_are_all_of_not_any_of(client, filtered):
    cid, _ = filtered
    assert client.get(f"/api/corpora/{cid}/scope", params={"tags": "legal,2023"}).json()["docs"] == 1
    assert client.get(f"/api/corpora/{cid}/scope", params={"tags": "legal,technical"}).json()["docs"] == 0
    assert client.get(f"/api/corpora/{cid}/scope", params={"tags": " LEGAL "}).json()["docs"] == 2   # normalised


def test_filter_by_type_dates_and_ids(client, filtered):
    cid, ids = filtered
    n = lambda **p: client.get(f"/api/corpora/{cid}/scope", params=p).json()["docs"]  # noqa: E731
    assert n(text_type="Contract") == 1 and n(text_type="memo") == 0
    assert n(date_from="2022") == 1                                                # contract only; undated never match
    assert n(date_to="2021-12") == 1 and n(date_to="2020") == 0
    assert n(date_from="2021", date_to="2023-04-10") == 2
    assert n(date_from="2023-04-11") == 0
    assert n(docs=f"{ids['manual']},{ids['other']}") == 2
    assert n(tags="legal", docs=str(ids["manual"])) == 0                           # filters combine with AND
    assert client.get(f"/api/corpora/{cid}/scope", params={"docs": "x"}).status_code == 400
    assert client.get(f"/api/corpora/{cid}/scope", params={"date_from": "soon"}).status_code == 400


def test_every_analysis_respects_the_filter(client, filtered):
    cid, _ = filtered
    p = {"tags": "technical"}
    conc = client.get(f"/api/corpora/{cid}/concordance", params={"q": "el", "unit": "form", **p}).json()
    assert conc["total"] == 2 and {ln["doc"] for ln in conc["lines"]} == {"manual"}
    assert client.get(f"/api/corpora/{cid}/concordance", params={"q": "contrato", **p}).json()["total"] == 0

    col = client.get(f"/api/corpora/{cid}/collocations", params={"q": "motor", "min_freq": 1, **p}).json()
    words = client.get(f"/api/corpora/{cid}/scope", params=p).json()["words"]
    assert col["node_freq"] == 1 and col["corpus_size"] == words
    assert client.get(f"/api/corpora/{cid}/collocations", params={"q": "motor", "min_freq": 1,
                                                                   "tags": "legal"}).json()["node_freq"] == 0

    ng = client.get(f"/api/corpora/{cid}/ngrams", params={"n": 2, "min_freq": 1, "edge_stop": True, **p}).json()
    assert not any("contrato" in r["item"] for r in ng) and any("motor" in r["item"] for r in ng)


def test_keyness_filters_the_studied_corpus_only(client, filtered):
    cid, _ = filtered
    ref = make_corpus(client, "es", "ref")
    doc(client, ref, "La casa es grande y el perro corre por el parque cada mañana con su dueño feliz.")
    rows = client.get(f"/api/corpora/{cid}/keyness", params={"ref": ref, "min_freq": 1, "tags": "technical"}).json()
    items = {r["item"] for r in rows}
    assert "motor" in items and "contrato" not in items
    assert client.get(f"/api/corpora/{ref}/keyness", params={"ref": cid, "min_freq": 1}).status_code == 200


def test_filter_does_not_leak_across_corpora(client, filtered):
    cid, _ = filtered
    other = make_corpus(client, "es", "other")
    doc(client, other, MANUAL, tags="technical")
    assert client.get(f"/api/corpora/{cid}/scope", params={"tags": "technical"}).json()["docs"] == 1


def test_filtered_csv_export(client, filtered):
    cid, _ = filtered
    r = client.get(f"/api/corpora/{cid}/frequency", params={"format": "csv", "tags": "technical", "min_freq": 1})
    assert "motor" in r.text and "contrato" not in r.text


def test_scope_matches_plain_corpus_id_when_unfiltered(tmp_path):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    db.migrate(conn)
    cid = conn.execute("INSERT INTO corpora (name, lang) VALUES ('c','es')").lastrowid
    did = conn.execute("INSERT INTO documents (corpus_id,title,text,text_hash,n_tokens) VALUES (?,?,?,?,?)",
                       (cid, "d", "x", "h", 3)).lastrowid
    conn.executemany("INSERT INTO tokens VALUES (?,?,?,?,?,?,?,?,?,?)",
                     [(did, i, 0, w, w, w, "NOUN", 1, 0, 1) for i, w in enumerate(["a", "b", "a"])])
    assert analysis.frequency(conn, cid) == analysis.frequency(conn, analysis.Scope(cid))
    assert analysis.corpus_size(conn, cid) == analysis.corpus_size(conn, analysis.Scope(cid)) == 3


# --------------------------------------------------------------------------- migration
def test_v3_database_upgrades_and_old_tags_become_filterable(tmp_path):
    conn = sqlite3.connect(tmp_path / "v3.db")
    conn.row_factory = sqlite3.Row
    conn.executescript(db._V1 + db._V2 + db._V3 + "PRAGMA user_version = 3;")
    conn.execute("INSERT INTO corpora (name, lang) VALUES ('Client', 'es')")
    ins = "INSERT INTO documents (corpus_id,title,text,text_hash,tags) VALUES (1,?,'t',?,?)"
    conn.execute(ins, ("d", "h", " Contrato, Cliente X ,,contrato"))
    conn.execute(ins, ("e", "h2", ""))
    conn.commit()
    assert db.migrate(conn) == db.SCHEMA_VERSION
    tags = [tuple(r) for r in conn.execute("SELECT doc_id, tag FROM doc_tags ORDER BY tag")]
    assert tags == [(1, "cliente x"), (1, "contrato")]
    general = conn.execute("SELECT id FROM projects WHERE name = 'General'").fetchone()[0]
    assert conn.execute("SELECT project_id FROM corpora").fetchone()[0] == general    # v15: project-less -> General
    assert conn.execute("SELECT text_type, doc_date, author FROM documents").fetchone()[:] == ("", "", "")
