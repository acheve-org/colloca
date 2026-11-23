import io
import sqlite3
import xml.etree.ElementTree as ET

import pytest
from openpyxl import load_workbook

from colloca import analysis, db, termbase, termexport

from .test_api import ES_TEXT, make_corpus
from .test_projects import doc, project

XML = "{http://www.w3.org/XML/1998/namespace}lang"
NS3 = "{urn:iso:std:iso:30042:ed-2}"


def term(client, **fields):
    body = {"src_lang": "es", "src_term": "contrato", "tgt_term": "contratto", "status": "approved", **fields}
    return client.post("/api/terms", json=body)


@pytest.fixture(autouse=True)
def _clean_terms(client):
    with db.session() as conn:
        conn.execute("DELETE FROM terms")


# --------------------------------------------------------------------------- CRUD & validation
def test_create_list_update_delete(client):
    pid = project(client)
    r = term(client, project_id=pid, pos="NOUN", domain="legal", context="El contrato establece las reglas.",
             origin="keyness")
    assert r.status_code == 201
    tid = r.json()["id"]
    [t] = client.get("/api/terms", params={"project": str(pid)}).json()
    assert (t["src_term"], t["tgt_term"], t["pos"], t["tgt_lang"]) == ("contrato", "contratto", "noun", "it")
    assert t["project"].startswith("Client")
    assert t["origin"] == "keyness" and t["status"] == "approved"

    patch = {"tgt_term": "il contratto", "notes": "  usar  siempre "}
    assert client.patch(f"/api/terms/{tid}", json=patch).status_code == 200
    t = client.get("/api/terms").json()[0]
    assert t["tgt_term"] == "il contratto" and t["notes"] == "usar  siempre" and t["domain"] == "legal"
    assert client.delete(f"/api/terms/{tid}").status_code == 204
    assert client.get("/api/terms").json() == []
    assert client.patch("/api/terms/999999", json={"notes": "x"}).status_code == 404


def test_validation(client):
    assert term(client, src_term="  ").status_code == 400
    assert term(client, status="maybe").status_code == 400
    assert term(client, pos="gerund").status_code == 400
    assert term(client, src_lang="fr").status_code == 400
    assert term(client, tgt_lang="es").status_code == 400                               # same as source
    assert term(client, src_term="x" * 201).status_code == 400
    assert term(client, project_id=9999).status_code == 404
    r = term(client, tgt_term="", status="approved")
    assert r.status_code == 400 and "needs a translation" in r.json()["detail"]
    assert term(client, tgt_term="", status="candidate").status_code == 201             # candidates may be untranslated
    tid = client.get("/api/terms").json()[0]["id"]
    assert client.patch(f"/api/terms/{tid}", json={"status": "approved"}).status_code == 400
    assert client.patch(f"/api/terms/{tid}", json={"src_term": ""}).status_code == 400


def test_duplicates_are_rejected_case_insensitively_per_project(client):
    pid = project(client)
    assert term(client).status_code == 201
    assert term(client, src_term="Contrato", tgt_term="CONTRATTO").status_code == 409
    assert term(client, tgt_term="accordo").status_code == 201                          # another translation is fine
    assert term(client, project_id=pid).status_code == 201                              # same pair in another project
    other = term(client, src_term="plazo", tgt_term="termine").json()["id"]
    clash = {"src_term": "contrato", "tgt_term": "contratto"}
    assert client.patch(f"/api/terms/{other}", json=clash).status_code == 409


def test_deleting_a_project_deletes_its_terms(client):
    pid = project(client)
    term(client, project_id=pid)
    term(client)
    client.delete(f"/api/projects/{pid}")
    assert [t["project"] for t in client.get("/api/terms").json()] == [None]


def test_list_filters(client):
    pid = project(client)
    term(client, project_id=pid)
    term(client, src_term="plazo", tgt_term="termine", status="candidate")
    term(client, src_term="Garantía", tgt_term="garanzia", status="forbidden")
    ids = lambda **p: [t["src_term"] for t in client.get("/api/terms", params=p).json()]  # noqa: E731
    assert ids(project="none") == ["Garantía", "plazo"] and ids(project=str(pid)) == ["contrato"]
    assert ids(status="approved,forbidden") == ["contrato", "Garantía"]
    assert ids(q="garan") == ["Garantía"] and ids(q="TERMINE") == ["plazo"] and ids(q="%") == []
    assert ids(src_lang="it") == [] and client.get("/api/terms", params={"project": "abc"}).status_code == 400


# --------------------------------------------------------------------------- examples
def test_example_sentences(client):
    cid = make_corpus(client)
    doc(client, cid, ES_TEXT, title="informe")
    res = client.get(f"/api/corpora/{cid}/examples", params={"q": "terminología", "limit": 3}).json()
    assert 1 <= len(res) <= 3
    assert all("erminolog" in e["sentence"] and e["doc"] == "informe" for e in res)
    assert len({e["sentence"] for e in res}) == len(res)
    assert client.get(f"/api/corpora/{cid}/examples", params={"q": "inexistente"}).json() == []
    assert client.get(f"/api/corpora/{cid}/examples", params={"q": "terminología", "tags": "nope"}).json() == []


# --------------------------------------------------------------------------- exports
ROWS = [
    dict(project_id=1, project="Acme", src_lang="es", tgt_lang="it", src_term="contrato", tgt_term="contratto",
         pos="noun", status="approved", domain="legal", definition="Acuerdo <entre> partes & más",
         notes="siempre", context="El contrato establece las reglas.", context_source="informe"),
    dict(project_id=1, project="Acme", src_lang="es", tgt_lang="it", src_term="Contrato", tgt_term="accordo",
         pos="noun", status="forbidden", domain="", definition="", notes="", context="", context_source=""),
    dict(project_id=1, project="Acme", src_lang="es", tgt_lang="it", src_term="plazo", tgt_term="",
         pos="", status="candidate", domain="", definition="", notes="", context="", context_source=""),
]


def test_tbx3_structure():
    root = ET.fromstring(termexport.to_tbx(ROWS, 3))
    assert root.tag == NS3 + "tbx" and root.get(XML) == "es" and root.get("type") == "TBX-Basic"
    entries = root.findall(f".//{NS3}conceptEntry")
    assert len(entries) == 2                                           # contrato+Contrato share a concept
    c = entries[0]
    assert c.find(f"{NS3}descrip[@type='subjectField']").text == "legal"
    src, tgt = c.findall(f"{NS3}langSec")
    assert (src.get(XML), tgt.get(XML)) == ("es", "it")
    assert src.find(f"{NS3}descrip[@type='definition']").text == "Acuerdo <entre> partes & más"   # escaped on the wire
    assert src.find(f"{NS3}termSec/{NS3}term").text == "contrato"
    assert src.find(f"{NS3}termSec/{NS3}descrip[@type='context']").text.startswith("El contrato")
    secs = tgt.findall(f"{NS3}termSec")
    assert [s.find(f"{NS3}term").text for s in secs] == ["contratto", "accordo"]
    status = [s.find(f"{NS3}termNote[@type='administrativeStatus']").text for s in secs]
    assert status == ["preferredTerm-admn-sts", "deprecatedTerm-admn-sts"]
    assert secs[0].find(f"{NS3}note").text == "siempre"
    assert entries[1].findall(f"{NS3}langSec")[0].get(XML) == "es" and len(entries[1].findall(f"{NS3}langSec")) == 1


def test_tbx2_structure():
    root = ET.fromstring(termexport.to_tbx(ROWS, 2))
    assert root.tag == "martif" and root.get("type") == "TBX" and root.get(XML) == "es"
    assert root.find(".//encodingDesc/p").text == "TBXBasicXCSV02.xcs"
    entries = root.findall(".//termEntry")
    assert len(entries) == 2
    tigs = entries[0].findall("langSet/tig")
    assert [t.find("term").text for t in tigs] == ["contrato", "contratto", "accordo"]
    assert tigs[1].find("termNote[@type='administrativeStatus']").text == "preferredTerm-admn-sts"
    assert entries[0].find("langSet[@{http://www.w3.org/XML/1998/namespace}lang='it']") is not None


def test_tbx_strips_control_characters_and_handles_empty():
    rows = [{**ROWS[0], "src_term": "con\x0btrato", "tgt_term": "ok"}]
    clean = termbase.clean({"src_term": rows[0]["src_term"], "src_lang": "es"})
    assert clean["src_term"] == "contrato"
    assert ET.fromstring(termexport.to_tbx([], 3)).findall(f".//{NS3}conceptEntry") == []
    with pytest.raises(ValueError):
        termexport.to_tbx([], 4)


def test_csv_is_formula_safe():
    rows = [{**ROWS[0], "src_term": "=HYPERLINK(\"http://x\")", "notes": "+1"}]
    text = termexport.to_csv(rows)
    assert text.startswith("﻿Source term,Translation") and "'=HYPERLINK" in text and "'+1" in text


def test_xlsx_roundtrip_and_formula_safety():
    rows = [{**ROWS[0], "src_term": "=1+1", "tgt_term": "@x"}, ROWS[1]]
    ws = load_workbook(io.BytesIO(termexport.to_xlsx(rows))).active
    assert [c.value for c in ws[1]][:3] == ["Source term", "Translation", "Source language"]
    assert ws["A2"].value == "=1+1" and ws["A2"].data_type == "s"        # stored as text, not as a formula
    assert ws["B3"].value == "accordo" and ws.max_row == 3


def test_export_endpoint(client):
    pid = project(client)
    term(client, project_id=pid, domain="legal")
    term(client, project_id=pid, src_term="plazo", tgt_term="", status="candidate")
    term(client, src_term="otro", tgt_term="altro")
    r = client.get("/api/terms/export", params={"format": "tbx", "project": str(pid)})
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    root = ET.fromstring(r.content)
    assert [t.text for t in root.iter(f"{NS3}term")] == ["contrato", "contratto"]          # approved only, this project
    both = client.get("/api/terms/export",
                      params={"format": "tbx2", "project": str(pid), "status": "approved,candidate"})
    assert sorted(t.text for t in ET.fromstring(both.content).iter("term")) == ["contrato", "contratto", "plazo"]
    csv_r = client.get("/api/terms/export", params={"format": "csv", "project": "none"})
    assert csv_r.headers["content-type"].startswith("text/csv")
    assert "otro" in csv_r.text and "contrato" not in csv_r.text
    xl = client.get("/api/terms/export", params={"format": "xlsx"})
    assert load_workbook(io.BytesIO(xl.content)).active.max_row == 3                       # header + 2 approved
    assert client.get("/api/terms/export", params={"format": "doc"}).status_code == 400
    assert client.get("/api/terms/export", params={"project": "x"}).status_code == 400


# --------------------------------------------------------------------------- migration
def test_v4_database_upgrades_to_v5(tmp_path):
    conn = sqlite3.connect(tmp_path / "v4.db")
    conn.row_factory = sqlite3.Row
    conn.executescript(db._V1 + db._V2 + db._V3 + db._V4 + "PRAGMA user_version = 4;")
    conn.execute("INSERT INTO corpora (name, lang) VALUES ('Client', 'es')")
    conn.commit()
    assert db.migrate(conn) == db.SCHEMA_VERSION
    conn.execute("INSERT INTO terms (src_lang,tgt_lang,src_term) VALUES ('es','it','a')")
    with pytest.raises(sqlite3.IntegrityError):                              # NULL project still enforces uniqueness
        conn.execute("INSERT INTO terms (src_lang,tgt_lang,src_term) VALUES ('es','it','A')")
    assert conn.execute("SELECT COUNT(*) FROM corpora").fetchone()[0] == 1


def test_examples_prefer_sentences_of_comfortable_length(tmp_path):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    db.migrate(conn)
    cid = conn.execute("INSERT INTO corpora (name, lang) VALUES ('c','es')").lastrowid
    did = conn.execute("INSERT INTO documents (corpus_id,title,text,text_hash,n_tokens) VALUES (?,?,?,?,?)",
                       (cid, "d", "x", "h", 0)).lastrowid
    short = ["casa", "es", "grande", "y", "bonita"]                                   # 5 tokens
    long_ = ["la", "casa"] + ["muy"] * 16 + ["grande"]                               # 19 tokens, closest to 18
    pos = 0
    for sent, words in enumerate([short, long_]):
        for w in words:
            conn.execute("INSERT INTO tokens VALUES (?,?,?,?,?,?,?,?,?,?)", (did, pos, sent, w, w, w, "NOUN", 1, 0, 1))
            pos += 1
    res = analysis.examples(conn, cid, "casa", "form", 2)
    assert [len(e["sentence"].split()) for e in res] == [19, 5]
