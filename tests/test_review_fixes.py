"""Fixes from the whole-branch review of language management."""
import io
import urllib.request

import pytest
from fastapi import HTTPException

from colloca import db, languages, main, nlp, ocrdata

from .test_api import ES_TEXT, IT_TEXT, make_corpus


@pytest.fixture()
def fr(client):
    languages.add("fr", "French", None, "fra")
    yield
    with db.session() as conn:
        conn.execute("DELETE FROM corpora WHERE lang='fr'")
    languages.remove("fr")


def test_term_with_one_language_is_a_clear_400_not_a_500(client, monkeypatch):
    monkeypatch.setattr(nlp, "SUPPORTED", {"es": "Spanish"})
    r = client.post("/api/terms", json={"src_lang": "es", "src_term": "contrato", "tgt_term": "contract"})
    assert r.status_code == 400 and "Languages screen" in r.json()["detail"]
    r = client.post("/api/terms", json={"src_lang": "es", "tgt_lang": "it", "src_term": "a", "tgt_term": "b"})
    assert r.status_code == 400                                              # `it` is not set up in this registry


def test_term_default_target_still_works_with_two_languages(client):
    r = client.post("/api/terms", json={"src_lang": "es", "src_term": "contrato-fix", "tgt_term": "contratto"})
    assert r.status_code == 201
    assert client.get("/api/terms", params={"q": "contrato-fix"}).json()[0]["tgt_lang"] == "it"
    client.delete(f"/api/terms/{r.json()['id']}")


def _propose(client, corpus_id, **params):
    files = {"source": ("a.txt", io.BytesIO(ES_TEXT.encode()), "text/plain"),
             "target": ("b.txt", io.BytesIO(IT_TEXT.encode()), "text/plain")}
    return client.post(f"/api/corpora/{corpus_id}/align/propose", params=params, files=files)


def test_align_propose_needs_the_target_language_when_several_are_set_up(client, fr):
    es = make_corpus(client, "es", "align-es")
    r = _propose(client, es)
    assert r.status_code == 400 and "target language" in r.json()["detail"]
    ok = _propose(client, es, target_lang="it")
    assert ok.status_code == 200 and ok.json()["target_lang"] == "it"
    assert _propose(client, es, target_lang="es").status_code == 400          # the same language
    assert _propose(client, es, target_lang="zz").status_code == 400


def test_align_propose_keeps_the_default_with_exactly_two_languages(client):
    es = make_corpus(client, "es", "align-es2")
    r = _propose(client, es)
    assert r.status_code == 200 and r.json()["target_lang"] == "it"


def test_new_partner_corpus_takes_the_chosen_language(client, fr):
    es = make_corpus(client, "es", "partner-es")
    with pytest.raises(HTTPException) as e:
        main._partner_corpus(es, None, "Translations")
    assert e.value.status_code == 400
    pid = main._partner_corpus(es, None, "Translations", "it")
    with db.session() as conn:
        assert conn.execute("SELECT lang FROM corpora WHERE id=?", (pid,)).fetchone()[0] == "it"


def test_registry_lookups_do_not_open_a_connection_each(client, monkeypatch):
    assert "es" in nlp.SUPPORTED                    # warms the cache
    opened = []
    real = db.connect
    monkeypatch.setattr(db, "connect", lambda *a, **k: opened.append(1) or real(*a, **k))
    for _ in range(200):
        assert "it" in nlp.SUPPORTED and nlp.SUPPORTED["es"] == "Spanish"
    assert opened == []


def test_registry_cache_follows_changes(client):
    assert "xx" not in nlp.SUPPORTED
    languages.add("xx", "Testish", None, "")
    assert nlp.SUPPORTED["xx"] == "Testish"
    languages.update("xx", name="Renamed")
    assert nlp.SUPPORTED["xx"] == "Renamed"
    languages.remove("xx")
    assert "xx" not in nlp.SUPPORTED


def test_ocr_download_has_a_timeout(tmp_path, monkeypatch):
    seen = {}

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(url, timeout=None):
        seen["timeout"] = timeout
        return Resp(b"traineddata")
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    dest = tmp_path / "x.part"
    ocrdata._fetch("https://example.invalid/x", dest)
    assert seen["timeout"] and seen["timeout"] > 0 and dest.read_bytes() == b"traineddata"
