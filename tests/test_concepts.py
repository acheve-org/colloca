"""Term entry model (T19): concepts with synonyms on both sides, gender, number, term-level notes."""
# ruff: noqa: E501
import io
import xml.etree.ElementTree as ET

import pytest
from openpyxl import load_workbook

from colloca import db, termbase, termexport

from .test_projects import project
from .test_termimport import do_import

XML = "{http://www.w3.org/XML/1998/namespace}lang"
NS3 = "{urn:iso:std:iso:30042:ed-2}"
ALL = "candidate,approved,admitted,superseded,forbidden"


@pytest.fixture(autouse=True)
def _clean(client):
    with db.session() as conn:
        conn.execute("DELETE FROM terms")


def add(client, **fields):
    body = {"src_lang": "es", "src_term": "vivienda", "tgt_term": "abitazione", "status": "approved", **fields}
    r = client.post("/api/terms", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def rows(client, pid):
    return client.get("/api/terms", params={"project": str(pid)}).json()


# --------------------------------------------------------------------------- the migration
def test_existing_rows_become_one_concept_per_project_pair_and_lowercase_source_term(tmp_path):
    conn = db.connect(str(tmp_path / "old.db"))                  # (registers the SQL functions the schema uses)
    conn.executescript("".join(sql for v, sql in db.MIGRATIONS if v <= 12) + "PRAGMA user_version = 12;")
    conn.execute("INSERT INTO projects (id, name) VALUES (1, 'A'), (2, 'B')")
    data = [(1, "es", "it", "Plazo", "termine", "approved"), (1, "es", "it", "plazo", "scadenza", "admitted"),
            (1, "es", "it", "contrato", "contratto", "approved"), (2, "es", "it", "plazo", "termine", "approved"),
            (None, "es", "it", "plazo", "termine", "approved"), (1, "it", "es", "plazo", "x", "approved")]
    for pid, s, t, src, tgt, st in data:
        conn.execute("INSERT INTO terms (project_id, src_lang, tgt_lang, src_term, tgt_term, status) "
                     "VALUES (?,?,?,?,?,?)", (pid, s, t, src, tgt, st))
    conn.commit()                                              # (the backup taken by migrate needs the data on disk)
    old = [dict(r) for r in conn.execute("SELECT * FROM terms ORDER BY id")]
    export_before = termexport.to_tbx([{**r, "project": ""} for r in old])
    assert db.migrate(conn, backup_path=str(tmp_path / "v12.bak")) == db.SCHEMA_VERSION
    new = [dict(r) for r in conn.execute("SELECT * FROM terms ORDER BY id")]
    ids = [r["concept_id"] for r in new]
    assert ids[0] == ids[1] and len(set(ids)) == 5          # Plazo/plazo of project A share a concept, nothing else does
    assert all(r["src_gender"] == r["tgt_number"] == r["src_note"] == "" for r in new)
    # acceptance: the export has the same content as before the migration
    assert termexport.to_tbx([{**r, "project": ""} for r in new]) == export_before


# --------------------------------------------------------------------------- creating and validating
def test_a_new_row_joins_the_concept_of_its_source_term(client):
    pid = project(client)
    a = add(client, project_id=pid, tgt_term="abitazione")
    b = add(client, project_id=pid, src_term="Vivienda", tgt_term="casa", status="admitted")     # same term, other case
    c = add(client, project_id=pid, src_term="contrato", tgt_term="contratto")
    assert a["concept_id"] == b["concept_id"] != c["concept_id"]
    other = add(client, project_id=project(client), tgt_term="abitazione")
    assert other["concept_id"] not in (a["concept_id"], c["concept_id"])                     # another project


def test_a_source_synonym_joins_the_concept_by_id(client):
    pid = project(client)
    first = add(client, project_id=pid)
    syn = add(client, project_id=pid, src_term="domicilio", tgt_term="abitazione", concept_id=first["concept_id"])
    assert syn["concept_id"] == first["concept_id"]
    listed = {t["src_term"]: t["concept_id"] for t in rows(client, pid)}
    assert listed == {"vivienda": first["concept_id"], "domicilio": first["concept_id"]}


def test_joining_a_concept_checks_project_and_language_pair(client):
    p1, p2 = project(client), project(client)
    first = add(client, project_id=p1)
    for body in (dict(project_id=p2), dict(project_id=p1, src_lang="it", src_term="abitazione", tgt_term="vivienda"),
                 dict(project_id=p1, concept_id=999999)):
        r = client.post("/api/terms", json={"src_lang": "es", "src_term": "domicilio", "tgt_term": "x",
                                            "concept_id": first["concept_id"], **body})
        assert r.status_code == 400 and "concept" in r.json()["detail"].lower()


def test_gender_number_and_notes_are_stored_per_term(client):
    pid = project(client)
    add(client, project_id=pid, src_gender="feminine", src_number="singular", tgt_gender="Feminine",
        tgt_number="plural", src_note="Uso general.", tgt_note="Più formale di casa.")
    [t] = rows(client, pid)
    assert (t["src_gender"], t["src_number"], t["tgt_gender"], t["tgt_number"]) == (
        "feminine", "singular", "feminine", "plural")
    assert (t["src_note"], t["tgt_note"]) == ("Uso general.", "Più formale di casa.")
    assert client.patch(f"/api/terms/{t['id']}", json={"tgt_gender": "masculine", "src_note": ""}).status_code == 200
    [t] = rows(client, pid)
    assert t["tgt_gender"] == "masculine" and t["src_note"] == "" and t["src_gender"] == "feminine"


@pytest.mark.parametrize("word,expected", [("m", "masculine"), ("F", "feminine"), ("femminile", "feminine"),
                                            ("maschile", "masculine"), ("femenino", "feminine"), ("", "")])
def test_friendly_gender_words(word, expected):
    assert termbase.clean({"src_term": "x", "src_lang": "es", "src_gender": word})["src_gender"] == expected


@pytest.mark.parametrize("word,expected", [("sg", "singular"), ("PL", "plural"), ("plurale", "plural"), ("mass", "mass")])
def test_friendly_number_words(word, expected):
    assert termbase.clean({"src_term": "x", "src_lang": "es", "tgt_number": word})["tgt_number"] == expected


def test_bad_values_are_refused(client):
    for body in ({"src_gender": "robot"}, {"tgt_number": "many"}, {"src_note": "x" * 2001}):
        r = client.post("/api/terms", json={"src_lang": "es", "src_term": "a", "tgt_term": "b", **body})
        assert r.status_code == 400, body


# --------------------------------------------------------------------------- exports
@pytest.fixture()
def concept(client):
    pid = project(client)
    first = add(client, project_id=pid, src_gender="feminine", src_number="singular", tgt_gender="feminine",
                tgt_number="singular", src_note="Uso general.", tgt_note="Più formale di casa.", domain="housing",
                definition="Lugar donde se vive.")
    add(client, project_id=pid, tgt_term="casa", status="admitted", src_gender="feminine", tgt_gender="feminine")
    add(client, project_id=pid, src_term="domicilio", tgt_term="abitazione", concept_id=first["concept_id"],
        src_gender="masculine", tgt_gender="feminine", tgt_number="plural")
    add(client, project_id=pid, src_term="contrato", tgt_term="contratto", tgt_gender="masculine")
    return pid


def export(client, pid, fmt):
    return client.get("/api/terms/export", params={"format": fmt, "project": str(pid), "status": ALL}).content


def test_tbx_gives_a_concept_its_synonyms_in_each_language_and_the_gender(client, concept):
    root = ET.fromstring(export(client, concept, "tbx"))
    entries = root.findall(f".//{NS3}conceptEntry")
    assert len(entries) == 2                                          # the housing concept and contract
    housing = next(e for e in entries if "vivienda" in ET.tostring(e, encoding="unicode"))
    langs = {s.get(XML): [t.find(f"{NS3}term").text for t in s.findall(f"{NS3}termSec")]
             for s in housing.findall(f"{NS3}langSec")}
    assert {k: sorted(v) for k, v in langs.items()} == {"es": ["domicilio", "vivienda"], "it": ["abitazione", "casa"]}
    notes = {(t.find(f"{NS3}term").text, n.get("type")): n.text for t in housing.iter(f"{NS3}termSec")
             for n in t.findall(f"{NS3}termNote")}
    assert notes[("vivienda", "grammaticalGender")] == "feminine"
    assert notes[("domicilio", "grammaticalGender")] == "masculine"
    assert notes[("abitazione", "grammaticalGender")] == "feminine"
    contract = next(e for e in entries if e is not housing)
    assert [n.text for n in contract.iter(f"{NS3}termNote") if n.get("type") == "grammaticalGender"] == ["masculine"]
    text = ET.tostring(root, encoding="unicode")
    assert "grammaticalNumber" not in text                            # TBX-Basic has no category for number
    assert "Uso general." in text and "Più formale di casa." in text    # term-level usage notes


def test_italian_gender_is_exported_in_tbx_2008_too(client, concept):
    root = ET.fromstring(export(client, concept, "tbx2"))
    genders = [n.text for n in root.iter("termNote") if n.get("type") == "grammaticalGender"]
    assert sorted(genders) == ["feminine", "feminine", "feminine", "masculine", "masculine"]


def test_spreadsheet_has_gender_number_notes_and_the_concept(client, concept):
    wb = load_workbook(io.BytesIO(export(client, concept, "xlsx")))
    ws = wb.active
    header = [c.value for c in ws[1]]
    assert header[-7:] == ["Source gender", "Source number", "Source note", "Translation gender",
                           "Translation number", "Translation note", "Concept"]
    body = {(r[0].value, r[1].value): [c.value for c in r] for r in ws.iter_rows(min_row=2)}
    first = body[("vivienda", "abitazione")]
    assert first[-7:-1] == ["feminine", "singular", "Uso general.", "feminine", "singular", "Più formale di casa."]
    assert body[("domicilio", "abitazione")][-1] == first[-1]          # same concept
    assert body[("contrato", "contratto")][-1] != first[-1]
    csv_text = export(client, concept, "csv").decode("utf-8-sig")
    assert csv_text.splitlines()[0].endswith("Translation note,Concept")


def test_rows_without_a_concept_still_group_by_source_term():
    base = dict(project_id=1, src_lang="es", tgt_lang="it", status="approved", pos="", domain="", definition="",
                notes="", context="", context_source="")
    rows_ = [dict(base, src_term="Plazo", tgt_term="termine"), dict(base, src_term="plazo", tgt_term="scadenza"),
             dict(base, src_term="otro", tgt_term="altro")]
    assert [len(g) for g in termexport._concepts(rows_)] == [2, 1]


# --------------------------------------------------------------------------- round trips
def shape(client, pid):
    """The termbase without ids: which terms are synonyms of which, and their data."""
    by = {}
    for t in rows(client, pid):
        by.setdefault(t["concept_id"], []).append((t["src_term"], t["tgt_term"], t["src_gender"], t["tgt_gender"]))
    return sorted(sorted(v) for v in by.values())


def test_spreadsheet_round_trip_keeps_concepts_and_term_data(client, concept):
    other = project(client)
    data = export(client, concept, "xlsx")
    pre = client.post("/api/terms/import/preview", files={"file": ("t.xlsx", data)}).json()
    assert {"src_gender", "tgt_note", "concept"} <= set(pre["mapping"])
    r = do_import(client, "t.xlsx", data, project_id=str(other), src_lang="es", tgt_lang="it", mapping=pre["mapping"])
    assert r.status_code == 200 and r.json()["rejected"] == 0, r.text
    assert shape(client, other) == shape(client, concept)
    a = {t["src_term"]: t for t in rows(client, concept)}
    b = {t["src_term"]: t for t in rows(client, other)}
    for term_ in a:
        assert {k: b[term_][k] for k in ("src_number", "tgt_number", "src_note", "tgt_note")} == \
               {k: a[term_][k] for k in ("src_number", "tgt_number", "src_note", "tgt_note")}


def test_tbx_round_trip_keeps_synonyms_together_and_genders(client, concept):
    other = project(client)
    r = do_import(client, "t.tbx", export(client, concept, "tbx"), project_id=str(other))
    assert r.status_code == 200 and r.json()["rejected"] == 0, r.text
    got = shape(client, other)
    want = shape(client, concept)
    # TBX holds a concept's terms per language, so the pairs differ in combination but the groups and genders match
    assert len(got) == len(want) == 2
    assert {x[0] for g in got for x in g} == {x[0] for g in want for x in g}
    assert {(x[0], x[2]) for g in got for x in g} == {("vivienda", "feminine"), ("domicilio", "masculine"),
                                                      ("contrato", "")}
    housing = next(g for g in got if any(x[0] == "vivienda" for x in g))
    assert {x[0] for x in housing} == {"vivienda", "domicilio"} and {x[1] for x in housing} == {"abitazione", "casa"}


def test_portable_backup_keeps_concepts(client, concept):
    zip_bytes = client.get(f"/api/projects/{concept}/export").content
    other = project(client)
    r = client.post("/api/import", data={"dry_run": "false", "project_id": str(other), "annotate": "false"},
                    files={"file": ("p.zip", zip_bytes)})
    assert r.status_code == 200, r.text
    assert shape(client, other) == shape(client, concept)


def test_deleted_rows_do_not_hold_a_concept_open(client):
    pid = project(client)
    first = add(client, project_id=pid)
    client.delete(f"/api/terms/{first['id']}")
    again = add(client, project_id=pid, tgt_term="casa")
    assert again["concept_id"] != first["concept_id"]
