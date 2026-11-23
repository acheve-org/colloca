import sqlite3

import pytest

from colloca import analysis, cli, db, importer

from .test_api import ES_TEXT, IT_TEXT, add, make_corpus, wait_for_jobs

ES_SENTENCES = [
    "El gobierno anunció nuevas medidas para la economía del país.",
    "La casa de mi abuela tiene un jardín muy grande y bonito.",
    "Los niños juegan en el parque cada tarde después de la escuela.",
    "El traductor consulta el diccionario para elegir la palabra adecuada.",
    "Mañana vamos a visitar el museo de la ciudad con toda la familia.",
    "Ella dice que la comida del restaurante estaba muy buena anoche.",
]


def make_reference(client, lang="es"):
    r = client.post("/api/references", json={"lang": lang})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def leipzig(sentences):
    return "\n".join(f"{i}\t{s}" for i, s in enumerate(sentences, 1)).encode()


def fill_reference(client, ref_id, sentences=ES_SENTENCES):
    files = [("files", ("spa_news-sentences.txt", leipzig(sentences), "text/plain"))]
    res = client.post(f"/api/corpora/{ref_id}/upload", params={"sentences": True}, files=files)
    assert res.status_code == 202 and res.json()[0]["ok"]
    jobs = wait_for_jobs(client, ref_id)
    assert all(j["status"] == "done" for j in jobs), jobs
    return jobs


# --------------------------------------------------------------------------- schema & registry
def test_one_base_corpus_per_language(client):
    ref = make_reference(client, "es")
    assert client.post("/api/references", json={"lang": "es"}).status_code == 409
    assert make_reference(client, "it") != ref                       # another language is fine
    assert client.post("/api/references", json={"lang": "fr"}).status_code == 400


def test_base_corpora_are_kept_apart_from_user_corpora(client):
    mine = make_corpus(client, "es", "mine")
    ref = make_reference(client, "es")
    assert mine in {c["id"] for c in client.get("/api/corpora").json()}
    assert ref not in {c["id"] for c in client.get("/api/corpora").json()}
    refs = client.get("/api/references").json()
    assert [r["id"] for r in refs if r["lang"] == "es"] == [ref] and refs[0]["is_reference"] == 1


def test_database_enforces_single_reference_per_language(tmp_path):
    conn = sqlite3.connect(tmp_path / "x.db")
    db.migrate(conn)
    conn.execute("INSERT INTO corpora (name, lang, is_reference) VALUES ('a', 'es', 1)")
    conn.execute("INSERT INTO corpora (name, lang, is_reference) VALUES ('b', 'es', 0)")   # normal ones are unlimited
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO corpora (name, lang, is_reference) VALUES ('c', 'es', 1)")


def test_v2_database_upgrades_to_v3_keeping_corpora(tmp_path):
    conn = sqlite3.connect(tmp_path / "v2.db")
    conn.row_factory = sqlite3.Row
    conn.executescript(db._V1 + db._V2 + "PRAGMA user_version = 2;")
    conn.execute("INSERT INTO corpora (name, lang) VALUES ('Client', 'es')")
    conn.commit()
    assert db.migrate(conn) == db.SCHEMA_VERSION
    assert conn.execute("SELECT name, is_reference FROM corpora").fetchone()[:] == ("Client", 0)


# --------------------------------------------------------------------------- sentence import
def test_parse_sentences_strips_leipzig_ids_and_blanks():
    lines = ["1\tHola mundo.\n", "\n", "2\tOtra frase\tcon tab.\r\n", "Sin id.", "   "]
    assert list(importer.parse_sentences(lines)) == ["Hola mundo.", "Otra frase con tab.", "Sin id."]


def test_chunking():
    assert [len(c) for c in importer.chunk_sentences(map(str, range(11)), 5)] == [5, 5, 1]
    assert importer.count_chunks(11, 5) == 3 and importer.count_chunks(10, 5) == 2


def test_sentence_upload_splits_into_parts(client, monkeypatch):
    monkeypatch.setattr(importer, "SENTENCES_PER_DOC", 4)
    ref = make_reference(client)
    fill_reference(client, ref)
    docs = client.get(f"/api/corpora/{ref}/documents").json()
    assert [d["title"] for d in docs] == ["spa_news-sentences.txt (part 1)", "spa_news-sentences.txt (part 2)"]
    assert docs[0]["kind"] == "sentences"
    text = client.get(f"/api/documents/{docs[0]['id']}").json()["text"]
    assert text.splitlines()[0] == ES_SENTENCES[0] and "\t" not in text    # id column removed
    job = client.get(f"/api/corpora/{ref}/jobs").json()[0]
    assert job["result"]["documents"] == 2 and job["result"]["tokens"] > 40


def test_sentence_upload_rejects_wrong_language(client):
    ref = make_reference(client, "es")
    files = [("files", ("it.txt", leipzig(IT_TEXT.split(". ") * 3), "text/plain"))]
    client.post(f"/api/corpora/{ref}/upload", params={"sentences": True}, files=files)
    job = wait_for_jobs(client, ref)[0]
    assert job["status"] == "error" and job["code"] == "language_mismatch"


def test_cli_imports_a_sentence_file(client, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(importer, "SENTENCES_PER_DOC", 3)
    f = tmp_path / "es-sentences.txt"
    f.write_bytes(leipzig(ES_SENTENCES))
    assert cli.main(["--lang", "es", str(f)]) == 0
    assert "2 parts" in capsys.readouterr().err
    ref = client.get("/api/references").json()[0]
    assert ref["lang"] == "es" and ref["docs"] == 2
    assert cli.main(["--lang", "es", str(f)]) == 0                 # same file again: duplicates skipped
    assert "duplicate" in capsys.readouterr().err
    assert client.get("/api/references").json()[0]["docs"] == 2
    assert cli.main(["--lang", "es", "--max-sentences", "2", str(tmp_path / "missing.txt")]) == 1


# --------------------------------------------------------------------------- using the base corpus
def test_keyness_defaults_to_base_corpus(client):
    cid = make_corpus(client, "es", "client")
    add(client, cid, ES_TEXT)
    r = client.get(f"/api/corpora/{cid}/keyness")
    assert r.status_code == 400 and "no Spanish base corpus" in r.json()["detail"]
    ref = make_reference(client)
    assert client.get(f"/api/corpora/{cid}/keyness").status_code == 400      # exists but still empty
    fill_reference(client, ref)
    rows = client.get(f"/api/corpora/{cid}/keyness", params={"min_freq": 2}).json()
    assert "terminología" in {r["item"] for r in rows}
    assert all(r["ref_freq"] == 0 for r in rows if r["item"] == "terminología")


def test_keyness_explicit_reference_still_works(client):
    a, b = make_corpus(client, "es", "a"), make_corpus(client, "es", "b")
    add(client, a, ES_TEXT)
    add(client, b, ES_SENTENCES[0] + " " + ES_SENTENCES[1])
    assert client.get(f"/api/corpora/{a}/keyness", params={"ref": b, "min_freq": 2}).status_code == 200
    assert client.get(f"/api/corpora/{a}/keyness", params={"ref": a}).status_code == 400


def test_base_corpus_cannot_be_compared_with_itself_by_default(client):
    ref = make_reference(client)
    fill_reference(client, ref)
    r = client.get(f"/api/corpora/{ref}/keyness")
    assert r.status_code == 400 and "base corpus itself" in r.json()["detail"]


def test_frequency_with_reference_columns(client):
    cid = make_corpus(client, "es", "client")
    add(client, cid, ES_TEXT + "\nEl traductor trabaja en la ciudad.")
    assert client.get(f"/api/corpora/{cid}/frequency", params={"with_reference": True}).status_code == 400
    ref = make_reference(client)
    fill_reference(client, ref)
    plain = client.get(f"/api/corpora/{cid}/frequency").json()
    assert "ref_freq" not in plain[0]                                       # opt-in only
    rows = {r["item"]: r for r in client.get(f"/api/corpora/{cid}/frequency",
                                             params={"with_reference": True}).json()}
    assert rows["traductor"]["ref_freq"] == 1                                # once in the base corpus
    assert rows["terminología"]["ref_freq"] == 0 and rows["terminología"]["ref_per_million"] == 0.0
    size = client.get("/api/references").json()[0]["tokens"]
    assert rows["traductor"]["ref_per_million"] == round(1_000_000 / size, 1)


def test_collocations_with_reference_columns(client):
    cid = make_corpus(client, "es", "client")
    add(client, cid, ES_TEXT)
    ref = make_reference(client)
    fill_reference(client, ref)
    res = client.get(f"/api/corpora/{cid}/collocations",
                     params={"q": "terminología", "min_freq": 1, "with_reference": True}).json()
    assert res["rows"] and all({"ref_freq", "ref_per_million"} <= set(r) for r in res["rows"])


def test_reference_counts_handles_many_items_and_forms(client):
    ref = make_reference(client)
    fill_reference(client, ref)
    with db.session() as conn:
        items = [f"palabra{i}" for i in range(1200)] + ["casa"]            # more than one SQL chunk
        counts = analysis.reference_counts(conn, ref, "lemma", items)
        assert len(counts) == 1201 and counts["casa"] == 1 and counts["palabra7"] == 0
        assert analysis.reference_counts(conn, ref, "form", ["Casa"])["Casa"] == 0   # forms are lower-cased


def test_deleting_base_corpus_allows_a_new_one(client):
    ref = make_reference(client)
    assert client.delete(f"/api/corpora/{ref}").status_code == 204
    assert client.get("/api/references").json() == []
    make_reference(client)
