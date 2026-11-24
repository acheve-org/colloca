"""Automatic alignment of two documents (T08). The fixtures are synthetic, written for these tests."""
import io
import time

import pytest
from docx import Document

from colloca import align, db

from .test_api import make_corpus, wait_for_jobs

# Each entry: (Spanish sentences, Italian sentences). One sentence per side = a 1:1 link; a Spanish sentence
# against two Italian ones is a 1:2 link, two against one a 2:1 link.
PARAGRAPHS = [
    [
        (["El contrato establece las obligaciones del arrendador en cada caso concreto."],
         ["Il contratto stabilisce gli obblighi del locatore in ogni caso concreto."]),
        (["El plazo de entrega termina el 15 de marzo de 2024 en Madrid."],
         ["Il termine di consegna scade il 15 marzo 2024 a Madrid."]),
    ],
    [
        (["El arrendatario deberá pagar la renta mensual por adelantado y conservar el inmueble en buen estado "
          "durante toda la vigencia del presente contrato de arrendamiento."],
         ["Il conduttore dovrà pagare il canone mensile in anticipo.",
          "Dovrà inoltre conservare l'immobile in buono stato per tutta la durata del presente contratto di "
          "locazione."]),
        (["La garantía asciende a 3000 euros."], ["La garanzia ammonta a 3000 euro."]),
    ],
    [
        (["Gracias.", "Hasta pronto."], ["Grazie e a presto."]),
        (["¿Existe alguna cláusula de rescisión anticipada para ambas partes?"],
         ["Esiste una clausola di recesso anticipato per entrambe le parti?"]),
    ],
]


def build():
    """(Spanish text, Italian text): one paragraph per block of PARAGRAPHS."""
    es, it = [], []
    for para in PARAGRAPHS:
        es.append(" ".join(s for a, _ in para for s in a))
        it.append(" ".join(s for _, b in para for s in b))
    return "\n".join(es), "\n".join(it)


def docx_bytes(text):
    d = Document()
    for line in text.split("\n"):
        d.add_paragraph(line)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


# --------------------------------------------------------------------------- the algorithm
def test_known_links_are_found():
    es, it = build()
    links = align.propose(es, it, "es", "it")
    expected = [(len(a), len(b)) for para in PARAGRAPHS for a, b in para]
    assert [(len(lk.src), len(lk.tgt)) for lk in links] == expected
    by_first = {lk.src[0]: lk for lk in links}
    one_two = by_first[PARAGRAPHS[1][0][0][0]]
    assert one_two.type == "1:2"
    assert one_two.tgt == PARAGRAPHS[1][0][1]
    two_one = by_first["Gracias."]
    assert two_one.type == "2:1" and two_one.src == ["Gracias.", "Hasta pronto."]
    assert by_first[PARAGRAPHS[0][0][0][0]].tgt == PARAGRAPHS[0][0][1]
    assert by_first[PARAGRAPHS[1][1][0][0]].tgt == PARAGRAPHS[1][1][1]
    rep = align.links_report(links)
    assert rep["by_type"] == {"1:1": 4, "1:2": 1, "2:1": 1, "1:0": 0, "0:1": 0}
    assert rep["links"] == 6


def test_unaligned_extra_paragraph_becomes_zero_to_one():
    es = ("El contrato establece las obligaciones del arrendador.\nEl plazo de entrega termina el viernes.\n"
          "La casa tiene un jardín grande y muy bonito.\nEl cliente paga la renta cada mes.")
    it = ("Il contratto stabilisce gli obblighi del locatore.\nIl termine di consegna scade venerdì.\n"
          "Nota del traduttore, questo paragrafo è stato aggiunto in seguito e non ha un testo originale.\n"
          "La casa ha un giardino grande e molto bello.\nIl cliente paga l'affitto ogni mese.")
    links = align.propose(es, it, "es", "it")
    assert [lk.type for lk in links] == ["1:1", "1:1", "0:1", "1:1", "1:1"]
    assert links[2].low and links[2].confidence == 0.0 and links[2].tgt[0].startswith("Nota del traduttore")


def test_numbers_anchor_the_alignment():
    a = [align.Item.of(t) for t in ["Total 4500 euros.", "Total 120 euros."]]
    b = [align.Item.of(t) for t in ["Totale 4500 euro.", "Totale 120 euro."]]
    assert align.align_items(a, b) == [(0, 1, 0, 1), (1, 2, 1, 2)]
    shared, only, _ = align._anchor_stats(a[:1], b[1:])
    assert (shared, only) == (0, 2)


def test_features():
    numbers, names, last = align._features("Ayer Pedro visitó Madrid el 05/03/2024. ¿Y tú?")
    assert numbers == {"5", "3", "2024"}
    assert names == {"pedro", "madrid"} and last == "?"


def test_report_and_confirm_pairs():
    links = [(["a"], ["b"], False), (["a", "c"], ["b"], True), (["x"], [], True), (["y"], ["z" * 4000], False)]
    pairs, rep = align.confirm_pairs(links)
    assert pairs == [("a", "b"), ("a c", "b")]
    assert rep["by_type"]["1:1"] == 2 and rep["by_type"]["2:1"] == 1 and rep["by_type"]["1:0"] == 1
    assert rep["links"] == 4 and rep["low"] == 2 and rep["low_share"] == 0.5
    assert rep["stored"] == 2 and rep["dropped"] == 2


def test_flat_fallback_when_paragraphs_do_not_match():
    es = "El contrato establece las obligaciones. El plazo termina el viernes. La casa tiene un jardín."
    it = "Il contratto stabilisce gli obblighi.\nIl termine scade venerdì.\nLa casa ha un giardino."
    links = align.propose(es, it, "es", "it")
    assert [lk.type for lk in links] == ["1:1"] * 3


# --------------------------------------------------------------------------- the API
def count_docs():
    with db.session() as conn:
        return conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]


def propose(client, cid, es, it):
    r = client.post(f"/api/corpora/{cid}/align/propose",
                    files=[("source", ("contrato.docx", docx_bytes(es), "x")),
                           ("target", ("contratto.docx", docx_bytes(it), "x"))])
    assert r.status_code == 200, r.text
    return r.json()


def test_propose_stores_nothing_and_confirm_is_searchable(client):
    es_c, it_c = make_corpus(client, "es", "ES"), make_corpus(client, "it", "IT")
    es, it = build()
    before = count_docs()
    prop = propose(client, es_c, es, it)
    assert count_docs() == before          # nothing stored by proposing
    assert prop["source_lang"] == "es" and prop["target_lang"] == "it" and prop["title"] == "contrato"
    assert prop["report"]["by_type"]["1:2"] == 1 and prop["report"]["links"] == len(prop["links"])

    links = [{"src": lk["src"], "tgt": lk["tgt"], "low": lk["low"]} for lk in prop["links"]]
    r = client.post(f"/api/corpora/{es_c}/align/confirm",
                    json={"links": links, "title": prop["title"], "partner_corpus_id": it_c})
    assert r.status_code == 202, r.text
    job = wait_for_jobs(client, es_c)[0]
    assert job["status"] == "done", job
    assert job["result"]["segments"] == len(links)
    assert job["result"]["report"]["by_type"]["1:2"] == 1
    assert count_docs() == before + 2

    res = client.get(f"/api/corpora/{es_c}/bilingual", params={"q": "arrendatario", "unit": "form"}).json()
    assert len(res["lines"]) == 1
    assert "Il conduttore dovrà" in str(res["lines"][0]) and "Dovrà inoltre" in str(res["lines"][0])   # 1:2 merged
    eq = client.get(f"/api/corpora/{es_c}/equivalents", params={"q": "contrato", "unit": "form", "min_freq": 1})
    assert eq.status_code == 200 and eq.json()["rows"]


def test_confirm_validation(client):
    es_c = make_corpus(client, "es", "ES")
    r = client.post(f"/api/corpora/{es_c}/align/confirm", json={"links": [{"src": ["a"], "tgt": []}],
                                                                 "partner_name": "IT"})
    assert r.status_code == 400
    r = client.post(f"/api/corpora/{es_c}/align/confirm",
                    json={"links": [{"src": ["El contrato es largo."], "tgt": ["Il contratto è lungo."]}]})
    assert r.status_code == 400 and "partner" in r.text.lower()
    r = client.post(f"/api/corpora/{es_c}/align/propose",
                    files=[("source", ("a.xyz", b"x", "x")), ("target", ("b.txt", b"hola", "x"))])
    assert r.status_code == 400


# --------------------------------------------------------------------------- speed
def synthetic_pair(words=10_000):
    """Spanish and Italian documents of about `words` words: paragraphs of sentences with some 1:2 links."""
    es_paras, it_paras = [], []
    n = k = 0
    while n < words:
        es_s, it_s = [], []
        for _ in range(5):
            k += 1
            a = f"El cliente número {k} firma el contrato de arrendamiento y paga la renta mensual al propietario."
            b = f"Il cliente numero {k} firma il contratto di locazione e paga il canone mensile al proprietario."
            if k % 7 == 0:
                b = f"Il cliente numero {k} firma il contratto di locazione. Paga il canone mensile al proprietario."
            es_s.append(a)
            it_s.append(b)
            n += len(a.split())
        es_paras.append(" ".join(es_s))
        it_paras.append(" ".join(it_s))
    return "\n".join(es_paras), "\n".join(it_paras)


@pytest.mark.parametrize("paragraphs", [True, False])
def test_ten_thousand_words_align_in_under_a_minute(paragraphs):
    es, it = synthetic_pair(10_000)
    if not paragraphs:
        es, it = es.replace("\n", " "), it.replace("\n", " ")
    align.propose("Hola.", "Ciao.", "es", "it")     # load the models outside the timing
    t0 = time.perf_counter()
    links = align.propose(es, it, "es", "it")
    elapsed = time.perf_counter() - t0
    print(f"aligned {len(es.split())} + {len(it.split())} words in {elapsed:.1f}s ({len(links)} links)")
    assert elapsed < 60
    assert sum(lk.type == "1:2" for lk in links) >= 60
    assert sum(lk.low for lk in links) / len(links) < 0.1
