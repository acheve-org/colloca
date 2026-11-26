import io
import time

import pytest
from docx import Document

ES_TEXT = (
    "El traductor revisa la terminología del cliente. La terminología técnica debe ser coherente.\n"
    "Un buen traductor consulta el corpus para elegir la terminología adecuada.\n"
    "El cliente envía documentos técnicos y el traductor prepara un glosario."
)
IT_TEXT = (
    "Il traduttore consulta il corpus per scegliere la terminologia corretta. "
    "La terminologia tecnica deve essere coerente in tutti i documenti."
)


def default_project(client) -> int:
    """Id of the shared `Test project`, created on first use (the database lives for the whole run)."""
    for p in client.get("/api/projects").json():
        if p["name"] == "Test project":
            return p["id"]
    r = client.post("/api/projects", json={"name": "Test project"})
    assert r.status_code == 201
    return r.json()["id"]


def make_corpus(client, lang="es", name="t", project_id=None):
    pid = project_id if project_id is not None else default_project(client)
    r = client.post("/api/corpora", json={"name": name, "lang": lang, "project_id": pid})
    assert r.status_code == 201
    return r.json()["id"]


def add(client, cid, text, title="doc"):
    return client.post(f"/api/corpora/{cid}/documents", json={"title": title, "text": text})


def wait_for_jobs(client, cid, timeout=60):
    """Poll until every background job of the corpus has finished; returns the jobs."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        jobs = client.get(f"/api/corpora/{cid}/jobs").json()
        if jobs and all(j["status"] in ("done", "error") for j in jobs):
            return jobs
        time.sleep(0.05)
    raise AssertionError("jobs did not finish")


def test_unsupported_language(client):
    body = {"name": "x", "lang": "fr", "project_id": default_project(client)}
    assert client.post("/api/corpora", json=body).status_code == 400


def test_add_and_frequency(client):
    cid = make_corpus(client)
    assert add(client, cid, ES_TEXT).status_code == 201
    rows = client.get(f"/api/corpora/{cid}/frequency").json()
    top = {r["item"]: r for r in rows}
    assert top["terminología"]["freq"] >= 3
    assert top["traductor"]["docs"] == 1
    assert "el" not in top  # stopwords excluded by default
    with_stop = {r["item"] for r in client.get(
        f"/api/corpora/{cid}/frequency", params={"exclude_stop": False}).json()}
    assert "el" in with_stop


def test_duplicate_rejected(client):
    cid = make_corpus(client)
    assert add(client, cid, ES_TEXT).status_code == 201
    assert add(client, cid, "  " + ES_TEXT.upper()).status_code == 409


def test_concordance_and_phrase(client):
    cid = make_corpus(client)
    add(client, cid, ES_TEXT)
    res = client.get(f"/api/corpora/{cid}/concordance", params={"q": "terminología"}).json()
    assert res["total"] == 3
    assert all("erminolog" in ln["node"] for ln in res["lines"])
    res = client.get(f"/api/corpora/{cid}/concordance",
                     params={"q": "la terminología", "unit": "form"}).json()
    assert res["total"] >= 2
    assert res["lines"][0]["node"].lower() == "la terminología"


def test_collocations(client):
    cid = make_corpus(client)
    add(client, cid, ES_TEXT)
    res = client.get(f"/api/corpora/{cid}/collocations",
                     params={"q": "terminología", "min_freq": 1}).json()
    assert res["node_freq"] == 3
    items = {r["item"] for r in res["rows"]}
    assert "técnico" in items or "técnica" in items or "cliente" in items
    assert all(set(r) >= {"logdice", "mi", "tscore", "ll"} for r in res["rows"])


def test_ngrams_and_csv(client):
    cid = make_corpus(client)
    add(client, cid, ES_TEXT)
    rows = client.get(f"/api/corpora/{cid}/ngrams",
                      params={"n": 2, "min_freq": 2, "edge_stop": True}).json()
    assert "la terminología" in {r["item"] for r in rows}
    strict = client.get(f"/api/corpora/{cid}/ngrams", params={"n": 2, "min_freq": 2}).json()
    assert "la terminología" not in {r["item"] for r in strict}  # stopword edges trimmed
    r = client.get(f"/api/corpora/{cid}/frequency", params={"format": "csv"})
    assert r.headers["content-type"].startswith("text/csv")
    assert r.text.lstrip("﻿").startswith("item,pos,freq")


def test_keyness(client):
    target = make_corpus(client, name="target")
    ref = make_corpus(client, name="ref")
    add(client, target, ES_TEXT)
    add(client, ref, "La casa es grande y el perro corre por el parque cada mañana con su dueño.")
    rows = client.get(f"/api/corpora/{target}/keyness", params={"ref": ref, "min_freq": 2}).json()
    assert rows and rows[0]["ll"] > 0
    assert "terminología" in {r["item"] for r in rows}


def test_keyness_language_mismatch(client):
    es = make_corpus(client, "es", "a")
    it = make_corpus(client, "it", "b")
    assert client.get(f"/api/corpora/{es}/keyness", params={"ref": it}).status_code == 400


def test_italian_lemmas(client):
    cid = make_corpus(client, "it")
    add(client, cid, IT_TEXT)
    items = {r["item"] for r in client.get(f"/api/corpora/{cid}/frequency").json()}
    assert "terminologia" in items


def test_upload_docx_txt_and_errors(client):
    cid = make_corpus(client)
    d = Document()
    d.add_paragraph("El cliente solicita una traducción jurídica de los contratos.")
    t = d.add_table(rows=1, cols=1)
    t.rows[0].cells[0].text = "La cláusula de confidencialidad es obligatoria para ambas partes."
    buf = io.BytesIO()
    d.save(buf)
    files = [
        ("files", ("contrato.docx", buf.getvalue(), "application/octet-stream")),
        ("files", ("nota.txt", ES_TEXT.encode("utf-8"), "text/plain")),
        ("files", ("foto.png", b"\x89PNG", "image/png")),
    ]
    res = client.post(f"/api/corpora/{cid}/upload", files=files).json()
    assert [r["ok"] for r in res] == [True, True, True]   # accepted; the bad file fails in its job
    jobs = {j["label"]: j for j in wait_for_jobs(client, cid)}
    assert jobs["foto.png"]["status"] == "error" and "Unsupported" in jobs["foto.png"]["error"]
    assert jobs["nota.txt"]["status"] == "done"
    docs = client.get(f"/api/corpora/{cid}/documents").json()
    assert {d["title"] for d in docs} == {"contrato", "nota"}
    text = client.get(f"/api/documents/{docs[0]['id']}").json()["text"]
    assert "confidencialidad" in text
    assert client.delete(f"/api/documents/{docs[0]['id']}").status_code == 204


def test_ssrf_blocked(client):
    for url in ("http://127.0.0.1:8000/", "http://localhost/x", "http://169.254.169.254/latest/",
                "file:///etc/passwd"):
        r = client.post("/api/preview-url", json={"url": url})
        assert r.status_code == 422, url


def test_delete_corpus_cascades(client):
    cid = make_corpus(client)
    add(client, cid, ES_TEXT)
    assert client.delete(f"/api/corpora/{cid}").status_code == 204
    assert client.get(f"/api/corpora/{cid}/frequency").status_code == 404


def test_url_preview_extracts_main_text(client, monkeypatch):
    import http.server
    import threading

    page = ("<html><head><title>Energía eólica</title></head><body>"
            "<nav><a href='/'>Inicio</a> <a href='/x'>Contacto</a></nav>"
            "<article><h1>Energía eólica</h1>"
            + "".join(f"<p>La energía eólica se obtiene del viento mediante aerogeneradores {i}. "
                      "Los parques eólicos terrestres y marinos producen electricidad limpia.</p>"
                      for i in range(6))
            + "</article><footer>Aviso legal · Cookies</footer></body></html>").encode()

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(page)

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr("corpora.ingest.ALLOW_PRIVATE", True)
    monkeypatch.setenv("NO_PROXY", "127.0.0.1")
    try:
        r = client.post("/api/preview-url", json={"url": f"http://127.0.0.1:{srv.server_port}/"})
    finally:
        srv.shutdown()
    assert r.status_code == 200, r.text
    body = r.json()
    assert "aerogeneradores" in body["text"]
    assert "Aviso legal" not in body["text"] and "Contacto" not in body["text"]
    assert body["title"].startswith("Energía")


def test_paragraph_boundary_has_space_in_concordance(client):
    cid = make_corpus(client)
    add(client, cid, "El viento sopla fuerte en la costa.\nLa energía crece cada año en la región.")
    lines = client.get(f"/api/corpora/{cid}/concordance",
                       params={"q": "energía", "width": 12}).json()["lines"]
    assert "costa. La" in lines[0]["left"] or lines[0]["left"].endswith("costa.")
    assert ".La" not in lines[0]["left"]


# --------------------------------------------------------------------------- language check
def test_language_mismatch_rejected_unless_forced(client):
    cid = make_corpus(client, "es")
    r = add(client, cid, IT_TEXT)
    assert r.status_code == 422 and "Italian" in r.json()["detail"]
    assert client.get(f"/api/corpora/{cid}/documents").json() == []

    r = client.post(f"/api/corpora/{cid}/documents", params={"force_language": True},
                    json={"title": "forced", "text": IT_TEXT})
    assert r.status_code == 201 and r.json()["lang_check"] == "mismatch" and r.json()["warnings"]
    assert client.get(f"/api/corpora/{cid}/documents").json()[0]["lang_check"] == "mismatch"


def test_matching_language_is_recorded_as_ok(client):
    cid = make_corpus(client, "es")
    assert add(client, cid, ES_TEXT).json()["lang_check"] == "ok"


def test_background_mismatch_reports_error_in_job(client):
    cid = make_corpus(client, "es")
    r = client.post(f"/api/corpora/{cid}/documents", params={"background": True},
                    json={"title": "x", "text": IT_TEXT})
    assert r.status_code == 202
    job = wait_for_jobs(client, cid)[0]
    assert job["status"] == "error" and job["code"] == "language_mismatch"


# --------------------------------------------------------------------------- upload limits & jobs
def test_upload_file_too_large(client, monkeypatch):
    monkeypatch.setattr("corpora.ingest.MAX_UPLOAD_BYTES", 100)
    cid = make_corpus(client)
    res = client.post(f"/api/corpora/{cid}/upload",
                      files=[("files", ("big.txt", b"x" * 101, "text/plain"))]).json()
    assert res[0]["ok"] is False and "larger than" in res[0]["error"]
    assert client.get(f"/api/corpora/{cid}/jobs").json() == []          # nothing was queued


def test_upload_too_many_files(client, monkeypatch):
    monkeypatch.setattr("corpora.ingest.MAX_UPLOAD_FILES", 1)
    cid = make_corpus(client)
    files = [("files", (f"{i}.txt", b"hola", "text/plain")) for i in range(2)]
    assert client.post(f"/api/corpora/{cid}/upload", files=files).status_code == 413


def test_pdf_page_limit(monkeypatch):
    from pypdf import PdfWriter

    from corpora import ingest
    w = PdfWriter()
    for _ in range(3):
        w.add_blank_page(200, 200)
    buf = io.BytesIO()
    w.write(buf)
    monkeypatch.setattr(ingest, "MAX_PDF_PAGES", 2)
    with pytest.raises(ingest.IngestError, match="3 pages"):
        ingest.extract_pdf(buf.getvalue())


def test_job_progress_and_result(client):
    cid = make_corpus(client)
    r = client.post(f"/api/corpora/{cid}/documents", params={"background": True},
                    json={"title": "bg", "text": ES_TEXT})
    job_id = r.json()["job_id"]
    job = wait_for_jobs(client, cid)[0]
    assert job["id"] == job_id and job["status"] == "done" and job["progress"] == 1.0
    assert job["result"]["tokens"] > 20
    assert client.get(f"/api/jobs/{job_id}").json()["status"] == "done"
    assert client.get("/api/jobs/999999").status_code == 404


def test_duplicate_in_background_is_a_job_error(client):
    cid = make_corpus(client)
    add(client, cid, ES_TEXT)
    client.post(f"/api/corpora/{cid}/documents", params={"background": True}, json={"text": ES_TEXT})
    job = wait_for_jobs(client, cid)[0]
    assert job["status"] == "error" and job["code"] == "duplicate"


# --------------------------------------------------------------------------- CSV safety
def test_csv_neutralises_formulas():
    from corpora.main import _reply
    rows = [{"item": "=HYPERLINK(\"http://x\")", "a": "+1", "b": "-2", "c": "@x", "d": "ok", "n": -3}]
    text = _reply(rows, "csv", "t").body.decode("utf-8-sig")
    data = text.splitlines()[1]
    assert "'=HYPERLINK" in data and "'+1" in data and "'-2" in data and "'@x" in data
    assert ",ok," in data and data.endswith(",-3")                    # plain text and real numbers untouched


# --------------------------------------------------------------------------- re-annotation
def test_reannotate_outdated_documents(client):
    from corpora import db
    cid = make_corpus(client)
    add(client, cid, ES_TEXT)
    doc = client.get(f"/api/corpora/{cid}/documents").json()[0]
    assert doc["stale"] is False
    before = client.get(f"/api/corpora/{cid}/frequency").json()

    with db.session() as conn:                                        # pretend an older model annotated it
        conn.execute("UPDATE documents SET pipeline='es_core_news_sm 0.0.1', n_tokens=1 WHERE id=?", (doc["id"],))
        conn.execute("DELETE FROM tokens WHERE doc_id=? AND pos>5", (doc["id"],))
    assert client.get(f"/api/corpora/{cid}/documents").json()[0]["stale"] is True

    assert client.post(f"/api/corpora/{cid}/reannotate").status_code == 202
    job = wait_for_jobs(client, cid)[0]
    assert job["status"] == "done" and job["result"] == {"updated": 1}
    after = client.get(f"/api/corpora/{cid}/documents").json()[0]
    assert after["stale"] is False and after["n_tokens"] > 20
    assert client.get(f"/api/corpora/{cid}/frequency").json() == before   # tokens fully restored

    # nothing is outdated now: a second run touches nothing
    client.post(f"/api/corpora/{cid}/reannotate")
    deadline = time.time() + 30
    while time.time() < deadline:
        jobs = client.get(f"/api/corpora/{cid}/jobs").json()
        if len(jobs) == 2 and jobs[1]["status"] == "done":
            break
        time.sleep(0.05)
    assert jobs[1]["result"] == {"updated": 0}


def test_status_reports_model_per_language(client):
    body = client.get("/api/status").json()
    assert set(body["models"]) == {"es", "it"}
    for lang, m in body["models"].items():
        assert m["name"].startswith(f"{lang}_core_news_")
        assert m["size"] == m["name"].rsplit("_", 1)[1]
        assert m["version"]
        assert m["small"] == (m["size"] == "sm")


def test_status_without_models(client, monkeypatch):
    monkeypatch.setattr("corpora.nlp.installed_version", lambda package: None)
    m = client.get("/api/status").json()["models"]["es"]
    assert m == {"name": None, "version": None, "size": None, "small": False}
