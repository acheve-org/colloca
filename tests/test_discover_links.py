"""Link discovery on an index page or feed: parsing and the endpoint."""
import socket

import httpx
import pytest

from corpora import ingest

from .test_url_fetching import PRIVATE, PUBLIC, answers

BASE = "https://news.example/section/"


def urls(result):
    return [link["url"] for link in result["links"]]


def parse(html: str, base: str = BASE):
    return ingest.parse_links(html.encode(), base)


def test_resolves_relative_links_and_base_href():
    html = ('<html><body><a href="a1">One</a><a href="../b">Two</a><a href="//cdn.example/x">Three</a>'
            '<a href="/root">Four</a></body></html>')
    assert urls(parse(html)) == ["https://news.example/section/a1", "https://news.example/b",
                                 "https://cdn.example/x", "https://news.example/root"]
    with_base = '<html><head><base href="https://other.example/dir/"></head><body><a href="a1">One</a></body></html>'
    assert urls(parse(with_base)) == ["https://other.example/dir/a1"]


def test_strips_fragments_and_tracking_but_keeps_other_params():
    html = '<a href="/a?utm_source=x&id=7&fbclid=1&gclid=2&utm_medium=m#top">Story</a>'
    assert urls(parse(html)) == ["https://news.example/a?id=7"]


def test_dedupes_keeping_the_longest_anchor_text():
    html = '<a href="/a">Go</a><a href="/a#x">The full story title</a><a href="/b">B</a>'
    res = parse(html)
    assert urls(res) == ["https://news.example/a", "https://news.example/b"]
    assert res["links"][0]["text"] == "The full story title"


def test_prunes_nav_footer_aside_and_non_http_and_self_links():
    html = """<html><body>
      <nav><a href="/n">Nav</a></nav><header><a href="/h">Head</a></header>
      <footer><a href="/f">Foot</a></footer><aside><a href="/s">Side</a></aside>
      <a href="mailto:a@b.c">Mail</a><a href="javascript:void(0)">JS</a><a href="#frag">Frag</a>
      <a href="/section/">Self</a><a href="/empty"></a><a href="/titled" title="Has title"></a>
      <a href="/keep">Keep</a></body></html>"""
    assert urls(parse(html)) == ["https://news.example/titled", "https://news.example/keep"]


@pytest.mark.parametrize("path", ["/login", "/search?q=x", "/tag/x", "/category/x", "/author/x", "/privacy",
                                  "/contact"])
def test_prunes_login_search_tag_category_author_paths(path):
    html = f'<a href="{path}">Link</a><a href="/2026/05/story">Story</a>'
    assert urls(parse(html)) == ["https://news.example/2026/05/story"]


def test_same_host_flag():
    res = parse('<a href="/a">A</a><a href="https://other.example/b">B</a>')
    assert [x["same_host"] for x in res["links"]] == [True, False]


def test_rss_and_atom_entries():
    rss = ("<?xml version='1.0'?><rss version='2.0'><channel><title>Feed</title>"
           "<item><title>First</title><link>https://news.example/1</link></item>"
           "<item><title>Second</title><link>/2</link></item></channel></rss>")
    res = parse(rss)
    assert res["title"] == "Feed"
    assert [(x["url"], x["text"]) for x in res["links"]] == [("https://news.example/1", "First"),
                                                             ("https://news.example/2", "Second")]
    atom = ("<?xml version='1.0'?><feed xmlns='http://www.w3.org/2005/Atom'><title>At</title>"
            "<entry><title>E1</title><link href='https://news.example/e1'/></entry></feed>")
    res = parse(atom)
    assert [(x["url"], x["text"]) for x in res["links"]] == [("https://news.example/e1", "E1")]


def test_page_without_links_gives_empty_list():
    assert parse("<html><body><p>No links here</p></body></html>")["links"] == []


def test_title_is_the_page_title():
    html = "<html><head><title> Noticias del día </title></head><body></body></html>"
    assert parse(html)["title"] == "Noticias del día"


# --------------------------------------------------------------------------- endpoint
INDEX = ("<html><head><title>Noticias</title></head><body><article><a href='/2026/uno'>Primera noticia</a>"
         "<a href='/2026/dos'>Segunda noticia</a><a href='https://otro.example/tres'>Tercera</a></article>"
         "<footer><a href='/aviso'>Aviso legal</a></footer></body></html>")


@pytest.fixture()
def serve(monkeypatch):
    """Serve `body` with `ctype` for every request; every host resolves to a public address."""
    state = {"body": INDEX.encode(), "ctype": "text/html; charset=utf-8", "error": None}

    def handler(request: httpx.Request) -> httpx.Response:
        if state["error"]:
            raise state["error"]
        return httpx.Response(200, headers={"content-type": state["ctype"]}, content=state["body"])

    monkeypatch.setattr(ingest, "_transport", httpx.MockTransport(handler))
    monkeypatch.setattr(ingest, "ALLOW_PRIVATE", False)
    monkeypatch.setattr(socket, "getaddrinfo", answers(PUBLIC))
    for k in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        monkeypatch.delenv(k, raising=False)
    return state


def test_discover_endpoint_lists_links(client, serve):
    r = client.post("/api/discover-links", json={"url": "https://news.example/"})
    assert r.status_code == 200
    body = r.json()
    assert [x["url"] for x in body["links"]] == ["https://news.example/2026/uno", "https://news.example/2026/dos",
                                                 "https://otro.example/tres"]
    assert [x["same_host"] for x in body["links"]] == [True, True, False]
    assert body["title"] == "Noticias" and body["max_per_request"] == 20 and body["truncated"] is False


def test_discover_endpoint_refuses_internal_address(client, serve, monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", answers(PRIVATE))
    r = client.post("/api/discover-links", json={"url": "https://news.example/"})
    assert r.status_code == 422 and "private" in r.json()["detail"]


def test_discover_endpoint_rejects_a_pdf(client, serve):
    serve.update(body=b"%PDF-1.4 binary", ctype="application/pdf")
    r = client.post("/api/discover-links", json={"url": "https://news.example/a.pdf"})
    assert r.status_code == 422 and "Not a web page or a feed" in r.json()["detail"]


def test_discover_endpoint_network_error_is_502(client, serve):
    serve["error"] = httpx.ConnectError("boom")
    r = client.post("/api/discover-links", json={"url": "https://news.example/"})
    assert r.status_code == 502


# --------------------------------------------------------------------------- review fixes
def test_a_malformed_link_does_not_break_the_others():
    html = ('<a href="http://[object Object]/x">Broken</a><a href="http://[broken">Worse</a>'
            '<a href="/2026/ok">Fine</a>')
    assert urls(parse(html)) == ["https://news.example/2026/ok"]
    assert urls(parse('<base href="http://[bad"><a href="a1">One</a>')) == ["https://news.example/section/a1"]
    feed = "<rss><channel><item><title>T</title><link>http://[bad</link></item></channel></rss>"
    assert parse(feed)["links"] == []


def test_query_without_tracking_parameters_is_kept_as_written():
    html = ('<a href="/noticia.asp?12345">Old CMS</a><a href="/i.php?/articulo/x">Path in query</a>'
            '<a href="/p?q=a%20b&utm_source=x">Mixed</a>')
    assert urls(parse(html)) == ["https://news.example/noticia.asp?12345", "https://news.example/i.php?/articulo/x",
                                 "https://news.example/p?q=a%20b"]


def test_relative_links_follow_redirects(client, serve, monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        host = request.headers["host"]
        if host == "news.example" and request.url.path == "/section":
            return httpx.Response(301, headers={"location": "/section/"})
        if host == "news.example" and request.url.path == "/":
            return httpx.Response(301, headers={"location": "https://www.news.example/"})
        return httpx.Response(200, headers={"content-type": "text/html"},
                              content=b"<html><body><a href='a1'>One story</a></body></html>")

    monkeypatch.setattr(ingest, "_transport", httpx.MockTransport(handler))
    body = client.post("/api/discover-links", json={"url": "https://news.example/section"}).json()
    assert [x["url"] for x in body["links"]] == ["https://news.example/section/a1"]
    assert body["url"] == "https://news.example/section/"
    body = client.post("/api/discover-links", json={"url": "https://news.example/"}).json()
    assert [(x["url"], x["same_host"]) for x in body["links"]] == [("https://www.news.example/a1", True)]


def test_discover_endpoint_rejects_an_office_document(client, serve):
    docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    serve.update(body=b"PK\x03\x04 zipped", ctype=docx)
    assert client.post("/api/discover-links", json={"url": "https://news.example/a.docx"}).status_code == 422
