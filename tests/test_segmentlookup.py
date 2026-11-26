"""Segment lookup with match percentages (T18)."""
# ruff: noqa: E501
import pytest

from corpora import db
from corpora import segmentlookup as sl

from .test_api import make_corpus, wait_for_jobs
from .test_parallel import import_tmx, tmx

MEMORY = [
    ("El arrendador debe entregar las llaves al inquilino el primer día del mes.",
     "Il locatore deve consegnare le chiavi al conduttore il primo giorno del mese."),
    ("El arrendador debe entregar las llaves al inquilino el primer día de cada mes.",
     "Il locatore deve consegnare le chiavi al conduttore il primo giorno di ogni mese."),
    ("El plazo de entrega es de 30 días desde la firma del contrato.",
     "Il termine di consegna è di 30 giorni dalla firma del contratto."),
    ("La garantía cubre los daños causados por el uso normal de la vivienda.",
     "La garanzia copre i danni causati dal normale uso dell'abitazione."),
    ("El contrato termina hoy.", "Il contratto termina oggi."),
    ("Hoy es lunes.", "Oggi è lunedì."),
]


@pytest.fixture()
def cid(client):
    es, it = make_corpus(client, "es", "memoria"), make_corpus(client, "it", "memoria it")
    import_tmx(client, es, tmx(MEMORY), partner_corpus_id=it)
    assert wait_for_jobs(client, es)[0]["status"] == "done"
    return es


def look(client, cid, text, **kw):
    r = client.post(f"/api/corpora/{cid}/segment-lookup", json={"text": text, **kw})
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------- the measure
def test_percent_is_100_only_for_identical_words():
    a = ["el", "contrato", "termina", "hoy"]
    assert sl.percent(a, a) == 100
    assert sl.percent(a, ["el", "contrato", "termina", "mañana"]) == 75
    assert sl.percent(a, ["el", "contrato", "termina"]) == 75
    assert sl.percent(a, ["el", "contrato", "termina", "hoy", "mismo"]) == 80
    assert sl.percent(a, ["x", "y", "z"]) == 0
    assert 0 < sl.percent(["a"] * 99 + ["b"], ["a"] * 100) < 100          # 99%: never rounded up to 100
    assert sl.percent([], a) == 0 and sl.percent([], []) == 0


def test_percent_stops_early_below_the_floor_and_is_symmetric():
    a, b = ["uno", "dos", "tres", "cuatro", "cinco"], ["uno", "dos", "tres", "seis", "siete"]
    assert sl.percent(a, b) == sl.percent(b, a) == 60
    assert sl.percent(a, b, floor=80) == 0                                # below what was asked for
    assert sl.percent(a, a, floor=100) == 100


def test_bands():
    assert [sl.band(p) for p in (100, 99, 95, 94, 85, 84, 75, 74, 0)] == [
        "100", "95-99", "95-99", "85-94", "85-94", "75-84", "75-84", "below75", "below75"]


def test_tags_and_placeholders_are_not_words():
    assert sl.clean_query("Pulse <b>aquí</b> {1} para %s seguir [2].") == "Pulse aquí para seguir ."


# --------------------------------------------------------------------------- lookups
def test_exact_match_is_100_with_its_translation(client, cid):
    res = look(client, cid, "El contrato termina hoy.")
    top = res["matches"][0]
    assert top["percent"] == 100 and top["band"] == "100" and top["exact"] is True
    assert top["source"] == "El contrato termina hoy." and top["target"] == "Il contratto termina oggi."
    assert [d["kind"] for d in top["diff"]] == ["same"] * len(top["diff"])


def test_case_and_punctuation_do_not_change_the_words(client, cid):
    top = look(client, cid, "el contrato TERMINA hoy")["matches"][0]
    assert top["percent"] == 100 and top["exact"] is False                # same words, different writing


def test_fuzzy_matches_are_ranked_and_show_what_differs(client, cid):
    res = look(client, cid, "El arrendador debe entregar las llaves al inquilino el primer día del año.")
    pcts = [m["percent"] for m in res["matches"]]
    assert pcts == sorted(pcts, reverse=True) and pcts[0] >= 90
    best = res["matches"][0]
    assert best["source"].endswith("del mes.") and best["target"].endswith("del mese.")
    extra = [d["text"] for d in best["diff"] if d["kind"] == "extra"]
    missing = [d["text"] for d in best["diff"] if d["kind"] == "missing"]
    assert extra == ["mes"] and missing == ["año"]
    # the shown words still read as the stored segment, plus the missing ones in place
    assert "".join(d["text"] for d in best["diff"] if d["kind"] != "missing").replace(" ", "")[:20] == "Elarrendadordebeentr"


def test_words_missing_from_the_query_are_marked(client, cid):
    res = look(client, cid, "El arrendador debe entregar las llaves.", min_percent=40)
    best = res["matches"][0]
    extras = [d["text"] for d in best["diff"] if d["kind"] == "extra"]
    assert extras[:3] == ["al", "inquilino", "el"] and best["percent"] < 100
    assert not [d for d in best["diff"] if d["kind"] == "missing"]
    # and the other way round: words the stored segment lacks are the query's `missing` ones
    longer = look(client, cid, "El contrato termina hoy mismo sin falta.", min_percent=40)["matches"][0]
    assert [d["text"] for d in longer["diff"] if d["kind"] == "missing"] == ["mismo", "sin", "falta"]
    assert not [d for d in longer["diff"] if d["kind"] == "extra"]


def test_numbers_are_words_but_flagged_when_they_are_the_only_difference(client, cid):
    res = look(client, cid, "El plazo de entrega es de 45 días desde la firma del contrato.")
    top = res["matches"][0]
    assert top["only_numbers_differ"] is True and top["numbers_differ"] is True
    assert 85 <= top["percent"] < 100
    other = look(client, cid, "El plazo de entrega es de 30 días desde la firma del contrato.")["matches"][0]
    assert other["numbers_differ"] is False and other["percent"] == 100


def test_nothing_similar_gives_no_matches_and_the_threshold_works(client, cid):
    assert look(client, cid, "Una frase que no se parece a nada de lo guardado aquí.")["matches"] == []
    loose = look(client, cid, "El contrato termina mañana por la tarde.", min_percent=30)["matches"]
    strict = look(client, cid, "El contrato termina mañana por la tarde.", min_percent=90)["matches"]
    assert loose and not strict


def test_limit_and_duplicates(client, cid):
    res = look(client, cid, "El arrendador debe entregar las llaves al inquilino el primer día.", limit=1)
    assert len(res["matches"]) == 1 and res["found"] >= 2


def test_only_the_source_side_of_this_corpus_is_searched(client, cid):
    it = client.get("/api/corpora").json()
    it_id = next(c["id"] for c in it if c["name"] == "memoria it")
    res = look(client, it_id, "Il contratto termina oggi.")
    assert res["matches"][0]["target"] == "El contrato termina hoy."      # from Italian to Spanish
    assert look(client, cid, "Il contratto termina oggi.")["matches"] == []


def test_tags_in_the_query_are_ignored(client, cid):
    top = look(client, cid, "El <b>contrato</b> {1} termina hoy.")["matches"][0]
    assert top["percent"] == 100


def test_documents_in_the_trash_and_unaligned_text_are_not_searched(client, cid):
    plain = make_corpus(client, "es", "sin alinear")
    client.post(f"/api/corpora/{plain}/documents", json={"title": "x", "text": "El contrato termina hoy. Hoy es lunes."})
    assert look(client, plain, "El contrato termina hoy.")["matches"] == []
    doc = client.get(f"/api/corpora/{cid}/documents").json()[0]
    client.delete(f"/api/documents/{doc['id']}")
    assert look(client, cid, "El contrato termina hoy.")["matches"] == []


def test_scope_filters_apply(client, cid):
    assert look(client, cid, "El contrato termina hoy.")["matches"]
    r = client.post(f"/api/corpora/{cid}/segment-lookup", params={"tags": "no-such-tag"},
                    json={"text": "El contrato termina hoy."})
    assert r.status_code == 200 and r.json()["matches"] == []


def test_input_validation(client, cid):
    url = f"/api/corpora/{cid}/segment-lookup"
    assert client.post(url, json={"text": "   "}).status_code == 400
    assert client.post(url, json={"text": "... ,,, !!!"}).status_code == 400            # no words
    assert client.post(url, json={"text": "a" * 2500}).status_code == 400
    assert client.post(url, json={"text": "a" * 5000}).status_code == 422
    assert client.post(url, json={"text": "hola", "min_percent": 5}).status_code == 422
    assert client.post("/api/corpora/99999/segment-lookup", json={"text": "hola"}).status_code == 404


def test_candidates_come_from_the_index_not_a_full_scan(client, cid):
    with db.session() as conn:
        plan = conn.execute("""EXPLAIN QUERY PLAN SELECT t.doc_id FROM tokens t WHERE t.norm IN ('contrato','hoy')""").fetchall()
    assert any("idx_tokens_norm" in str(tuple(r)) for r in plan)


# --------------------------------------------------------------------------- leverage
def test_leverage_counts_each_sentence_by_its_best_band(client, cid):
    with db.session() as conn:
        res = sl.leverage(conn, sl.analysis.Scope(cid), "es", [
            "El contrato termina hoy.",                                         # 100
            "El plazo de entrega es de 45 días desde la firma del contrato.",   # fuzzy
            "Una frase nueva que no está en la memoria de ninguna manera.",     # none
        ])
    assert res["segments"] == 3 and res["bands"]["100"]["segments"] == 1
    assert res["bands"]["below75"]["segments"] == 1
    fuzzy = sum(res["bands"][b]["segments"] for b in ("95-99", "85-94", "75-84"))
    assert fuzzy == 1
    assert 0 < res["covered_pct"] < 100 and res["words"] == sum(b["words"] for b in res["bands"].values())


# --------------------------------------------------------------------------- in the job report
def analyse_job(client, cid, text, **params):
    r = client.post(f"/api/corpora/{cid}/analyse-job", params=params, data={"text": text})
    assert r.status_code == 202, r.text
    job = next(j for j in wait_for_jobs(client, cid) if j["id"] == r.json()["job_id"])
    assert job["status"] == "done", job
    return client.get(f"/api/jobs/{job['id']}/result").json()


JOB_TEXT = ("El contrato termina hoy. El plazo de entrega es de 45 días desde la firma del contrato. "
            "Una frase nueva que no está en la memoria de ninguna manera.")


def test_job_report_has_no_leverage_unless_asked(client, cid):
    assert analyse_job(client, cid, JOB_TEXT)["summary"]["leverage"] is None


def test_job_report_leverage_from_the_aligned_documents(client, cid):
    lev = analyse_job(client, cid, JOB_TEXT, leverage="true")["summary"]["leverage"]
    assert lev["segments"] == 3 and lev["bands"]["100"]["segments"] == 1 and lev["bands"]["below75"]["segments"] == 1
    assert 0 < lev["covered_pct"] < 100 and lev["truncated"] is False


def test_leverage_needs_aligned_documents(client):
    plain = make_corpus(client, "es", "sin memoria")
    client.post(f"/api/corpora/{plain}/documents", json={"title": "x", "text": "El contrato termina hoy. Hoy es lunes."})
    assert analyse_job(client, plain, JOB_TEXT, leverage="true")["summary"]["leverage"] is None


def test_the_diff_keeps_the_spacing_of_the_stored_segment(client, cid):
    best = look(client, cid, "El contrato termina hoy.")["matches"][0]
    written = "".join(d["text"] + (" " if d["sp"] else "") for d in best["diff"]).strip()
    assert written == best["source"]
