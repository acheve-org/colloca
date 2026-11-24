"""T14: Trash (soft delete, restore, retention), project/database export and import. Synthetic fixtures only."""
import io
import json
import zipfile

import pytest

from colloca import backup, db, trash

from .test_api import ES_TEXT, add, make_corpus, wait_for_jobs
from .test_parallel import build_pairs, import_tmx, tmx
from .test_projects import project

IT_TEXT = ("Il contratto stabilisce gli obblighi del locatore per tutta la durata dell'affitto. "
           "Il conduttore deve pagare il canone ogni mese e conservare l'immobile con cura.")


@pytest.fixture(autouse=True)
def _clean(client):
    with db.session() as conn:
        conn.execute("DELETE FROM terms")
        conn.execute("DELETE FROM settings")
        conn.execute("DELETE FROM corpora WHERE deleted_at IS NOT NULL")
        conn.execute("DELETE FROM documents WHERE deleted_at IS NOT NULL")


def term(client, pid, **fields):
    body = {"src_lang": "es", "src_term": "contrato", "tgt_term": "contratto", "status": "approved",
            "project_id": pid, **fields}
    r = client.post("/api/terms", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def ids(client, kind):
    return {x["id"] for x in client.get("/api/trash").json()[kind]}


# --------------------------------------------------------------------------- soft delete
def test_deleted_document_leaves_every_query_and_comes_back_whole(client):
    cid = make_corpus(client, "es")
    keep = add(client, cid, ES_TEXT, "keep").json()
    gone = add(client, cid, ES_TEXT + " Otra frase distinta sobre el arrendamiento de la vivienda habitual.",
               "gone").json()
    client.patch(f"/api/documents/{gone['id']}", json={"tags": ["x"], "author": "Ana", "doc_date": "2024-05"})
    before = client.get(f"/api/corpora/{cid}/frequency").json()
    assert client.delete(f"/api/documents/{gone['id']}").status_code == 204
    assert [d["id"] for d in client.get(f"/api/corpora/{cid}/documents").json()] == [keep["id"]]
    assert client.get(f"/api/documents/{gone['id']}").status_code == 404
    assert client.get(f"/api/corpora/{cid}/scope").json()["total_docs"] == 1
    assert client.get(f"/api/corpora/{cid}/facets").json()["tags"] == []
    assert client.get("/api/corpora").json()[-1]["docs"] == 1
    assert ids(client, "documents") == {gone["id"]}
    assert client.get(f"/api/corpora/{cid}/frequency").json() != before
    assert client.post("/api/trash/restore", json={"kind": "document", "ids": [gone["id"]]}).json()["restored"] == 1
    doc = client.get(f"/api/documents/{gone['id']}").json()
    assert (doc["author"], doc["doc_date"], doc["tags"]) == ("Ana", "2024-05", ["x"])
    assert client.get(f"/api/corpora/{cid}/frequency").json() == before


def test_restored_document_gets_its_aligned_partner_back(client):
    es, it = make_corpus(client, "es", "ES"), make_corpus(client, "it", "IT")
    import_tmx(client, es, tmx(build_pairs()), partner_corpus_id=it)
    assert wait_for_jobs(client, es)[0]["status"] == "done"
    [d_es] = client.get(f"/api/corpora/{es}/documents").json()
    q = {"q": "contratto"}
    total = client.get(f"/api/corpora/{it}/bilingual", params=q).json()["total"]
    assert total > 0
    client.delete(f"/api/documents/{d_es['id']}")
    [d_it] = client.get(f"/api/corpora/{it}/documents").json()
    assert d_it["pair_doc_id"] is None
    assert client.get(f"/api/corpora/{it}/bilingual", params=q).json()["total"] == 0
    assert client.get(f"/api/corpora/{it}/parallel").json()["documents"] == 0
    assert client.get(f"/api/corpora/{it}/equivalents", params={"q": "contratto", "min_freq": 1}).json()["rows"] == []
    client.post("/api/trash/restore", json={"kind": "document", "ids": [d_es["id"]]})
    [d_it] = client.get(f"/api/corpora/{it}/documents").json()
    assert d_it["pair_doc_id"] == d_es["id"]
    assert client.get(f"/api/corpora/{it}/bilingual", params=q).json()["total"] == total


def test_deleted_corpus_is_hidden_with_its_documents_and_restorable(client):
    cid = make_corpus(client, "es", "gone-corpus")
    d = add(client, cid, ES_TEXT).json()
    assert client.delete(f"/api/corpora/{cid}").status_code == 204
    assert cid not in {c["id"] for c in client.get("/api/corpora").json()}
    assert client.get(f"/api/corpora/{cid}/documents").status_code == 404
    assert client.get(f"/api/corpora/{cid}/frequency").status_code == 404
    assert client.get(f"/api/documents/{d['id']}").status_code == 404
    listed = client.get("/api/trash").json()
    assert [c["id"] for c in listed["corpora"]] == [cid] and listed["corpora"][0]["docs"] == 1
    assert listed["documents"] == []                      # its documents come back with it
    assert client.post("/api/trash/restore", json={"kind": "document", "ids": [d["id"]]}).status_code in (200, 409)
    client.post("/api/trash/restore", json={"kind": "corpus", "ids": [cid]})
    assert client.get(f"/api/corpora/{cid}/documents").json()[0]["id"] == d["id"]


def test_restoring_a_document_of_a_trashed_corpus_is_refused(client):
    cid = make_corpus(client, "es")
    d = add(client, cid, ES_TEXT).json()
    client.delete(f"/api/documents/{d['id']}")
    client.delete(f"/api/corpora/{cid}")
    r = client.post("/api/trash/restore", json={"kind": "document", "ids": [d["id"]]})
    assert r.status_code == 409


def test_deleted_term_is_ignored_and_a_new_identical_one_can_be_added(client):
    pid = project(client)
    tid = term(client, pid)
    assert client.post("/api/terms/delete", json={"ids": [tid]}).json() == {"deleted": 1}
    assert client.get("/api/terms", params={"project": pid}).json() == []
    assert ids(client, "terms") == {tid}
    new = term(client, pid)                                    # same key: the trashed twin makes way
    assert ids(client, "terms") == set()                       # (SQLite may reuse the id)
    client.delete(f"/api/terms/{new}")
    assert client.post("/api/trash/restore", json={"kind": "term", "ids": [new]}).json()["restored"] == 1
    assert [t["id"] for t in client.get("/api/terms", params={"project": pid}).json()] == [new]


def test_trashed_documents_text_is_still_a_duplicate_until_restored(client):
    cid = make_corpus(client, "es")
    d = add(client, cid, ES_TEXT).json()
    client.delete(f"/api/documents/{d['id']}")
    r = add(client, cid, ES_TEXT)
    assert r.status_code == 409 and "Trash" in json.dumps(r.json())


def test_base_corpus_in_trash_gives_up_its_slot(client):
    ref = client.post("/api/references", json={"lang": "es"}).json()["id"]
    client.delete(f"/api/corpora/{ref}")
    new = client.post("/api/references", json={"lang": "es"}).json()["id"]
    client.post("/api/trash/restore", json={"kind": "corpus", "ids": [ref]})
    refs = {c["id"] for c in client.get("/api/references").json()}
    assert refs == {new}                                       # the slot is taken: the old one is an ordinary corpus
    assert ref in {c["id"] for c in client.get("/api/corpora").json()}


# --------------------------------------------------------------------------- permanent delete and retention
def test_permanent_delete_is_explicit(client):
    cid = make_corpus(client, "es")
    d = add(client, cid, ES_TEXT).json()
    assert client.post("/api/trash/delete", json={"kind": "document", "ids": [d["id"]]}).json() == {"deleted": 0}
    client.delete(f"/api/documents/{d['id']}")
    assert client.delete("/api/trash").status_code == 400            # needs confirm=true
    assert ids(client, "documents") == {d["id"]}
    assert client.post("/api/trash/delete", json={"kind": "document", "ids": [d["id"]]}).json() == {"deleted": 1}
    assert ids(client, "documents") == set()
    with db.session() as conn:
        assert conn.execute("SELECT COUNT(*) FROM tokens WHERE doc_id=?", (d["id"],)).fetchone()[0] == 0
    client.delete(f"/api/corpora/{cid}")
    assert client.delete("/api/trash", params={"confirm": True}).json()["deleted"]["corpus"] >= 1
    assert client.get("/api/trash").json()["corpora"] == []


def test_retention_purges_old_items_only(client):
    old, new = make_corpus(client, "es", "old"), make_corpus(client, "es", "new")
    client.delete(f"/api/corpora/{old}")
    client.delete(f"/api/corpora/{new}")
    with db.session() as conn:
        conn.execute("UPDATE corpora SET deleted_at=datetime('now','-31 days') WHERE id=?", (old,))
    assert client.get("/api/trash").json()["retention_days"] == trash.DEFAULT_DAYS
    assert ids(client, "corpora") == {new}                                   # listing purges what expired
    client.put("/api/trash/settings", json={"retention_days": 0})            # 0 = keep until emptied
    with db.session() as conn:
        conn.execute("UPDATE corpora SET deleted_at=datetime('now','-400 days') WHERE id=?", (new,))
    assert ids(client, "corpora") == {new}
    assert client.put("/api/trash/settings", json={"retention_days": -1}).status_code == 422


# --------------------------------------------------------------------------- export and import
def build_project(client, name):
    pid = project(client, name)
    es = client.post("/api/corpora", json={"name": f"{name} ES", "lang": "es", "project_id": pid}).json()["id"]
    it = client.post("/api/corpora", json={"name": f"{name} IT", "lang": "it", "project_id": pid}).json()["id"]
    d1 = add(client, es, ES_TEXT, "contrato").json()
    add(client, it, IT_TEXT, "contratto")
    client.patch(f"/api/documents/{d1['id']}", json={"tags": ["alquiler"], "text_type": "contract",
                                                     "doc_date": "2024-01", "author": "Ana"})
    mem_es = client.post("/api/corpora", json={"name": f"{name} mem ES", "lang": "es", "project_id": pid}).json()["id"]
    mem_it = client.post("/api/corpora", json={"name": f"{name} mem IT", "lang": "it", "project_id": pid}).json()["id"]
    import_tmx(client, mem_es, tmx(build_pairs()), partner_corpus_id=mem_it)
    assert wait_for_jobs(client, mem_es)[0]["status"] == "done"
    term(client, pid)
    term(client, pid, src_term="plazo", tgt_term="termine", status="forbidden", notes="n")
    return pid


def snapshot(client, pid):
    corpora = [c for c in client.get("/api/corpora").json() if c["project_id"] == pid]
    out = {}
    for c in corpora:
        docs = client.get(f"/api/corpora/{c['id']}/documents").json()
        partner_titles = {d["id"]: d["title"] for d in docs}
        out[c["name"]] = {"lang": c["lang"], "docs": c["docs"], "tokens": c["tokens"],
                          "documents": sorted((d["title"], d["text_type"], d["doc_date"], d["author"],
                                               tuple(d["tags"]), d["segmented"], d["pair_doc_id"] is not None,
                                               d["n_tokens"]) for d in docs),
                          "titles": sorted(partner_titles.values())}
    terms = sorted((t["src_term"], t["tgt_term"], t["status"], t["notes"])
                   for t in client.get("/api/terms", params={"project": pid}).json())
    return out, terms


def export_zip(client, pid):
    r = client.get(f"/api/projects/{pid}/export")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    return r.content


def wipe_project(client, pid):
    for c in client.get("/api/corpora").json():
        if c["project_id"] == pid:
            client.delete(f"/api/corpora/{c['id']}")
    client.delete("/api/trash", params={"confirm": True})
    assert client.delete(f"/api/projects/{pid}").status_code == 204


def test_project_round_trip_restores_an_identical_project(client):
    pid = build_project(client, "RoundTrip Cliente")
    before = snapshot(client, pid)
    data = export_zip(client, pid)
    names = set(zipfile.ZipFile(io.BytesIO(data)).namelist())
    assert names == {"manifest.json", "data.json"}               # no tokens, no database copy
    wipe_project(client, pid)
    dry = client.post("/api/import", files={"file": ("p.zip", data)}).json()
    assert dry["dry_run"] and dry["created"]["documents"] == 4 and dry["existing"]["documents"] == 0
    assert client.get("/api/projects").json() == [p for p in client.get("/api/projects").json()
                                                  if p["name"] != "RoundTrip Cliente"]      # nothing written yet
    done = client.post("/api/import", data={"dry_run": "false"}, files={"file": ("p.zip", data)}).json()
    assert done["created"]["projects"] == 1 and done["created"]["corpora"] == 4 and done["created"]["terms"] == 2
    assert done["created"]["links"] == 1
    for j in done["jobs"]:
        wait_for_jobs(client, j["corpus_id"])
    new = next(p["id"] for p in client.get("/api/projects").json() if p["name"] == "RoundTrip Cliente")
    assert snapshot(client, new) == before
    # a second import changes nothing and reports why
    again = client.post("/api/import", data={"dry_run": "false", "annotate": "false"},
                        files={"file": ("p.zip", data)}).json()
    assert again["created"]["documents"] == 0 and again["created"]["terms"] == 0
    assert again["existing"]["documents"] == 4 and again["existing"]["terms"] == 2
    assert any(c["kind"] == "project" for c in again["conflicts"])
    assert snapshot(client, new) == before


def test_import_reports_a_term_that_differs_and_keeps_the_existing_one(client):
    pid = project(client, "Conflicto")
    term(client, pid, status="approved")
    data = export_zip(client, pid)
    tid = client.get("/api/terms", params={"project": pid}).json()[0]["id"]
    client.patch(f"/api/terms/{tid}", json={"status": "admitted"})
    rep = client.post("/api/import", data={"dry_run": "false", "annotate": "false"},
                      files={"file": ("p.zip", data)}).json()
    assert rep["existing"]["terms"] == 1
    assert any(c["kind"] == "term" and "admitted" in c["message"] for c in rep["conflicts"])
    assert client.get("/api/terms", params={"project": pid}).json()[0]["status"] == "admitted"


def test_import_into_a_chosen_project(client):
    src = project(client, "Origen")
    cid = client.post("/api/corpora", json={"name": "c-origen", "lang": "es", "project_id": src}).json()["id"]
    add(client, cid, ES_TEXT)
    term(client, src)
    data = export_zip(client, src)
    dst = project(client, "Destino")
    rep = client.post("/api/import", data={"dry_run": "false", "annotate": "false", "project_id": str(dst)},
                      files={"file": ("p.zip", data)}).json()
    assert rep["created"]["projects"] == 0 and rep["created"]["corpora"] == 1
    assert [c["project_id"] for c in client.get("/api/corpora").json() if c["name"] == "c-origen"
            and c["project_id"] == dst]
    assert len(client.get("/api/terms", params={"project": dst}).json()) == 1


def test_database_backup_has_a_consistent_sqlite_copy_and_excludes_the_trash(client, tmp_path):
    cid = make_corpus(client, "es", "in-backup")
    add(client, cid, ES_TEXT)
    trashed = make_corpus(client, "es", "trashed-corpus")
    add(client, trashed, ES_TEXT)
    client.delete(f"/api/corpora/{trashed}")
    r = client.get("/api/backup")
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert set(z.namelist()) == {"manifest.json", "data.json", "corpus.db"}
    z.extract("corpus.db", tmp_path)
    copy = db.connect(str(tmp_path / "corpus.db"))
    assert copy.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert copy.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION
    assert copy.execute("SELECT COUNT(*) FROM tokens").fetchone()[0] > 0
    copy.close()
    payload = json.loads(z.read("data.json"))
    assert "in-backup" in {c["name"] for c in payload["corpora"]}
    assert "trashed-corpus" not in {c["name"] for c in payload["corpora"]}
    assert json.loads(z.read("manifest.json"))["counts"]["corpora"] == len(payload["corpora"])
    assert client.get("/api/backup", params={"include_sqlite": False}).content[:2] == b"PK"


# --------------------------------------------------------------------------- hostile files
def zipped(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in members.items():
            z.writestr(name, content)
    return buf.getvalue()


@pytest.mark.parametrize("name", ["../evil.txt", "/etc/passwd", "a/../../b", "..\\x", "C:\\x"])
def test_unsafe_member_names_reject_the_file(client, name):
    data = zipped({"data.json": b"{}", name: b"x"})
    r = client.post("/api/import", files={"file": ("p.zip", data)})
    assert r.status_code == 400 and "Unsafe" in r.text


def test_oversized_and_malformed_files_are_rejected(client, monkeypatch):
    assert client.post("/api/import", files={"file": ("p.zip", b"PKnot a zip")}).status_code == 400
    assert client.post("/api/import", files={"file": ("p.json", b"[1,2")}).status_code == 400
    assert client.post("/api/import", files={"file": ("p.json", b'{"format":"other"}')}).status_code == 400
    assert client.post("/api/import", files={"file": ("p.zip", zipped({"x.txt": b"a"}))}).status_code == 400
    assert client.post("/api/import", files={"file": ("p.json", json.dumps(
        {"format": "colloca-export", "format_version": 99}).encode())}).status_code == 400
    monkeypatch.setattr(backup, "MAX_JSON_BYTES", 1000)               # a zip bomb: tiny file, huge member
    bomb = zipped({"data.json": b" " * 100_000})
    assert len(bomb) < 1000
    assert client.post("/api/import", files={"file": ("p.zip", bomb)}).status_code == 413
    monkeypatch.setattr(backup, "MAX_BACKUP_BYTES", 10)
    assert client.post("/api/import", files={"file": ("p.json", b"x" * 50)}).status_code == 413


def test_invalid_records_are_reported_not_stored(client):
    payload = {"format": "colloca-export", "format_version": 1,
               "projects": [{"ref": 1, "name": ""}, {"ref": 2, "name": "Hostil"}],
               "corpora": [{"ref": 1, "name": "bad lang", "lang": "fr", "project_ref": 2},
                           {"ref": 2, "name": "ok", "lang": "es", "project_ref": 2}],
               "documents": [{"ref": 1, "corpus_ref": 2, "title": "t", "text": ES_TEXT, "doc_date": "31/12/2024"},
                             {"ref": 2, "corpus_ref": 1, "title": "orphan", "text": ES_TEXT},
                             {"ref": 3, "corpus_ref": 2, "title": "fine", "text": ES_TEXT, "tags": ["a"]}],
               "terms": [{"src_lang": "es", "tgt_lang": "es", "src_term": "a", "tgt_term": "b"},
                         {"src_lang": "es", "src_term": "x" * 500}, {"src_lang": "es", "src_term": "ok"}]}
    rep = client.post("/api/import", data={"dry_run": "false", "annotate": "false"},
                      files={"file": ("p.json", json.dumps(payload).encode())}).json()
    assert rep["created"]["documents"] == 1 and rep["created"]["corpora"] == 1
    assert rep["created"]["terms"] == 1 and rep["rejected"] == 6
    assert {c["kind"] for c in rep["conflicts"]} >= {"project", "corpus", "document", "term"}


def test_v9_database_upgrades_to_v10_keeping_everything_visible(tmp_path):
    conn = db.connect(str(tmp_path / "v9.db"))
    conn.executescript("".join(sql for v, sql in db.MIGRATIONS if v <= 9) + "PRAGMA user_version = 9;")
    conn.execute("INSERT INTO corpora (name, lang) VALUES ('c', 'es')")
    conn.execute("INSERT INTO documents (corpus_id,title,text,text_hash) VALUES (1,'d','t','h')")
    conn.execute("INSERT INTO terms (src_lang,tgt_lang,src_term) VALUES ('es','it','x')")
    conn.commit()
    assert db.migrate(conn, backup_path=str(tmp_path / "v9.bak")) == db.SCHEMA_VERSION
    for table in ("corpora", "documents", "terms"):
        assert conn.execute(f"SELECT COUNT(*) FROM {table} WHERE deleted_at IS NULL").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM settings").fetchone()[0] == 0
    assert (tmp_path / "v9.bak").exists()                       # the pre-migration backup is still made
    assert trash.retention_days(conn) == trash.DEFAULT_DAYS
