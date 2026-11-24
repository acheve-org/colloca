"""Near-duplicate detection (T16). All texts are synthetic: paragraphs of random Spanish function and
content words from a seeded generator, so versions and unrelated documents are fully controlled."""
import random
import sqlite3

import pytest

from colloca import db, dedup, importer
from tests.test_api import make_corpus, wait_for_jobs

WORDS = [
    "el", "la", "los", "las", "un", "una", "de", "del",
    "en", "con", "por", "para", "que", "como", "más", "pero",
    "cuando", "si", "no", "sí", "contrato", "cliente", "parte", "plazo",
    "pago", "factura", "entrega", "servicio", "obligación", "derecho", "garantía", "riesgo",
    "seguro", "empresa", "traductor", "documento", "texto", "cláusula", "acuerdo", "firma",
    "fecha", "precio", "cantidad", "producto", "envío",
]


def paragraphs(seed: int, n: int = 12, length: int = 40) -> list[str]:
    rng = random.Random(seed)
    return [" ".join(rng.choice(WORDS) for _ in range(length)).capitalize() + "." for _ in range(n)]


def post(client, cid, text, title="doc", **params):
    return client.post(f"/api/corpora/{cid}/documents", params=params, json={"title": title, "text": text})


# --------------------------------------------------------------------------- the estimator
def test_similarity_tracks_the_changed_share():
    base = paragraphs(1, n=20)
    one = list(base)
    one[7] = paragraphs(2, n=1)[0]                                 # one paragraph in twenty rewritten
    s_same = dedup.similarity(dedup.sketch("\n".join(base)), dedup.sketch("\n".join(base)))
    s_edit = dedup.similarity(dedup.sketch("\n".join(base)), dedup.sketch("\n".join(one)))
    s_other = dedup.similarity(dedup.sketch("\n".join(base)), dedup.sketch("\n".join(paragraphs(3, n=20))))
    assert s_same == 1.0
    assert 0.85 < s_edit < 1.0
    assert s_other < 0.05


def test_case_punctuation_and_whitespace_do_not_matter():
    text = "\n".join(paragraphs(4))
    shouty = text.upper().replace(".", " ;").replace(" ", "  ")
    assert dedup.similarity(dedup.sketch(text), dedup.sketch(shouty)) == 1.0


def test_small_texts_are_compared_exactly():
    a, b = dedup.sketch("uno dos tres cuatro cinco seis siete"), dedup.sketch("uno dos tres cuatro cinco seis ocho")
    assert dedup.similarity(a, b) == pytest.approx(0.5)             # 3 shingles each, 2 shared of 4 distinct
    assert dedup.sketch("") == b""


# --------------------------------------------------------------------------- import
def test_changed_paragraph_is_flagged_and_shows_what_overlaps(client):
    cid = make_corpus(client)
    ps = paragraphs(10)
    assert post(client, cid, "\n".join(ps), "Contract v1").status_code == 201
    v2 = list(ps)
    v2[3] = "Esta cláusula nueva sustituye por completo el párrafo anterior del contrato original firmado."
    r = post(client, cid, "\n".join(v2), "Contract v2")
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["code"] == "near_duplicate"
    (match,) = detail["matches"]
    assert match["title"] == "Contract v1" and match["similarity"] > 0.85
    assert (match["units"], match["shared_units"]) == (12, 11)
    assert match["changed"] == [v2[3]]
    assert len(client.get(f"/api/corpora/{cid}/documents").json()) == 1


def test_unrelated_documents_are_not_flagged(client):
    cid = make_corpus(client)
    assert post(client, cid, "\n".join(paragraphs(20)), "A").status_code == 201
    assert post(client, cid, "\n".join(paragraphs(21)), "B").status_code == 201


def test_import_anyway_and_replace(client):
    cid = make_corpus(client)
    ps = paragraphs(30)
    first = post(client, cid, "\n".join(ps), "old").json()["id"]
    v2 = "\n".join(ps[:-1] + ["Una última frase distinta, escrita para esta versión del texto de prueba."])
    assert post(client, cid, v2, "kept both", similar="import").status_code == 201
    v3 = v2 + "\nY aún otra línea añadida al final del documento."
    r = post(client, cid, v3, "newest", similar="replace")           # replaces the most similar one: v2
    assert r.status_code == 201 and r.json()["replaced"] == "kept both"
    titles = {d["title"] for d in client.get(f"/api/corpora/{cid}/documents").json()}
    assert titles == {"old", "newest"}
    assert first in {d["id"] for d in client.get(f"/api/corpora/{cid}/documents").json()}


def test_threshold_is_configurable_and_stored_on_the_document(client, monkeypatch):
    cid = make_corpus(client)
    ps = paragraphs(40)
    post(client, cid, "\n".join(ps))
    half = "\n".join(ps[:6] + paragraphs(41, n=6))
    assert post(client, cid, half).status_code == 201               # about 33% similar: below the default
    monkeypatch.setattr(dedup, "THRESHOLD", 0.2)
    assert post(client, cid, half + "\nOtra línea más para que el texto difiera.").status_code == 409
    with db.session() as conn:
        assert all(r[0] for r in conn.execute("SELECT fingerprint FROM documents WHERE corpus_id=?", (cid,)))


def test_job_holds_a_near_duplicate_until_the_user_decides(client):
    cid = make_corpus(client)
    ps = paragraphs(50)
    post(client, cid, "\n".join(ps), "v1")
    v2 = "\n".join(ps[:-1] + ["Otra versión distinta del último párrafo, escrita solo para esta prueba de duplicados."])
    r = client.post(f"/api/corpora/{cid}/documents", params={"background": True}, json={"title": "v2", "text": v2})
    (job,) = wait_for_jobs(client, cid)
    assert job["status"] == "error" and job["code"] == "near_duplicate"
    assert job["result"]["matches"][0]["title"] == "v1"
    assert len(client.get(f"/api/corpora/{cid}/documents").json()) == 1
    res = client.post(f"/api/jobs/{r.json()['job_id']}/resolve", json={"action": "replace"})
    assert res.status_code == 202
    jobs = wait_for_jobs(client, cid)
    assert [j["status"] for j in jobs if j["id"] == res.json()["job_id"]] == ["done"]
    assert [d["title"] for d in client.get(f"/api/corpora/{cid}/documents").json()] == ["v2"]
    assert client.post(f"/api/jobs/{r.json()['job_id']}/resolve", json={"action": "import"}).status_code == 404


def test_upload_is_held_and_skip_forgets_it(client):
    cid = make_corpus(client)
    ps = paragraphs(60)
    post(client, cid, "\n".join(ps), "v1")
    v2 = "\n".join(ps[:-1] + ["Un cierre distinto para esta otra versión del archivo subido en la prueba."])
    res = client.post(f"/api/corpora/{cid}/upload", files={"files": ("v2.txt", v2.encode(), "text/plain")}).json()
    (job,) = wait_for_jobs(client, cid)
    assert job["code"] == "near_duplicate" and job["id"] == res[0]["job_id"]
    assert client.post(f"/api/jobs/{job['id']}/resolve", json={"action": "skip"}).status_code == 202
    assert client.post(f"/api/jobs/{job['id']}/resolve", json={"action": "skip"}).status_code == 404
    assert len(client.get(f"/api/corpora/{cid}/documents").json()) == 1


def test_sentence_files_and_aligned_texts_are_exempt(client):
    cid = make_corpus(client)
    sentences = "\n".join(paragraphs(70, n=30, length=12))
    for _ in range(2):                                              # the second file is identical but for one line
        sentences += "\nUna oración más para que el archivo no sea idéntico al anterior."
        r = client.post(f"/api/corpora/{cid}/upload", params={"sentences": True},
                        files={"files": ("s.txt", sentences.encode(), "text/plain")})
        assert r.status_code == 202
        jobs = wait_for_jobs(client, cid)
    assert all(j["status"] == "done" for j in jobs)
    with db.session() as conn:
        assert conn.execute("SELECT COUNT(*) FROM documents WHERE corpus_id=?", (cid,)).fetchone()[0] == 2


# --------------------------------------------------------------------------- report on an existing corpus
def test_report_finds_pairs_and_backfills_old_documents(client):
    cid = make_corpus(client)
    ps = paragraphs(80)
    v2 = list(ps)
    v2[5] = "Párrafo reescrito para la segunda versión del texto, con otras palabras distintas del original."
    ids = [post(client, cid, "\n".join(t), title, similar="import").json()["id"]
           for title, t in (("v1", ps), ("v2", v2), ("other", paragraphs(81)))]
    with db.session() as conn:                                      # as if imported before migration v9
        conn.execute("UPDATE documents SET fingerprint=NULL WHERE id IN (?,?)", ids[:2])
    rep = client.get(f"/api/corpora/{cid}/near-duplicates").json()
    assert rep["fingerprinted_now"] == 2 and rep["documents"] == 3
    (pair,) = rep["pairs"]
    assert (pair["a"]["id"], pair["b"]["id"]) == (ids[0], ids[1]) and pair["similarity"] > 0.85
    assert client.get(f"/api/corpora/{cid}/near-duplicates").json()["fingerprinted_now"] == 0
    assert client.get(f"/api/corpora/{cid}/near-duplicates", params={"threshold": 0.99}).json()["pairs"] == []
    assert client.get(f"/api/corpora/{cid}/near-duplicates", params={"threshold": 0.1}).status_code == 422


def test_report_ignores_boilerplate_shared_by_everything(client):
    cid = make_corpus(client)
    banner = "\n".join(paragraphs(90, n=1, length=30))
    for i in range(4):
        post(client, cid, banner + "\n" + "\n".join(paragraphs(100 + i, n=8)), f"page {i}")
    assert client.get(f"/api/corpora/{cid}/near-duplicates").json()["pairs"] == []


def test_migration_adds_the_column_to_a_v8_database(tmp_path):
    conn = sqlite3.connect(tmp_path / "old.db")
    conn.row_factory = sqlite3.Row
    assert importer and db.migrate(conn) == db.SCHEMA_VERSION >= 9
    assert "fingerprint" in {r["name"] for r in conn.execute("PRAGMA table_info(documents)")}
