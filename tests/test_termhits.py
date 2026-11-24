import pytest

from colloca import db

from .test_api import add, make_corpus, wait_for_jobs
from .test_parallel import build_pairs, import_tmx, tmx


def term(client, **fields):
    body = {"src_lang": "es", "src_term": "contrato", "tgt_term": "contratto", "status": "approved", **fields}
    r = client.post("/api/terms", json=body)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture(autouse=True)
def _clean_terms(client):
    with db.session() as conn:
        conn.execute("DELETE FROM terms")


@pytest.fixture()
def pair(client):
    es, it = make_corpus(client, "es", "ES side"), make_corpus(client, "it", "IT side")
    import_tmx(client, es, tmx(build_pairs()), partner_corpus_id=it)
    assert wait_for_jobs(client, es)[0]["status"] == "done"
    return es, it


def spans(text, marks):
    return [(text[m["start"]:m["end"]], m["kind"]) for m in marks]


def check(client, cid, text, lang=""):
    r = client.post(f"/api/corpora/{cid}/check-text", json={"text": text, "lang": lang})
    assert r.status_code == 200, r.text
    return r.json()


def test_check_source_text_inflected_and_multiword(client):
    cid = make_corpus(client, "es", "chk")
    term(client)
    term(client, src_term="plazo de entrega", tgt_term="termine di consegna")
    term(client, src_term="contrato", tgt_term="accordo", status="forbidden")
    res = check(client, cid, "Los contratos fijan los plazos de entrega del cliente.")
    [line] = res["lines"]
    assert spans(line["text"], line["marks"]) == [("contratos", "term"), ("plazos de entrega", "term")]
    m = line["marks"][0]
    assert m["translations"] == ["contratto"] and m["forbidden"] == ["accordo"] and m["term"] == "contrato"
    assert res["summary"] == {"hits": 2, "forbidden": 0}


def test_check_draft_translation_flags_forbidden_and_approved(client):
    cid = make_corpus(client, "es", "chk2")
    term(client)
    term(client, tgt_term="accordo", status="forbidden")
    term(client, src_term="plazo de entrega", tgt_term="termine di consegna")
    res = check(client, cid, "Il contratto e l'accordo fissano i termini di consegna.\n\nUn altro accordo.", lang="it")
    assert len(res["lines"]) == 2
    first = res["lines"][0]
    assert spans(first["text"], first["marks"]) == [("contratto", "term"), ("accordo", "forbidden"),
                                                          ("termini di consegna", "term")]
    bad = first["marks"][1]
    assert bad["translations"] == ["contratto"] and bad["of"] == "contrato"
    assert res["summary"] == {"hits": 2, "forbidden": 2}


def test_the_termbase_is_per_project_and_cached_fresh(client):
    pid = client.post("/api/projects", json={"name": "Termhits client"}).json()["id"]
    cid = client.post("/api/corpora", json={"name": "p", "lang": "es", "project_id": pid}).json()["id"]
    other = make_corpus(client, "es", "no project")
    t = term(client, project_id=pid)
    assert check(client, cid, "El contrato.")["summary"]["hits"] == 1
    assert check(client, other, "El contrato.")["summary"]["hits"] == 0       # another project's entry
    client.delete(f"/api/terms/{t['id']}")
    assert check(client, cid, "El contrato.")["summary"]["hits"] == 0         # the cache follows edits


def test_check_text_validation(client):
    cid = make_corpus(client, "es", "chk3")
    assert client.post(f"/api/corpora/{cid}/check-text", json={"text": "  "}).status_code == 400
    assert client.post(f"/api/corpora/{cid}/check-text", json={"text": "x", "lang": "xx"}).status_code == 400
    assert client.post("/api/corpora/99999/check-text", json={"text": "x"}).status_code == 404


def test_bilingual_lines_carry_term_and_forbidden_offsets(client, pair):
    es, it = pair
    term(client)
    term(client, src_term="plazo de entrega", tgt_term="termine di consegna")
    term(client, tgt_term="accordo", status="forbidden")
    lines = client.get(f"/api/corpora/{es}/bilingual", params={"q": "contrato"}).json()["lines"]
    assert lines
    ln = lines[0]
    assert spans(ln["source"], ln["source_terms"]) == [("contrato", "term")]
    assert spans(ln["target"], ln["target_terms"]) == [("contratto", "term")]
    assert ln["source_marks"] and ln["target_marks"] is not None                    # old fields stay
    plazo = client.get(f"/api/corpora/{es}/bilingual", params={"q": "plazo"}).json()["lines"][0]
    assert spans(plazo["source"], plazo["source_terms"]) == [("plazo de entrega", "term")]
    assert spans(plazo["target"], plazo["target_terms"]) == [("termine di consegna", "term")]


def test_forbidden_translation_in_an_aligned_target_is_flagged(client, pair):
    es, it = pair
    term(client, tgt_term="contratto", status="forbidden")
    term(client, tgt_term="accordo")
    ln = client.get(f"/api/corpora/{es}/bilingual", params={"q": "contrato"}).json()["lines"][0]
    assert spans(ln["target"], ln["target_terms"]) == [("contratto", "forbidden")]
    assert ln["target_terms"][0]["translations"] == ["accordo"]
    # searching from the target side marks the same thing in the target-language segment
    ln = client.get(f"/api/corpora/{it}/bilingual", params={"q": "contratto"}).json()["lines"][0]
    assert spans(ln["source"], ln["source_terms"]) == [("contratto", "forbidden")]


def test_csv_exports_are_unchanged(client, pair):
    es, _ = pair
    term(client)
    for path, q in ((f"/api/corpora/{es}/bilingual", "contrato"), (f"/api/corpora/{es}/concordance", "contrato")):
        head = client.get(path, params={"q": q, "format": "csv"}).text.splitlines()[0]
        assert "terms" not in head and "span" not in head and "marks" not in head


def test_kwic_lines_carry_term_offsets(client):
    cid = make_corpus(client, "es", "kwic")
    add(client, cid, "El cliente firma los contratos de arrendamiento hoy mismo. Otro texto sin nada.")
    term(client)
    term(client, src_term="contrato de arrendamiento", tgt_term="contratto di locazione")
    [ln] = client.get(f"/api/corpora/{cid}/concordance", params={"q": "contrato", "width": 6}).json()["lines"]
    assert spans(ln["node"], ln["node_terms"]) == [("contratos", "term")]
    # the longer term crosses into the right context: the node part and the context part are both marked
    assert spans(ln["right"], ln["right_terms"]) == [("de arrendamiento", "term")]
    assert ln["left_terms"] == []
