"""URL fetching (T25): connect to the address that was checked, and import a list of URLs."""
import itertools
import socket

import httpx
import pytest

from corpora import ingest

from .test_api import make_corpus, wait_for_jobs

PUBLIC = "93.184.216.34"
PRIVATE = "10.0.0.7"
PAGE = ("<html><head><title>Una página</title></head><body><article><p>El contrato de arrendamiento se firma "
        "mañana en la oficina de la empresa y todos los socios deben asistir sin falta.</p></article></body></html>")


_n = itertools.count()


def page() -> bytes:
    """A readable page that differs on every call (the extractor drops text it has seen before)."""
    return PAGE.replace("empresa", f"empresa número {next(_n)}").encode()


def answers(*addresses):
    """A getaddrinfo that gives the next address on each call (the last one repeats) and counts its calls."""
    calls = []

    def fake(host, port, *a, **k):
        calls.append((host, port))
        ip = addresses[min(len(calls), len(addresses)) - 1]
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]
    fake.calls = calls
    return fake


@pytest.fixture()
def net(monkeypatch):
    """Every request goes to a recording transport; no proxies, no delay."""
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, content=page())

    monkeypatch.setattr(ingest, "_transport", httpx.MockTransport(handler))
    monkeypatch.setattr(ingest, "ALLOW_PRIVATE", False)
    monkeypatch.setattr(ingest, "URL_DELAY", 0)
    for k in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        monkeypatch.delenv(k, raising=False)
    return seen


# --------------------------------------------------------------------------- DNS rebinding
def test_connects_to_the_address_that_was_checked(net, monkeypatch):
    # A resolver that is honest once and then points at an internal address: the second answer must never be used.
    fake = answers(PUBLIC, PRIVATE)
    monkeypatch.setattr(socket, "getaddrinfo", fake)
    ingest.fetch_url("https://example.org/contrato")
    assert len(net) == 1
    request = net[0]
    assert request.url.host == PUBLIC                       # the validated address, not the name
    assert request.headers["host"] == "example.org"          # the site still sees its own name
    assert request.extensions["sni_hostname"] == "example.org"   # and TLS checks the certificate against it
    assert len(fake.calls) == 1                              # resolved once: nothing to rebind


def test_an_internal_answer_is_refused_before_any_request(net, monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", answers(PRIVATE))
    with pytest.raises(ingest.IngestError, match="private"):
        ingest.fetch_url("https://example.org/")
    assert net == []


def test_one_internal_address_among_several_refuses_the_host(net, monkeypatch):
    def mixed(host, port, *a, **k):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for ip in (PUBLIC, "127.0.0.1")]
    monkeypatch.setattr(socket, "getaddrinfo", mixed)
    with pytest.raises(ingest.IngestError, match="private"):
        ingest.fetch_url("https://example.org/")
    assert net == []


def test_each_redirect_hop_is_checked_and_pinned_again(net, monkeypatch):
    hops = []

    def handler(request: httpx.Request) -> httpx.Response:
        hops.append(request)
        if len(hops) == 1:
            return httpx.Response(302, headers={"location": "https://other.example.net/a"})
        return httpx.Response(200, headers={"content-type": "text/html"}, content=page())

    monkeypatch.setattr(ingest, "_transport", httpx.MockTransport(handler))
    hosts = {"example.org": PUBLIC, "other.example.net": "93.184.216.35"}
    monkeypatch.setattr(socket, "getaddrinfo", lambda h, p, *a, **k: [(socket.AF_INET, 1, 6, "", (hosts[h], p))])
    ingest.fetch_url("https://example.org/")
    assert [r.url.host for r in hops] == [PUBLIC, "93.184.216.35"]
    assert [r.headers["host"] for r in hops] == ["example.org", "other.example.net"]


def test_a_redirect_to_an_internal_host_is_refused(net, monkeypatch):
    monkeypatch.setattr(ingest, "_transport", httpx.MockTransport(
        lambda r: httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data"})))
    monkeypatch.setattr(socket, "getaddrinfo", answers(PUBLIC))
    with pytest.raises(ingest.IngestError, match="private"):
        ingest.fetch_url("https://example.org/")


def test_a_literal_private_address_is_refused_without_a_lookup(net, monkeypatch):
    def no_lookup(*a, **k):
        raise AssertionError("a literal address needs no DNS")
    monkeypatch.setattr(socket, "getaddrinfo", no_lookup)
    for url in ("http://127.0.0.1/", "http://10.1.2.3:8080/x", "http://169.254.169.254/latest", "http://[::1]/"):
        with pytest.raises(ingest.IngestError, match="private"):
            ingest.fetch_url(url)
    assert net == []


def test_pinned_url_keeps_port_and_brackets_ipv6():
    url, headers, ext = ingest._pinned("https://example.org:8443/p?q=1", "2001:db8::1")
    assert url == "https://[2001:db8::1]:8443/p?q=1" and headers == {"Host": "example.org:8443"}
    assert ext == {"sni_hostname": "example.org"}


def test_no_pinning_behind_a_proxy(net, monkeypatch):
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.local:3128")
    monkeypatch.setattr(socket, "getaddrinfo", answers(PUBLIC))
    assert ingest._check_public("https://example.org/") is None


# --------------------------------------------------------------------------- the list
def test_parse_url_list_keeps_good_lines_and_explains_the_rest(monkeypatch):
    monkeypatch.setattr(ingest, "MAX_URLS_PER_HOST", 2)
    urls, bad = ingest.parse_url_list([
        "https://a.example/1", "", "# comment", "ftp://a.example/x", "https://a.example/1", "not a url",
        "https://a.example/2", "https://a.example/3", "https://b.example/1"])
    assert urls == ["https://a.example/1", "https://a.example/2", "https://b.example/1"]
    reasons = {b["url"]: b["error"] for b in bad}
    assert "http(s)" in reasons["ftp://a.example/x"] and "http(s)" in reasons["not a url"]
    assert "twice" in reasons["https://a.example/1"]
    assert "a.example" in reasons["https://a.example/3"] and "MAX_URLS_PER_HOST" in reasons["https://a.example/3"]


def test_parse_url_list_caps_the_list(monkeypatch):
    monkeypatch.setattr(ingest, "MAX_URL_LIST", 3)
    monkeypatch.setattr(ingest, "MAX_URLS_PER_HOST", 99)
    urls, bad = ingest.parse_url_list([f"https://h{i}.example/" for i in range(5)])
    assert len(urls) == 3 and len(bad) == 2 and "MAX_URL_LIST" in bad[0]["error"]


def test_list_import_gives_one_result_per_line(client, net, monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["host"] == "broken.example":
            return httpx.Response(404)
        body = page().replace("mañana".encode(), request.url.path.encode())
        return httpx.Response(200, headers={"content-type": "text/html"}, content=body)

    monkeypatch.setattr(ingest, "_transport", httpx.MockTransport(handler))
    monkeypatch.setattr(socket, "getaddrinfo", answers(PUBLIC))
    cid = make_corpus(client, "es", "urls")
    r = client.post(f"/api/corpora/{cid}/urls", json={"urls": [
        "https://ok.example/uno", "https://ok.example/dos", "https://broken.example/x", "ftp://no.example/", "",
    ], "tags": "web"})
    assert r.status_code == 202
    res = r.json()
    assert [x["url"] for x in res] == ["ftp://no.example/", "https://ok.example/uno", "https://ok.example/dos",
                                       "https://broken.example/x"]
    assert [x["ok"] for x in res] == [False, True, True, True]
    jobs = {j["id"]: j for j in wait_for_jobs(client, cid)}
    assert jobs[res[1]["job_id"]]["status"] == "done" and jobs[res[2]["job_id"]]["status"] == "done"
    assert jobs[res[3]["job_id"]]["status"] == "error" and "404" in jobs[res[3]["job_id"]]["error"]
    docs = client.get(f"/api/corpora/{cid}/documents").json()
    assert sorted(d["source"] for d in docs) == ["https://ok.example/dos", "https://ok.example/uno"]
    assert all(d["kind"] == "url" and d["tags"] == ["web"] for d in docs)


def test_list_import_refuses_internal_addresses_per_url(client, net, monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", answers(PRIVATE))
    cid = make_corpus(client, "es", "internal")
    res = client.post(f"/api/corpora/{cid}/urls", json={"urls": ["https://intranet.example/"]}).json()
    job = wait_for_jobs(client, cid)[0]
    assert job["id"] == res[0]["job_id"] and job["status"] == "error" and "private" in job["error"]
    assert net == []


def test_empty_list_and_unknown_corpus(client):
    cid = make_corpus(client, "es", "empty")
    assert client.post(f"/api/corpora/{cid}/urls", json={"urls": ["", "  "]}).status_code == 400
    assert client.post("/api/corpora/99999/urls", json={"urls": ["https://a.example/"]}).status_code == 404


def test_requests_to_one_host_are_spaced(monkeypatch):
    clock = {"now": 100.0, "slept": []}
    monkeypatch.setattr(ingest, "URL_DELAY", 2.0)
    monkeypatch.setattr(ingest, "_last_request", {})
    monkeypatch.setattr(ingest.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(ingest.time, "sleep", lambda s: clock.update(now=clock["now"] + s, slept=clock["slept"] + [s]))
    ingest._be_polite("a.example")
    ingest._be_polite("b.example")            # another host: no wait
    clock["now"] += 0.5
    ingest._be_polite("a.example")            # 0.5 s later: waits the remaining 1.5 s
    assert clock["slept"] == [1.5]
