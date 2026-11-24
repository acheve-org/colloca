"""Glossary import. No real CAT-tool files exist yet: every fixture is built from Colloca's own export
(termexport) or from docs/samples, so these tests prove the round trip, not compatibility with any CAT tool."""
import io
import json
import time
from pathlib import Path

import pytest
from openpyxl import Workbook

from colloca import db

from .test_projects import project

SAMPLES = Path(__file__).parent.parent / "docs" / "samples"
FIELDS = ("src_lang", "tgt_lang", "src_term", "tgt_term", "pos", "status", "domain", "definition", "notes", "context")
MAPPING = {"src_term": 0, "tgt_term": 1, "src_lang": 2, "tgt_lang": 3, "pos": 4, "status": 5, "domain": 6,
           "definition": 7, "notes": 8, "context": 9}

ENTRIES = [
    dict(src_term="contrato", tgt_term="contratto", pos="noun", status="approved", domain="legal",
         definition="Acuerdo entre partes", notes="siempre", context="El contrato establece las reglas."),
    dict(src_term="contrato", tgt_term="accordo", pos="noun", status="forbidden", domain="legal",
         definition="Acuerdo entre partes", context="El contrato establece las reglas."),
    dict(src_term="demanda", tgt_term="causa", pos="noun", status="admitted"),
    dict(src_term="Rescindir", tgt_term="risolvere", pos="verb", status="superseded"),
    dict(src_term="cláusula", tgt_term="", status="candidate"),
    dict(src_term="=cmd", tgt_term="clausola", status="candidate"),
]


@pytest.fixture(autouse=True)
def _clean_terms(client):
    with db.session() as conn:
        conn.execute("DELETE FROM terms")


def seed(client, pid, entries=ENTRIES):
    for e in entries:
        r = client.post("/api/terms", json={"src_lang": "es", "tgt_lang": "it", "project_id": pid, **e})
        assert r.status_code == 201, r.text


def entries_of(client, pid):
    rows = client.get("/api/terms", params={"project": str(pid)}).json()
    return sorted(tuple(r[f] for f in FIELDS) for r in rows)


def do_import(client, name, data, *, dry_run=False, **form):
    form = {"dry_run": str(dry_run).lower(), **{k: v if isinstance(v, str) else json.dumps(v)
                                                 for k, v in form.items()}}
    return client.post("/api/terms/import", files={"file": (name, data)}, data=form)


# --------------------------------------------------------------------------- round trips
@pytest.mark.parametrize("fmt", ["tbx", "tbx2"])
def test_tbx_round_trip(client, fmt):
    a, b = project(client), project(client)
    seed(client, a)
    data = client.get("/api/terms/export", params={"format": fmt, "project": str(a), "status": ",".join(
        ["candidate", "approved", "admitted", "superseded", "forbidden"])}).content
    r = do_import(client, "termbase.tbx", data, project_id=str(b))
    assert r.status_code == 200, r.text
    assert r.json()["to_add"] == len(ENTRIES) and r.json()["rejected"] == 0
    assert entries_of(client, b) == entries_of(client, a)


@pytest.mark.parametrize("fmt", ["xlsx", "csv"])
def test_spreadsheet_round_trip(client, fmt):
    a, b = project(client), project(client)
    seed(client, a)
    name = f"termbase.{fmt}"
    data = client.get("/api/terms/export", params={"format": fmt, "project": str(a), "status": ",".join(
        ["candidate", "approved", "admitted", "superseded", "forbidden"])}).content
    pre = client.post("/api/terms/import/preview", files={"file": (name, data)}).json()
    assert pre["kind"] == "sheet" and pre["header"] is True and pre["mapping"] == MAPPING
    r = do_import(client, name, data, project_id=str(b), src_lang="es", tgt_lang="it", mapping=pre["mapping"])
    assert r.status_code == 200, r.text
    assert r.json()["to_add"] == len(ENTRIES)
    assert entries_of(client, b) == entries_of(client, a)


def test_sample_files_import(client):
    for sample in ("termbase-sample.tbx", "termbase-sample-tbx2.tbx"):
        pid = project(client)
        r = do_import(client, sample, (SAMPLES / sample).read_bytes(), project_id=str(pid))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["to_add"] > 5 and body["rejected"] == 0 and (body["src_lang"], body["tgt_lang"]) == ("es", "it")


# --------------------------------------------------------------------------- dry run and duplicate report
def csv_bytes(*lines):
    return ("\n".join(lines) + "\n").encode()


def test_dry_run_stores_nothing_and_reports_duplicates_and_rejections(client):
    pid = project(client)
    seed(client, pid, [dict(src_term="contrato", tgt_term="contratto", status="approved")])
    data = csv_bytes("Source;Translation;Status",
                     "Contrato;CONTRATTO;approved",       # duplicate of the termbase, case-insensitive
                     "demanda;causa;",                     # new, no status -> candidate
                     "demanda;Causa;admitted",             # repeated in the file
                     "juicio;;approved",                   # approved without a translation
                     ";x;",                                # no source term
                     "pleito;lite;maybe",                  # unknown status
                     "fallo;sentenza;approved")
    args = dict(project_id=str(pid), src_lang="es", tgt_lang="it", mapping={"src_term": 0, "tgt_term": 1, "status": 2})
    dry = do_import(client, "g.csv", data, dry_run=True, **args).json()
    assert (dry["to_add"], dry["duplicates"], dry["rejected"], dry["total"], dry["applied"]) == (2, 2, 3, 7, False)
    assert [(x["row"], x["src_term"]) for x in dry["duplicate_rows"]] == [(2, "Contrato"), (4, "demanda")]
    reasons = {x["row"]: x["reason"] for x in dry["rejected_rows"]}
    assert "needs a translation" in reasons[5] and "source term is required" in reasons[6]
    assert "Unknown status" in reasons[7]
    assert len(client.get("/api/terms", params={"project": str(pid)}).json()) == 1      # nothing stored
    done = do_import(client, "g.csv", data, **args).json()
    assert done["applied"] and done["to_add"] == 2
    rows = {r["src_term"]: r for r in client.get("/api/terms", params={"project": str(pid)}).json()}
    assert rows["demanda"]["status"] == "candidate" and rows["fallo"]["status"] == "approved"
    # importing the same file again adds nothing
    again = do_import(client, "g.csv", data, **args).json()
    assert again["to_add"] == 0 and again["duplicates"] == 4


def test_header_off_tsv_and_default_status(client):
    pid = project(client)
    data = b"contrato\tcontratto\nnotario\tnotaio\n"
    r = do_import(client, "g.tsv", data, project_id=str(pid), src_lang="es", tgt_lang="it", header=False,
                  mapping={"src_term": 0, "tgt_term": 1}, default_status="approved")
    assert r.json()["to_add"] == 2
    assert {x["status"] for x in client.get("/api/terms", params={"project": str(pid)}).json()} == {"approved"}


def test_xlsx_mapping_of_arbitrary_columns(client):
    wb = Workbook()
    ws = wb.active
    ws.append(["id", "IT", "ES", "remarks"])
    ws.append([1, "contratto", "contrato", "ok"])
    out = io.BytesIO()
    wb.save(out)
    pid = project(client)
    r = do_import(client, "g.xlsx", out.getvalue(), project_id=str(pid), src_lang="es", tgt_lang="it",
                  mapping={"src_term": 2, "tgt_term": 1, "notes": 3})
    assert r.json()["to_add"] == 1
    row = client.get("/api/terms", params={"project": str(pid)}).json()[0]
    assert (row["src_term"], row["tgt_term"], row["notes"]) == ("contrato", "contratto", "ok")


def test_row_language_columns_and_bad_language(client):
    pid = project(client)
    data = csv_bytes("a,b,c", "contrato,contratto,es", "xx,yy,zz")
    r = do_import(client, "g.csv", data, project_id=str(pid), src_lang="it", tgt_lang="es",
                  mapping={"src_term": 0, "tgt_term": 1, "src_lang": 2}).json()
    assert r["to_add"] == 0 and r["rejected"] == 2      # es->es refused, zz unsupported
    assert do_import(client, "g.csv", data, src_lang="es", tgt_lang="es", mapping={"src_term": 0}).status_code == 400


def test_unmapped_source_unknown_project_and_bad_files(client):
    data = csv_bytes("a,b", "x,y")
    assert do_import(client, "g.csv", data, src_lang="es", mapping={"tgt_term": 1}).status_code == 400
    assert do_import(client, "g.csv", data, src_lang="es", mapping={"src_term": 0},
                     project_id="99999").status_code == 404
    assert do_import(client, "g.pdf", b"x").status_code == 400
    assert do_import(client, "g.xlsx", b"not a workbook", src_lang="es", mapping={"src_term": 0}).status_code == 400
    assert do_import(client, "g.tbx", b"<html/>").status_code == 400
    assert do_import(client, "g.tbx", b"<tbx><oops").status_code == 400
    assert do_import(client, "g.csv", b"").status_code == 400


# --------------------------------------------------------------------------- TBX details
TBX3 = """<?xml version="1.0" encoding="UTF-8"?>
<tbx xmlns="urn:iso:std:iso:30042:ed-2" style="dca" type="TBX-Basic" xml:lang="it">
 <tbxHeader><fileDesc><sourceDesc><p>x</p></sourceDesc></fileDesc></tbxHeader>
 <text><body>
  <conceptEntry id="a">
   <descrip type="subjectField">legal</descrip>
   <langSec xml:lang="it"><termSec><term>contratto</term>
    <termNote type="partOfSpeech">noun</termNote></termSec></langSec>
   <langSec xml:lang="es">
    <termSec><term>contrato</term><termNote type="administrativeStatus">preferredTerm-admn-sts</termNote></termSec>
    <termSec><term>pacto</term><termNote type="administrativeStatus">admittedTerm-admn-sts</termNote></termSec>
    <termSec><term>trato</term><termNote type="administrativeStatus">deprecatedTerm-admn-sts</termNote></termSec>
    <termSec><term>convenio</term><termNote type="partOfSpeech">pronoun</termNote></termSec>
   </langSec>
  </conceptEntry>
  <conceptEntry id="b"><langSec xml:lang="es"><termSec><term>solo</term></termSec></langSec></conceptEntry>
  <conceptEntry id="c"><langSec xml:lang="es"><termSec><term>vacío</term></termSec></langSec></conceptEntry>
 </body></text>
</tbx>"""


def test_tbx_2019_statuses_several_terms_and_pair_detection(client):
    pid = project(client)
    r = do_import(client, "x.tbx", TBX3.encode(), project_id=str(pid), src_lang="it", tgt_lang="es")
    assert r.status_code == 200, r.text
    rows = {x["tgt_term"]: x for x in client.get("/api/terms", params={"project": str(pid)}).json()}
    assert {k: v["status"] for k, v in rows.items()} == {
        "contrato": "approved", "pacto": "admitted", "trato": "forbidden", "convenio": "candidate"}
    assert rows["convenio"]["pos"] == "other" and rows["contrato"]["domain"] == "legal"
    # entries b and c have no Italian term: rejected, not silently dropped
    assert r.json()["rejected"] == 2 and r.json()["to_add"] == 4
    # without a chosen pair the root xml:lang (it) is the source
    auto = do_import(client, "x.tbx", TBX3.encode(), dry_run=True).json()
    assert (auto["src_lang"], auto["tgt_lang"]) == ("it", "es")


def test_tbx_entity_bomb_and_external_entity_refused(client):
    bomb = ('<?xml version="1.0"?><!DOCTYPE tbx [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">'
            '<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;">]>'
            "<tbx><text><body><conceptEntry><langSec xml:lang=\"es\"><termSec><term>&d;</term></termSec>"
            "</langSec></conceptEntry></body></text></tbx>")
    r = do_import(client, "bomb.tbx", bomb.encode(), dry_run=True)
    assert r.status_code == 400 and "entities" in r.json()["detail"]
    xxe = ('<?xml version="1.0"?><!DOCTYPE tbx [<!ENTITY x SYSTEM "file:///etc/passwd">]><tbx><text><body>'
           '<conceptEntry><langSec xml:lang="es"><termSec><term>&x;</term></termSec></langSec></conceptEntry>'
           "</body></text></tbx>")
    assert do_import(client, "xxe.tbx", xxe.encode(), dry_run=True).status_code == 400


def test_five_thousand_rows_in_seconds(client):
    pid = project(client)
    lines = ["Source,Translation"] + [f"término{n},termine{n}" for n in range(5000)]
    started = time.perf_counter()
    r = do_import(client, "big.csv", csv_bytes(*lines), project_id=str(pid), src_lang="es", tgt_lang="it",
                  mapping={"src_term": 0, "tgt_term": 1})
    assert r.json()["to_add"] == 5000
    assert time.perf_counter() - started < 5
    assert len(client.get("/api/terms", params={"project": str(pid), "limit": 20000}).json()) == 5000
