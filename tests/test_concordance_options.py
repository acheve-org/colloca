"""Concordance search options (T04): case, wildcard, any order, hit limit, random sample, multi-level sort."""
import re

import pytest

from .test_api import add, make_corpus

TEXT = ("El contrato de arrendamiento termina hoy. Los contratos de trabajo son largos. "
        "La contratación de personal es lenta. El Contrato Marco se firma mañana. "
        "El cumplimiento del contrato es obligatorio. Un departamento y un cumplimiento perfecto. "
        "Ayer firmamos el contrato con el cliente. Hoy el cliente revisa el contrato nuevo.")


@pytest.fixture()
def cid(client):
    c = make_corpus(client, "es", "options")
    assert add(client, c, TEXT).status_code in (200, 201, 202)
    return c


def conc(client, cid, **params):
    r = client.get(f"/api/corpora/{cid}/concordance", params=params)
    return r


def nodes(res):
    return [ln["node"] for ln in res["lines"]]


def test_default_search_is_case_insensitive_and_unchanged(client, cid):
    res = conc(client, cid, q="contrato", unit="form").json()
    assert res["total"] == 5 and "Contrato" in nodes(res)
    assert set(res["lines"][0]) >= {"doc_id", "doc", "pos", "left", "node", "right"}


def test_case_sensitive_matches_the_written_form(client, cid):
    res = conc(client, cid, q="Contrato", case_sensitive="true").json()
    assert res["total"] == 1 and nodes(res) == ["Contrato"]
    assert conc(client, cid, q="contrato", case_sensitive="true").json()["total"] == 4
    assert conc(client, cid, q="contrato", case_sensitive="true", unit="form").json()["total"] == 4


def test_wildcard_at_the_start_or_end_of_a_word(client, cid):
    res = conc(client, cid, q="contrat*", unit="form").json()
    assert sorted({n.lower() for n in nodes(res)}) == ["contratación", "contrato", "contratos"]
    assert res["total"] == 7
    assert sorted({n.lower() for n in nodes(conc(client, cid, q="*miento", unit="form").json())}) == [
        "arrendamiento", "cumplimiento"]
    assert conc(client, cid, q="contrat*", unit="form", case_sensitive="true").json()["total"] == 6


def test_wildcard_rules(client, cid):
    for bad in ("co*", "*", "con*ato", "**"):
        r = conc(client, cid, q=bad)
        assert r.status_code == 400, bad
    assert "wildcard" in conc(client, cid, q="con*ato").json()["detail"].lower()
    # GLOB's own characters in the query are literal
    assert conc(client, cid, q="contr[ao]").json()["total"] == 0
    assert conc(client, cid, q="contr?to").json()["total"] == 0


def test_wildcard_inside_a_phrase(client, cid):
    res = conc(client, cid, q="contrat* de", unit="form").json()
    assert res["total"] == 3 and all(n.lower().endswith(" de") for n in nodes(res))


def test_any_order_finds_the_words_in_one_sentence(client, cid):
    ordered = conc(client, cid, q="contrato cliente", unit="form").json()
    assert ordered["total"] == 0
    both = conc(client, cid, q="contrato cliente", unit="form", any_order="true").json()
    assert both["total"] == 2
    lines = both["lines"]
    assert lines[0]["node"].lower().startswith("contrato") or "cliente" in lines[0]["node"].lower()
    assert {"contrato", "cliente"} <= set(lines[0]["node"].lower().replace(".", "").split())
    # words in different sentences are not a hit
    assert conc(client, cid, q="arrendamiento hoy trabajo", any_order="true").json()["total"] == 0
    rev = conc(client, cid, q="cliente contrato", unit="form", any_order="true").json()
    assert rev["total"] == 2 and [ln["pos"] for ln in rev["lines"]] == [ln["pos"] for ln in lines]


def test_limit_and_total(client, cid):
    res = conc(client, cid, q="contrato", unit="form", limit=2).json()
    assert res["total"] == 5 and len(res["lines"]) == 2
    assert conc(client, cid, q="contrato", limit=0).status_code == 422


def test_random_sample_is_reproducible_and_a_subset(client, cid):
    full = conc(client, cid, q="contrato", unit="form").json()
    a = conc(client, cid, q="contrato", unit="form", limit=3, sample=7).json()
    b = conc(client, cid, q="contrato", unit="form", limit=3, sample=7).json()
    assert a == b and a["total"] == 5 and len(a["lines"]) == 3
    assert {ln["pos"] for ln in a["lines"]} <= {ln["pos"] for ln in full["lines"]}
    seen = {tuple(ln["pos"] for ln in conc(client, cid, q="contrato", unit="form", limit=3, sample=s).json()["lines"])
            for s in range(12)}
    assert len(seen) > 1                                    # other seeds give other samples
    small = conc(client, cid, q="contrato", unit="form", limit=50, sample=1).json()
    assert small["lines"] == full["lines"]                  # fewer hits than the limit: all of them, in order


def test_sort_by_the_first_and_second_word_on_each_side(client, cid):
    def key(res, side, k):
        words = [re.findall(r"\w+|[^\w\s]", ln[side].lower()) for ln in res["lines"]]   # tokens, like the server
        return [(w[::-1] if side == "left" else w)[k] if len(w) > k else "" for w in words]
    for sort, side, k in (("r1", "right", 0), ("r2", "right", 1), ("l1", "left", 0), ("l2", "left", 1)):
        res = conc(client, cid, q="contrato", unit="form", sort=sort, width=3).json()
        keys = key(res, side, k)
        assert keys == sorted(keys), sort
    assert conc(client, cid, q="contrato", sort="bogus").status_code == 400


def test_csv_keeps_the_options_and_hides_internals(client, cid):
    r = conc(client, cid, q="contrat*", unit="form", limit=2, sample=3, format="csv")
    lines = r.text.splitlines()
    assert len(lines) == 3 and "matches" not in lines[0] and "pos" not in lines[0].split(",")
