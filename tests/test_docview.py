"""Reading a document: GET /api/documents/{id}/context (T06) and the paged /blocks."""
import pytest

from .test_api import make_corpus, wait_for_jobs
from .test_parallel import import_tmx, tmx

SENTENCES = [f"Esta es la frase número {n} del documento de prueba." for n in range(1, 13)]
SENTENCES[6] = "La cláusula de arrendamiento fija el plazo de entrega."


@pytest.fixture()
def doc(client):
    cid = make_corpus(client, "es", "viewer")
    r = client.post(f"/api/corpora/{cid}/documents", json={
        "title": "Contrato 7", "text": " ".join(SENTENCES), "source": "https://example.org/c7",
        "tags": "law, lease", "text_type": "contract", "doc_date": "2024-05", "author": "Ana"})
    assert r.status_code in (200, 201, 202), r.text
    hit = client.get(f"/api/corpora/{cid}/concordance", params={"q": "arrendamiento"}).json()["lines"][0]
    return cid, hit


def ctx(client, doc_id, **params):
    return client.get(f"/api/documents/{doc_id}/context", params=params)


def test_context_returns_metadata_and_the_hit_sentence_marked(client, doc):
    _, hit = doc
    res = ctx(client, hit["doc_id"], pos=hit["pos"], radius=0).json()
    d = res["document"]
    assert (d["title"], d["source"], d["author"], d["date"], d["text_type"]) == (
        "Contrato 7", "https://example.org/c7", "Ana", "2024-05", "contract")
    assert d["tags"] == ["law", "lease"] and d["aligned"] is False
    assert len(res["blocks"]) == 1 and res["blocks"][0]["hit"]
    b = res["blocks"][0]
    assert b["text"] == SENTENCES[6]
    assert [b["text"][m["start"]:m["end"]] for m in b["marks"]] == ["arrendamiento"]
    assert res["more_before"] and res["more_after"]


def test_radius_adds_sentences_on_both_sides_and_stops_at_the_edges(client, doc):
    _, hit = doc
    res = ctx(client, hit["doc_id"], pos=hit["pos"], radius=2).json()
    assert [b["text"] for b in res["blocks"]] == SENTENCES[4:9]
    assert [b["hit"] for b in res["blocks"]] == [False, False, True, False, False]
    everything = ctx(client, hit["doc_id"], pos=hit["pos"], radius=50).json()
    assert [b["text"] for b in everything["blocks"]] == SENTENCES
    assert not everything["more_before"] and not everything["more_after"]


def test_a_multi_word_span_is_marked_as_one_range(client, doc):
    cid, _ = doc
    hit = client.get(f"/api/corpora/{cid}/concordance", params={"q": "plazo de entrega"}).json()["lines"][0]
    b = ctx(client, hit["doc_id"], pos=hit["pos"], span=3, radius=0).json()["blocks"][0]
    assert [b["text"][m["start"]:m["end"]] for m in b["marks"]] == ["plazo de entrega"]


def test_errors(client, doc):
    _, hit = doc
    assert ctx(client, 999999, pos=0).status_code == 404
    assert ctx(client, hit["doc_id"], pos=99999).status_code == 400
    assert ctx(client, hit["doc_id"], pos=-1).status_code == 422
    assert ctx(client, hit["doc_id"], pos=0, radius=51).status_code == 422


def test_aligned_documents_return_segments_with_their_translation(client):
    es, it = make_corpus(client, "es", "ES"), make_corpus(client, "it", "IT")
    pairs = [(f"Cláusula {k}: el contrato establece el plazo {k}.",
              f"Clausola {k}: il contratto stabilisce il termine {k}.") for k in range(1, 9)]
    import_tmx(client, es, tmx(pairs), partner_corpus_id=it)
    assert wait_for_jobs(client, es)[0]["status"] == "done"
    lines = client.get(f"/api/corpora/{es}/bilingual", params={"q": "contrato"}).json()["lines"]
    hit = lines[3]
    res = ctx(client, hit["doc_id"], pos=hit["pos"], radius=1).json()
    assert res["document"]["aligned"] is True
    assert len(res["blocks"]) == 3
    mid = res["blocks"][1]
    assert mid["hit"] and mid["text"] == hit["source"] and mid["pair"] == hit["target"]
    assert [mid["text"][m["start"]:m["end"]] for m in mid["marks"]] == ["contrato"]
    assert all(b["pair"].startswith("Clausola") for b in res["blocks"])
    # from the target side the roles swap
    rev_hit = client.get(f"/api/corpora/{it}/bilingual", params={"q": "contratto"}).json()["lines"][3]
    rev = ctx(client, rev_hit["doc_id"], pos=rev_hit["pos"], radius=0).json()["blocks"][0]
    assert rev["text"] == rev_hit["source"] and rev["pair"] == rev_hit["target"]


PARAGRAPHS = ["Primer párrafo del contrato de prueba.", "Segundo párrafo con el plazo de entrega.",
              "Tercer párrafo que cierra el documento."]


def add_plain(client, text, title="Plain"):
    cid = make_corpus(client, "es", title)
    r = client.post(f"/api/corpora/{cid}/documents", json={"title": title, "text": text})
    assert r.status_code in (200, 201, 202), r.text
    [d] = client.get(f"/api/corpora/{cid}/documents").json()
    return d["id"]


def blocks(client, doc_id, **params):
    return client.get(f"/api/documents/{doc_id}/blocks", params=params)


def test_blocks_pages_paragraphs(client):
    doc_id = add_plain(client, "\n\n".join(PARAGRAPHS) + "\n")
    first = blocks(client, doc_id, start=0, limit=2).json()
    assert first["document"]["title"] == "Plain" and first["document"]["aligned"] is False
    assert [b["n"] for b in first["blocks"]] == [0, 1]
    assert [b["text"] for b in first["blocks"]] == PARAGRAPHS[:2]
    assert all(b["pair"] == "" for b in first["blocks"]) and first["total"] == 3
    rest = blocks(client, doc_id, start=2).json()
    assert [(b["n"], b["text"]) for b in rest["blocks"]] == [(2, PARAGRAPHS[2])] and rest["total"] == 3


def test_blocks_single_line_breaks_split_when_no_blank_lines(client):
    doc_id = add_plain(client, "\n".join(PARAGRAPHS))
    res = blocks(client, doc_id).json()
    assert [b["text"] for b in res["blocks"]] == PARAGRAPHS and res["total"] == 3


def _aligned_pair(client):
    es, it = make_corpus(client, "es", "ES"), make_corpus(client, "it", "IT")
    pairs = [(f"Cláusula {k}: el contrato establece el plazo {k}.",
              f"Clausola {k}: il contratto stabilisce il termine {k}.") for k in range(1, 9)]
    import_tmx(client, es, tmx(pairs), partner_corpus_id=it)
    assert wait_for_jobs(client, es)[0]["status"] == "done"
    [d_es] = client.get(f"/api/corpora/{es}/documents").json()
    [d_it] = client.get(f"/api/corpora/{it}/documents").json()
    return pairs, d_es["id"], d_it["id"]


def test_blocks_aligned_pairs_segments(client):
    pairs, es_doc, _ = _aligned_pair(client)
    res = blocks(client, es_doc).json()
    assert res["document"]["aligned"] is True and res["total"] == len(pairs)
    assert [(b["text"], b["pair"]) for b in res["blocks"]] == pairs
    page = blocks(client, es_doc, start=6, limit=5).json()
    assert [b["n"] for b in page["blocks"]] == [6, 7] and page["total"] == len(pairs)


def test_blocks_partner_trashed_falls_back_to_paragraphs(client):
    pairs, es_doc, it_doc = _aligned_pair(client)
    assert client.delete(f"/api/documents/{it_doc}").status_code == 204
    res = blocks(client, es_doc).json()
    assert res["document"]["aligned"] is False
    assert [b["text"] for b in res["blocks"]] == [a for a, _ in pairs]
    assert all(b["pair"] == "" for b in res["blocks"]) and res["total"] == len(pairs)


def test_blocks_404_for_deleted_document(client):
    doc_id = add_plain(client, "\n\n".join(PARAGRAPHS))
    assert blocks(client, 999999).status_code == 404
    assert client.delete(f"/api/documents/{doc_id}").status_code == 204
    assert blocks(client, doc_id).status_code == 404


def test_blocks_limit_is_capped(client):
    doc_id = add_plain(client, "\n\n".join(PARAGRAPHS))
    assert blocks(client, doc_id, limit=500).status_code == 200
    assert blocks(client, doc_id, limit=501).status_code == 422
    assert blocks(client, doc_id, limit=0).status_code == 422
    assert blocks(client, doc_id, start=-1).status_code == 422
