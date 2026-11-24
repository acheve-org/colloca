"""Dispersion plot (T27): where a query occurs across the documents; counts must match the concordance."""
import pytest

from .test_api import add, make_corpus

DOCS = {
    "uno": "El contrato empieza aquí. " + "Hablamos de otra cosa. " * 8 + "El contrato termina allí.",
    "dos": "Nada que ver con ello. " * 5,
    "tres": "El contrato está al final. Los contratos también.",
}


@pytest.fixture()
def cid(client):
    c = make_corpus(client, "es", "plot")
    for title, text in DOCS.items():
        assert add(client, c, text, title).status_code in (200, 201, 202)
    return c


def plot(client, cid, **params):
    return client.get(f"/api/corpora/{cid}/dispersion", params=params)


def test_counts_match_the_concordance_document_by_document(client, cid):
    res = plot(client, cid, q="contrato").json()
    conc = client.get(f"/api/corpora/{cid}/concordance", params={"q": "contrato", "limit": 500}).json()
    assert res["total"] == conc["total"] == 4
    per_doc = {}
    for ln in conc["lines"]:
        per_doc[ln["doc_id"]] = per_doc.get(ln["doc_id"], 0) + 1
    assert {d["doc_id"]: d["hits"] for d in res["docs"] if d["hits"]} == per_doc


def test_lists_documents_without_hits_and_the_range(client, cid):
    res = plot(client, cid, q="contrato").json()
    assert [d["title"] for d in res["docs"]] == ["uno", "dos", "tres"]
    assert [d["hits"] for d in res["docs"]] == [2, 0, 2]
    assert res["range"] == 2
    assert res["docs"][1]["marks"] == [] and res["docs"][1]["per_million"] == 0


def test_marks_are_relative_positions_in_document_order(client, cid):
    uno = plot(client, cid, q="contrato").json()["docs"][0]
    ats = [m["at"] for m in uno["marks"]]
    assert len(ats) == 2 and ats == sorted(ats)
    assert ats[0] < 0.1 and ats[1] > 0.8          # one near the start, one near the end
    assert all(0 <= a < 1 for a in ats)
    assert all(m["pos"] < uno["length"] for m in uno["marks"])


def test_query_options_work_as_in_the_concordance(client, cid):
    assert plot(client, cid, q="contratos", unit="form").json()["total"] == 1
    assert plot(client, cid, q="contrat*").json()["total"] == 4
    assert plot(client, cid, q="Contrato", case_sensitive="true").json()["total"] == 0


def test_scope_filters_apply(client, cid):
    docs = client.get(f"/api/corpora/{cid}/documents").json()
    only = [d["id"] for d in docs if d["title"] == "tres"]
    res = plot(client, cid, q="contrato", docs=",".join(map(str, only))).json()
    assert [d["title"] for d in res["docs"]] == ["tres"] and res["total"] == 2


def test_bad_query_is_a_400_and_csv_has_one_row_per_document(client, cid):
    assert plot(client, cid, q="[lemma=", advanced="true").status_code == 400
    csv = plot(client, cid, q="contrato", format="csv")
    assert csv.status_code == 200
    lines = csv.text.strip().splitlines()
    assert len(lines) == 1 + 3 and "marks" not in lines[0]


def test_unknown_corpus_is_404(client):
    assert plot(client, 99999, q="x").status_code == 404
