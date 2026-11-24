"""Link discovery on an index page or feed: parsing and the endpoint."""
import pytest

from colloca import ingest

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
