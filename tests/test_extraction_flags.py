"""Flags for suspicious extractions of URL imports (the document is still imported)."""
import socket

import httpx
import pytest

from colloca import ingest

from .test_api import make_corpus, wait_for_jobs
from .test_url_fetching import PUBLIC, answers

LONG = "El contrato de arrendamiento se firma en la oficina de la empresa y todos los socios deben asistir. " * 6


def flags(title="Contrato", text=LONG, url="https://news.example/a"):
    return ingest.extraction_warnings({"url": url, "title": title, "text": text}, url)


def test_short_text_is_flagged():
    assert any("short" in w.lower() for w in flags(text="x" * 200))
    assert not any("short" in w.lower() for w in flags(text="x" * 400))


@pytest.mark.parametrize("phrase", ["Please enable JavaScript to continue", "Aceptar cookies para seguir leyendo",
                                    "Accetta i cookie per continuare"])
def test_boilerplate_in_first_500_chars_is_flagged_in_three_languages(phrase):
    assert any("boilerplate" in w.lower() for w in flags(text=phrase + ". " + LONG))
    assert not any("boilerplate" in w.lower() for w in flags(text=LONG + phrase))


def test_title_equal_to_host_is_flagged_as_landing_page():
    assert any("landing" in w.lower() for w in flags(title="news.example", url="https://news.example/"))
    assert not any("landing" in w.lower() for w in flags(title="Una noticia"))


def test_clean_article_has_no_warnings():
    assert flags() == []


# --------------------------------------------------------------------------- through the importer
def article(n: int, title: str, body: str = LONG) -> bytes:
    """A readable page whose text differs from every other (the extractor drops text it has seen before)."""
    paras = "".join(f"<p>{body.replace('empresa', f'empresa {n} número {i}')}</p>" for i in range(2))
    return f"<html><head><title>{title}</title></head><body><article>{paras}</article></body></html>".encode()


@pytest.fixture()
def serve(monkeypatch):
    pages: dict[str, bytes] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        key = f"{request.headers['host']}{request.url.path}"
        return httpx.Response(200, headers={"content-type": "text/html"}, content=pages[key])

    monkeypatch.setattr(ingest, "_transport", httpx.MockTransport(handler))
    monkeypatch.setattr(ingest, "ALLOW_PRIVATE", False)
    monkeypatch.setattr(ingest, "URL_DELAY", 0)
    monkeypatch.setattr(socket, "getaddrinfo", answers(PUBLIC))
    for k in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        monkeypatch.delenv(k, raising=False)
    return pages


def warnings_by_url(client, cid, urls):
    res = client.post(f"/api/corpora/{cid}/urls", json={"urls": urls}).json()
    jobs = {j["id"]: j for j in wait_for_jobs(client, cid)}
    return {r["url"]: jobs[r["job_id"]] for r in res}


def test_import_url_reports_flags_and_still_imports(client, serve):
    serve["a.example/short"] = article(1, "Breve", body="Texto corto del contrato de la empresa firmado ayer.")
    cid = make_corpus(client, "es", "flags")
    jobs = warnings_by_url(client, cid, ["https://a.example/short"])
    job = jobs["https://a.example/short"]
    assert job["status"] == "done"
    assert any("short" in w.lower() for w in job["result"]["warnings"])
    assert len(client.get(f"/api/corpora/{cid}/documents").json()) == 1


def test_same_title_on_same_host_is_flagged(client, serve):
    serve["a.example/uno"] = article(1, "Noticia del día")
    cid = make_corpus(client, "es", "dups")
    first = warnings_by_url(client, cid, ["https://a.example/uno"])["https://a.example/uno"]
    assert first["status"] == "done" and first["result"]["warnings"] == []
    serve["a.example/dos"] = article(2, "Noticia del día")
    serve["b.example/tres"] = article(3, "Noticia del día")
    jobs = warnings_by_url(client, cid, ["https://a.example/dos", "https://b.example/tres"])
    assert any("same title" in w.lower() for w in jobs["https://a.example/dos"]["result"]["warnings"])
    assert not any("same title" in w.lower() for w in jobs["https://b.example/tres"]["result"]["warnings"])
