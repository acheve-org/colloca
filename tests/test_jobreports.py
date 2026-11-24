"""Saved job reports (T11): save, reopen after a restart, one workbook, text kept only on request."""
import io
import json

import pytest
from openpyxl import load_workbook

from colloca import db, importer

from .test_api import make_corpus
from .test_jobanalysis import CLIENT, JOB, analyse, term
from .test_projects import doc


@pytest.fixture(autouse=True)
def _clean(client):
    with db.session() as conn:
        conn.execute("DELETE FROM terms")
        conn.execute("DELETE FROM job_reports")


@pytest.fixture()
def corpus(client):
    cid = make_corpus(client, "es", "informes")
    doc(client, cid, CLIENT, title="informe")
    return cid


def save(client, jid, **body):
    return client.post(f"/api/jobs/{jid}/save", json=body)


def test_save_list_reopen_delete(client, corpus):
    jid, _ = analyse(client, corpus, min_corpus_freq=2)
    live = client.get(f"/api/jobs/{jid}/result").json()
    r = save(client, jid, title="Contrato Acme")
    assert r.status_code == 200 and r.json()["saved_before"] is False
    rid = r.json()["id"]

    listed = client.get(f"/api/corpora/{corpus}/reports").json()
    assert [x["id"] for x in listed] == [rid] and listed[0]["title"] == "Contrato Acme"
    assert listed[0]["words"] == live["summary"]["words"] and listed[0]["has_text"] is False
    assert listed[0]["params"]["min_corpus_freq"] == 2

    back = client.get(f"/api/reports/{rid}/result").json()
    assert back["summary"] == live["summary"]
    assert [g["item"] for g in back["gaps"]] == [g["item"] for g in live["gaps"]]
    assert back["title"] == "Contrato Acme" and back["report_id"] == rid and back["has_text"] is False

    assert client.delete(f"/api/reports/{rid}").status_code == 204
    assert client.get(f"/api/reports/{rid}/result").status_code == 404
    assert client.get(f"/api/corpora/{corpus}/reports").json() == []
    assert client.delete(f"/api/reports/{rid}").status_code == 404


def test_a_saved_report_survives_a_restart(client, corpus):
    jid, _ = analyse(client, corpus)
    rid = save(client, jid).json()["id"]
    importer._jobs.clear()                    # the server restarts: the in-memory job is gone
    assert client.get(f"/api/jobs/{jid}/result").status_code == 404
    again = client.get(f"/api/reports/{rid}/result")
    assert again.status_code == 200 and again.json()["summary"]["words"] > 0
    assert client.get(f"/api/corpora/{corpus}/reports").json()[0]["source"] == ""    # pasted text


def test_saving_twice_returns_the_same_report(client, corpus):
    jid, _ = analyse(client, corpus)
    first = save(client, jid).json()
    second = save(client, jid, title="other").json()
    assert second == {"id": first["id"], "saved_before": True}
    assert len(client.get(f"/api/corpora/{corpus}/reports").json()) == 1


def test_default_title_names_the_source(client, corpus):
    jid, _ = analyse(client, corpus)
    rid = save(client, jid).json()["id"]
    assert client.get(f"/api/corpora/{corpus}/reports").json()[0]["title"].startswith("Pasted text ·")
    assert rid


def test_the_text_is_not_stored_unless_asked(client, corpus):
    jid, _ = analyse(client, corpus)
    rid = save(client, jid).json()["id"]
    assert client.get(f"/api/reports/{rid}/text").status_code == 404
    with db.session() as conn:
        assert conn.execute("SELECT text FROM job_reports WHERE id=?", (rid,)).fetchone()[0] is None
        assert JOB[:30] not in conn.execute("SELECT payload FROM job_reports WHERE id=?", (rid,)).fetchone()[0]


def test_keeping_the_text_and_deleting_it_with_the_report(client, corpus):
    jid, _ = analyse(client, corpus, keep_text="true")
    rid = save(client, jid).json()["id"]
    assert client.get(f"/api/corpora/{corpus}/reports").json()[0]["has_text"] is True
    got = client.get(f"/api/reports/{rid}/text").json()
    assert got["lang"] == "es" and got["text"].startswith("El contrato fija el plazo")
    assert client.delete(f"/api/reports/{rid}").status_code == 204
    with db.session() as conn:
        assert conn.execute("SELECT COUNT(*) FROM job_reports").fetchone()[0] == 0     # the text went with it
    assert client.get(f"/api/reports/{rid}/text").status_code == 404


def test_deleting_the_corpus_for_good_deletes_its_reports(client, corpus):
    jid, _ = analyse(client, corpus, keep_text="true")
    save(client, jid)
    with db.session() as conn:
        conn.execute("DELETE FROM corpora WHERE id=?", (corpus,))
        assert conn.execute("SELECT COUNT(*) FROM job_reports").fetchone()[0] == 0


def test_a_report_of_a_trashed_corpus_is_hidden(client, corpus):
    jid, _ = analyse(client, corpus)
    rid = save(client, jid).json()["id"]
    assert client.delete(f"/api/corpora/{corpus}").status_code in (200, 204)
    assert client.get(f"/api/reports/{rid}/result").status_code == 404


def test_save_needs_a_finished_job(client, corpus):
    assert save(client, 987654).status_code == 404


def test_whole_report_as_one_workbook(client, corpus):
    term(client, src_term="contrato", tgt_term="contratto")
    term(client, src_term="contrato", tgt_term="accordo", status="forbidden")
    jid, _ = analyse(client, corpus, min_corpus_freq=2)
    r = client.get(f"/api/jobs/{jid}/result", params={"format": "xlsx"})
    assert r.status_code == 200 and "spreadsheetml" in r.headers["content-type"]
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Summary", "Termbase terms", "Gaps", "Key terms", "Phrases"]
    live = client.get(f"/api/jobs/{jid}/result").json()
    summary = {row[0].value: row[1].value for row in wb["Summary"].iter_rows(min_row=4)}
    assert summary["Words in the text"] == live["summary"]["words"]
    assert wb["Gaps"].max_row == 1 + len(live["gaps"])
    known = {row[0].value: row for row in wb["Termbase terms"].iter_rows(min_row=2)}
    assert "contratto [approved]" in known["contrato"][3].value and "accordo [forbidden]" in known["contrato"][3].value

    rid = save(client, jid).json()["id"]
    again = client.get(f"/api/reports/{rid}/result", params={"format": "xlsx"})
    assert load_workbook(io.BytesIO(again.content)).sheetnames == wb.sheetnames


def test_workbook_cells_are_text_never_formulas(client, corpus):
    term(client, src_term="contrato", tgt_term="=1+1")
    jid, _ = analyse(client, corpus)
    wb = load_workbook(io.BytesIO(client.get(f"/api/jobs/{jid}/result", params={"format": "xlsx"}).content))
    cells = [c for ws in wb for row in ws.iter_rows() for c in row if isinstance(c.value, str)]
    assert any("=1+1" in c.value for c in cells)
    assert all(c.data_type == "s" for c in cells)


def test_sections_still_download_as_csv_from_a_saved_report(client, corpus):
    jid, _ = analyse(client, corpus, min_corpus_freq=2)
    rid = save(client, jid).json()["id"]
    live = client.get(f"/api/jobs/{jid}/result", params={"section": "gaps", "format": "csv"}).text
    kept = client.get(f"/api/reports/{rid}/result", params={"section": "gaps", "format": "csv"}).text
    assert kept == live and kept.startswith("﻿item")
    assert client.get(f"/api/reports/{rid}/result", params={"section": "nope"}).status_code == 400


def test_table_flags_are_as_of_now_not_as_saved(client, corpus):
    jid, _ = analyse(client, corpus, min_corpus_freq=2)
    rid = save(client, jid).json()["id"]
    gap = client.get(f"/api/reports/{rid}/result").json()["gaps"][0]["item"]
    assert not client.get(f"/api/reports/{rid}/result").json()["gaps"][0]["in_termbase"]
    term(client, src_term=gap, tgt_term="x")
    assert next(g for g in client.get(f"/api/reports/{rid}/result").json()["gaps"] if g["item"] == gap)["in_termbase"]


def test_payload_is_stored_as_json(client, corpus):
    jid, _ = analyse(client, corpus)
    rid = save(client, jid).json()["id"]
    with db.session() as conn:
        raw = conn.execute("SELECT payload FROM job_reports WHERE id=?", (rid,)).fetchone()[0]
    assert set(json.loads(raw)) >= {"summary", "gaps", "key_terms", "known_terms", "phrases"}
