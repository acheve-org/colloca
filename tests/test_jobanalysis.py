import io

import pytest
from docx import Document

from colloca import db, importer

from .test_api import default_project, make_corpus, wait_for_jobs
from .test_projects import doc, project
from .test_reference import fill_reference, make_reference

CLIENT = ("El contrato establece las obligaciones del arrendador. El arrendador debe respetar el plazo de entrega. "
          "La garantía del inquilino cubre los daños. El contrato incluye una cláusula de confidencialidad.")
JOB = ("El contrato fija el plazo de entrega y la garantía. El plazo de entrega es esencial. "
       "La hipoteca del inmueble vence pronto. La hipoteca requiere notario.")
BASE_SENTENCES = [
    "El gobierno anunció nuevas medidas para la economía del país.",
    "La casa de mi abuela tiene un jardín muy grande y bonito.",
    "Los niños juegan en el parque cada tarde después de la escuela.",
    "Mañana vamos a visitar el museo de la ciudad con toda la familia.",
    "Ella dice que la comida del restaurante estaba muy buena anoche.",
    "El equipo ganó el partido después de un juego muy largo y difícil.",
]


def analyse(client, cid, text=JOB, **params):
    r = client.post(f"/api/corpora/{cid}/analyse-job", params=params, data={"text": text})
    assert r.status_code == 202, r.text
    jid = r.json()["job_id"]
    job = next(j for j in wait_for_jobs(client, cid) if j["id"] == jid)
    return jid, job


def report(client, cid, text=JOB, **params):
    jid, job = analyse(client, cid, text, **params)
    assert job["status"] == "done", job
    return client.get(f"/api/jobs/{jid}/result").json()


def term(client, **fields):
    # terms default to the project of make_corpus(), as the report reads the termbase of the corpus's project
    body = {"src_lang": "es", "status": "approved", "project_id": default_project(client), **fields}
    assert client.post("/api/terms", json=body).status_code == 201, body


@pytest.fixture(autouse=True)
def _clean_terms(client):
    with db.session() as conn:
        conn.execute("DELETE FROM terms")


@pytest.fixture()
def corpus(client):
    cid = make_corpus(client, "es", "client")
    doc(client, cid, CLIENT, title="informe")
    return cid


# --------------------------------------------------------------------------- coverage and gaps
def test_gaps_and_coverage(client, corpus):
    rep = report(client, corpus, min_corpus_freq=2)
    s = rep["summary"]
    gaps = {g["item"]: g for g in rep["gaps"]}
    assert gaps["hipoteca"]["corpus_freq"] == 0 and gaps["hipoteca"]["job_freq"] == 2
    assert {"inmueble", "notario"} <= set(gaps)
    assert gaps["plazo"]["corpus_freq"] == 1                      # thin evidence: seen once, below the threshold of 2
    assert "contrato" not in gaps and "arrendador" not in gaps    # seen twice: covered
    first = [g["corpus_freq"] for g in rep["gaps"]]
    assert first == sorted(first)                                 # least evidence first
    uncovered = sum(g["job_freq"] for g in rep["gaps"])
    assert s["coverage_tokens_pct"] == round(100 * (s["content_words"] - uncovered) / s["content_words"], 1)
    assert s["uncovered_types"] == len(rep["gaps"]) and s["distinct_lemmas"] > s["uncovered_types"]
    seen = sum(g["job_freq"] for g in rep["gaps"] if g["corpus_freq"] == 0)
    assert s["coverage_seen_pct"] == round(100 * (s["content_words"] - seen) / s["content_words"], 1)
    assert s["coverage_seen_pct"] > s["coverage_tokens_pct"]
    assert s["words"] > s["content_words"] > 10 and s["sentences"] == 4 and s["corpus_words"] > 20


def test_nothing_is_stored(client, corpus):
    before = client.get(f"/api/corpora/{corpus}/documents").json()
    report(client, corpus)
    assert client.get(f"/api/corpora/{corpus}/documents").json() == before
    assert client.get(f"/api/corpora/{corpus}/frequency", params={"min_freq": 1}).json()
    assert "hipoteca" not in {r["item"] for r in client.get(f"/api/corpora/{corpus}/frequency",
                                                           params={"min_freq": 1}).json()}


def test_empty_corpus_has_no_coverage(client):
    cid = make_corpus(client, "es", "empty")
    s = report(client, cid)["summary"]
    assert s["coverage_tokens_pct"] == 0.0 and s["corpus_words"] == 0


def test_the_filter_narrows_the_corpus_used_as_evidence(client, corpus):
    doc(client, corpus, "Un texto sobre la hipoteca, la hipoteca y otra hipoteca más del inmueble del cliente.",
        title="hipotecas", tags="mortgage")
    wide = {g["item"] for g in report(client, corpus, min_corpus_freq=2)["gaps"]}
    narrow = report(client, corpus, min_corpus_freq=2, tags="mortgage")
    assert "hipoteca" not in wide                                 # covered by the whole corpus
    assert "hipoteca" not in {g["item"] for g in narrow["gaps"]} and "contrato" in {g["item"] for g in narrow["gaps"]}
    assert narrow["summary"]["corpus_filtered"] is True


# --------------------------------------------------------------------------- key terms
def test_key_terms_against_the_base_corpus(client, corpus):
    ref = make_reference(client)
    fill_reference(client, ref, BASE_SENTENCES)
    term(client, src_term="plazo", tgt_term="termine")                 # key terms and termbase together
    rep = report(client, corpus)
    assert rep["summary"]["reference"] == "base"
    keys = {k["item"]: k for k in rep["key_terms"]}
    assert {"hipoteca", "plazo", "entrega"} <= set(keys)
    assert all(k["job_freq"] >= 2 and k["ll"] > 0 for k in keys.values())
    assert "notario" not in keys                                  # appears once: below the minimum frequency
    assert [k["ll"] for k in rep["key_terms"]] == sorted((k["ll"] for k in rep["key_terms"]), reverse=True)
    assert keys["hipoteca"]["base_per_million"] == 0.0 and keys["plazo"]["corpus_freq"] == 1
    assert keys["plazo"]["termbase"] == "termine" and keys["hipoteca"]["termbase"] == ""
    assert report(client, corpus, min_freq=1)["key_terms"] != rep["key_terms"]


def test_without_a_base_corpus_key_terms_fall_back_to_frequency(client, corpus):
    rep = report(client, corpus)
    assert rep["summary"]["reference"] is None
    assert rep["key_terms"] and all(k["ll"] is None for k in rep["key_terms"])
    counts = [k["job_freq"] for k in rep["key_terms"]]
    assert counts == sorted(counts, reverse=True) and min(counts) >= 2


# --------------------------------------------------------------------------- termbase
def test_termbase_terms_found_in_the_text(client, corpus):
    term(client, src_term="contrato", tgt_term="contratto")
    term(client, src_term="contrato", tgt_term="accordo", status="forbidden")
    term(client, src_term="plazo de entrega", tgt_term="termine di consegna")
    term(client, src_term="hipoteca", tgt_term="", status="candidate")
    term(client, src_term="otra cosa", tgt_term="altra cosa")                   # not in the text
    rep = report(client, corpus)
    known = {k["item"]: k for k in rep["known_terms"]}
    assert set(known) == {"contrato", "plazo de entrega", "hipoteca"}
    assert known["plazo de entrega"]["occurrences"] == 2 and known["hipoteca"]["occurrences"] == 2
    assert known["contrato"]["occurrences"] == 1
    tr = {(t["term"], t["status"]) for t in known["contrato"]["translations"]}
    assert tr == {("contratto", "approved"), ("accordo", "forbidden")}
    assert known["plazo de entrega"]["example"].startswith("El contrato fija el plazo de entrega")
    assert rep["summary"]["termbase_terms_found"] == 3 and rep["summary"]["termbase_size"] == 5
    assert [k["occurrences"] for k in rep["known_terms"]] == sorted((k["occurrences"] for k in rep["known_terms"]),
                                                                     reverse=True)
    gaps = {g["item"]: g for g in rep["gaps"]}
    assert gaps["hipoteca"]["termbase"] == "(candidate)"


def test_termbase_is_scoped_to_the_corpus_project(client):
    pid = project(client)
    cid = client.post("/api/corpora", json={"name": "p", "lang": "es", "project_id": pid}).json()["id"]
    doc(client, cid, CLIENT, title="informe")
    term(client, src_term="contrato", tgt_term="contratto")                           # general termbase
    term(client, src_term="hipoteca", tgt_term="ipoteca", project_id=pid)
    assert {k["item"] for k in report(client, cid)["known_terms"]} == {"hipoteca"}


def test_terms_match_by_form_or_lemma(client, corpus):
    term(client, src_term="Plazos de entrega", tgt_term="termini")                  # inflected, capitalised
    term(client, src_term="hipotecas", tgt_term="ipoteche")
    items = {k["item"] for k in report(client, corpus)["known_terms"]}
    assert "hipotecas" in items                                                      # lemma match of "hipoteca"


def test_job_glossary_export_by_ids(client, corpus):
    term(client, src_term="contrato", tgt_term="contratto")
    term(client, src_term="contrato", tgt_term="accordo", status="forbidden")
    term(client, src_term="hipoteca", tgt_term="", status="candidate")
    term(client, src_term="ajeno", tgt_term="estraneo")
    ids = [i for k in report(client, corpus)["known_terms"] for i in k["ids"]]
    assert len(ids) == 3
    r = client.get("/api/terms/export", params={"format": "csv", "ids": ",".join(map(str, ids))})
    assert "contratto" in r.text and "accordo" in r.text and "hipoteca" in r.text and "ajeno" not in r.text
    default = client.get("/api/terms/export", params={"format": "csv"})
    assert "accordo" not in default.text                                            # normal export: approved only


# --------------------------------------------------------------------------- phrases
def test_repeated_phrases_with_corpus_frequency(client, corpus):
    phrases = {p["item"]: p for p in report(client, corpus)["phrases"]}
    assert phrases["plazo de entrega"]["job_freq"] == 2 and phrases["plazo de entrega"]["corpus_freq"] == 1
    assert "plazo de" not in phrases and "de entrega" not in phrases                # no stopword at the edges


def test_phrases_inside_longer_repeats_are_dropped(client, corpus):
    text = "El contrato de alquiler vigente es claro. Revisar el contrato de alquiler vigente hoy."
    phrases = [p["item"] for p in report(client, corpus, text)["phrases"]]
    assert phrases == ["contrato de alquiler vigente"]


# --------------------------------------------------------------------------- inputs & errors
def test_file_inputs(client, corpus):
    r = client.post(f"/api/corpora/{corpus}/analyse-job", files={"file": ("trabajo.txt", JOB.encode(), "text/plain")})
    assert r.status_code == 202
    assert wait_for_jobs(client, corpus)[-1]["status"] == "done"
    d = Document()
    for sentence in JOB.split(". "):
        d.add_paragraph(sentence)
    buf = io.BytesIO()
    d.save(buf)
    r = client.post(f"/api/corpora/{corpus}/analyse-job",
                    files={"file": ("trabajo.docx", buf.getvalue(), "application/octet-stream")})
    jid = r.json()["job_id"]
    job = next(j for j in wait_for_jobs(client, corpus) if j["id"] == jid)
    assert job["status"] == "done" and job["label"] == "trabajo.docx"
    assert "hipoteca" in {g["item"] for g in client.get(f"/api/jobs/{jid}/result").json()["gaps"]}


def test_input_validation(client, corpus):
    assert client.post(f"/api/corpora/{corpus}/analyse-job").status_code == 400
    assert client.post(f"/api/corpora/{corpus}/analyse-job", data={"text": "   "}).status_code == 400
    assert client.post("/api/corpora/99999/analyse-job", data={"text": JOB}).status_code == 404
    ref = make_reference(client)
    assert client.post(f"/api/corpora/{ref}/analyse-job", data={"text": JOB}).status_code == 400
    _, job = analyse(client, corpus, "Corto.")
    assert job["status"] == "error" and "too short" in job["error"]
    _, job = analyse(client, corpus, "Il traduttore consulta il corpus per scegliere la terminologia corretta. "
                                     "La terminologia tecnica deve essere coerente in tutti i documenti.")
    assert job["status"] == "error" and job["code"] == "language_mismatch"
    _, forced = analyse(client, corpus, "Il traduttore consulta il corpus per scegliere la terminologia corretta. "
                                        "La terminologia tecnica deve essere coerente in tutti i documenti.",
                        force_language=True)
    assert forced["status"] == "done"


# --------------------------------------------------------------------------- results
def test_results_are_kept_out_of_job_lists_and_downloadable(client, corpus):
    term(client, src_term="contrato", tgt_term="contratto")
    jid, job = analyse(client, corpus)
    assert "key_terms" not in job and "payload" not in job and job["result"]["summary"]["words"] > 10
    listed = client.get(f"/api/corpora/{corpus}/jobs").json()
    assert all("gaps" not in j and "payload" not in j for j in listed)
    csv_r = client.get(f"/api/jobs/{jid}/result", params={"section": "gaps", "format": "csv"})
    assert csv_r.text.lstrip("﻿").splitlines()[0] == "item,pos,job_freq,corpus_freq,termbase"
    known = client.get(f"/api/jobs/{jid}/result", params={"section": "known_terms", "format": "csv"})
    assert "contratto [approved]" in known.text
    assert client.get(f"/api/jobs/{jid}/result", params={"section": "nope"}).status_code == 400
    assert client.get("/api/jobs/999999/result").status_code == 404
    _, failed = analyse(client, corpus, "Corto.")
    assert client.get(f"/api/jobs/{failed['id']}/result").status_code == 409


def test_job_is_a_plain_import_job_kind(client, corpus):
    _, job = analyse(client, corpus)
    assert job["kind"] == "analysis" and job["progress"] == 1.0 and importer.get_job(job["id"]).payload
