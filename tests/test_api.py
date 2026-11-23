import io

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


def make_corpus(client, lang="es", name="t"):
    r = client.post("/api/corpora", json={"name": name, "lang": lang})
    assert r.status_code == 201
    return r.json()["id"]


def add(client, cid, text, title="doc"):
    return client.post(f"/api/corpora/{cid}/documents", json={"title": title, "text": text})


def test_unsupported_language(client):
    assert client.post("/api/corpora", json={"name": "x", "lang": "fr"}).status_code == 400


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
    assert [r["ok"] for r in res] == [True, True, False]
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
    monkeypatch.setattr("colloca.ingest.ALLOW_PRIVATE", True)
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
