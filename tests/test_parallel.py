import io
import sqlite3
from xml.sax.saxutils import escape

import pytest
from docx import Document

from corpora import db, ingest, parallel

from .test_api import make_corpus, wait_for_jobs
from .test_projects import project


def build_pairs():
    pairs = []
    for k in range(1, 7):
        pairs.append((f"El contrato establece las obligaciones del arrendador en cada caso {k} para el cliente.",
                      f"Il contratto stabilisce gli obblighi del locatore in ogni caso {k} per il cliente."))
    for k in range(1, 7):
        pairs.append((f"El plazo de entrega termina el viernes por la tarde {k} para el cliente.",
                      f"Il termine di consegna scade venerdì pomeriggio {k} per il cliente."))
    for k in range(1, 7):
        pairs.append((f"La casa tiene un jardín grande y muy bonito {k} para el cliente.",
                      f"La casa ha un giardino grande e molto bello {k} per il cliente."))
    return pairs


def tmx(pairs, es="es-ES", it="it-IT", extra=""):
    tus = "".join(f'<tu><tuv xml:lang="{es}"><seg>{escape(a)}</seg></tuv>'
                  f'<tuv xml:lang="{it}"><seg>{escape(b)}</seg></tuv></tu>' for a, b in pairs)
    return (f'<?xml version="1.0" encoding="UTF-8"?><tmx version="1.4"><header srclang="es" datatype="plaintext"/>'
            f"<body>{tus}{extra}</body></tmx>").encode()


def import_tmx(client, cid, data, name="memory.tmx", **params):
    r = client.post(f"/api/corpora/{cid}/upload-pairs", params=params, files=[("files", (name, data, "text/xml"))])
    assert r.status_code == 202, r.text
    return r.json()[0]


@pytest.fixture(autouse=True)
def _clean_terms(client):
    with db.session() as conn:
        conn.execute("DELETE FROM terms")


@pytest.fixture()
def pair(client):
    es, it = make_corpus(client, "es", "ES side"), make_corpus(client, "it", "IT side")
    import_tmx(client, es, tmx(build_pairs()), partner_corpus_id=it)
    job = wait_for_jobs(client, es)[0]
    assert job["status"] == "done", job
    return es, it, job


# --------------------------------------------------------------------------- readers
def test_tmx_reader_handles_markup_languages_and_gaps():
    data = (b'<tmx version="1.4"><header/><body>'
            b'<tu><tuv xml:lang="ES_es"><seg>Pulse <bpt i="1">&lt;b&gt;</bpt>aceptar<ept i="1">&lt;/b&gt;</ept> '
            b'para <hi>continuar</hi>.<ph x="1"/></seg></tuv><tuv xml:lang="it"><seg>Premere  \n  OK.</seg></tuv></tu>'
            b'<tu><tuv xml:lang="es"><seg>Solo en espa\xc3\xb1ol</seg></tuv></tu>'
            b'<tu><tuv xml:lang="fr"><seg>Bonjour</seg></tuv><tuv xml:lang="it"><seg>Ciao</seg></tuv></tu>'
            b'<tu><tuv xml:lang="es"><seg>Primera</seg></tuv><tuv xml:lang="es"><seg>Variante</seg></tuv>'
            b'<tuv xml:lang="it"><seg>Prima</seg></tuv></tu></body></tmx>')
    pairs, skipped = parallel.read_tmx(data, "es", "it")
    assert pairs == [("Pulse aceptar para continuar.", "Premere OK."), ("Primera", "Prima")]
    assert skipped == 2                                                       # one-sided and wrong-language units
    swapped, _ = parallel.read_tmx(data, "it", "es")
    assert swapped[0] == ("Premere OK.", "Pulse aceptar para continuar.")


def test_tmx_reader_refuses_hostile_and_broken_files():
    bomb = (b'<?xml version="1.0"?><!DOCTYPE tmx [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]>'
            b"<tmx><body><tu><tuv xml:lang='es'><seg>&b;</seg></tuv></tu></body></tmx>")
    with pytest.raises(ingest.IngestError, match="TMX"):
        parallel.read_tmx(bomb, "es", "it")
    with pytest.raises(ingest.IngestError, match="TMX"):
        parallel.read_tmx(b"<tmx><body>", "es", "it")


def test_delimited_reader_header_swap_and_separators():
    tsv = "Español\tItaliano\nHola mundo\tCiao mondo\nUna frase\t\nGracias\tGrazie\n".encode()
    assert parallel.read_delimited(tsv) == ([("Hola mundo", "Ciao mondo"), ("Gracias", "Grazie")], 1)
    assert parallel.read_delimited(tsv, swap=True)[0][0] == ("Ciao mondo", "Hola mundo")
    semi = b'es;it\n"Hola, mundo";"Ciao, mondo"\n'
    assert parallel.read_delimited(semi)[0] == [("Hola, mundo", "Ciao, mondo")]
    with pytest.raises(ingest.IngestError, match="second column"):
        parallel.read_delimited(b"just one column\nanother line\n")


def test_docx_table_reader():
    d = Document()
    d.add_paragraph("intro that is ignored")
    t = d.add_table(rows=3, cols=2)
    for row, (a, b) in zip(t.rows, [("ES", "IT"), ("Buenos días", "Buongiorno"), ("Adiós", "")], strict=True):
        row.cells[0].text, row.cells[1].text = a, b
    buf = io.BytesIO()
    d.save(buf)
    assert parallel.read_docx_table(buf.getvalue()) == ([("Buenos días", "Buongiorno")], 1)
    empty = io.BytesIO()
    Document().save(empty)
    with pytest.raises(ingest.IngestError, match="table"):
        parallel.read_docx_table(empty.getvalue())


def test_read_pairs_rejects_unknown_types_and_empty_results():
    with pytest.raises(ingest.IngestError, match="Unsupported"):
        parallel.read_pairs("x.pdf", b"", "es", "it")
    with pytest.raises(ingest.IngestError, match="language pair"):
        parallel.read_pairs("x.tmx", tmx([("Hola", "Ciao")], es="fr", it="de"), "es", "it")


# --------------------------------------------------------------------------- import
def test_import_creates_linked_segmented_documents(client, pair):
    es, it, job = pair
    assert job["result"] == {"documents": 1, "segments": 18, "skipped_units": 0, "skipped_duplicates": 0}
    [d_es] = client.get(f"/api/corpora/{es}/documents").json()
    [d_it] = client.get(f"/api/corpora/{it}/documents").json()
    assert d_es["pair_doc_id"] == d_it["id"] and d_it["pair_doc_id"] == d_es["id"]
    assert d_es["segmented"] == 1 and d_es["kind"] == "aligned" and d_es["title"] == "memory"
    with db.session() as conn:
        for doc in (d_es["id"], d_it["id"]):
            segs = conn.execute("SELECT seg, start_pos, end_pos FROM segments WHERE doc_id=? ORDER BY seg",
                                (doc,)).fetchall()
            assert [s["seg"] for s in segs] == list(range(18))
            contiguous = all(a["end_pos"] == b["start_pos"] for a, b in zip(segs, segs[1:], strict=False))
            assert segs[0]["start_pos"] == 0 and contiguous
            n = conn.execute("SELECT COUNT(*) FROM tokens WHERE doc_id=?", (doc,)).fetchone()[0]
            assert segs[-1]["end_pos"] == n
    info = client.get(f"/api/corpora/{es}/parallel").json()
    assert info["documents"] == 1 and info["segments"] == 18 and info["partners"][0]["id"] == it
    assert client.get(f"/api/corpora/{it}/parallel").json()["partners"][0]["id"] == es


def test_import_orientation_follows_the_corpus_language(client):
    es, it = make_corpus(client, "es", "e"), make_corpus(client, "it", "i")
    import_tmx(client, it, tmx(build_pairs()), partner_corpus_id=es)               # imported from the Italian side
    assert wait_for_jobs(client, it)[0]["status"] == "done"
    doc_id = client.get(f"/api/corpora/{it}/documents").json()[0]["id"]
    assert client.get(f"/api/documents/{doc_id}").json()["text"].startswith("Il contratto")


def test_partner_can_be_created_and_inherits_the_project(client):
    pid = project(client)
    es = client.post("/api/corpora", json={"name": "Acme ES", "lang": "es", "project_id": pid}).json()["id"]
    res = import_tmx(client, es, tmx(build_pairs()), partner_name="Acme IT")
    assert wait_for_jobs(client, es)[0]["status"] == "done"
    partner = next(c for c in client.get("/api/corpora").json() if c["id"] == res["partner_corpus_id"])
    assert (partner["name"], partner["lang"], partner["project_id"], partner["docs"]) == ("Acme IT", "it", pid, 1)


def test_partner_validation(client):
    es, es2, it = make_corpus(client, "es", "a"), make_corpus(client, "es", "b"), make_corpus(client, "it", "c")
    ref = client.post("/api/references", json={"lang": "it"}).json()["id"]
    files = [("files", ("m.tmx", tmx(build_pairs()), "text/xml"))]
    up = lambda **p: client.post(f"/api/corpora/{es}/upload-pairs", params=p, files=files).status_code  # noqa: E731
    assert up() == 400                                        # no partner
    assert up(partner_corpus_id=es) == 400 and up(partner_corpus_id=es2) == 400   # itself / same language
    assert up(partner_corpus_id=ref) == 400                   # base corpus
    assert up(partner_corpus_id=99999) == 404
    assert up(partner_corpus_id=it, doc_date="nope") == 400
    base = client.post("/api/references", json={"lang": "es"}).json()["id"]
    to_base = client.post(f"/api/corpora/{base}/upload-pairs", params={"partner_corpus_id": it}, files=files)
    assert to_base.status_code == 400


def test_two_column_file_import_and_swap(client):
    es, it = make_corpus(client, "es", "e"), make_corpus(client, "it", "i")
    rows = "\n".join(f"{a}\t{b}" for a, b in build_pairs()[:8]).encode()
    import_tmx(client, es, rows, "pairs.tsv", partner_corpus_id=it, swap=False)
    assert wait_for_jobs(client, es)[0]["status"] == "done"
    text = client.get(f"/api/documents/{client.get(f'/api/corpora/{es}/documents').json()[0]['id']}").json()["text"]
    assert text.startswith("El contrato")
    es2, it2 = make_corpus(client, "es", "e2"), make_corpus(client, "it", "i2")
    swapped = "\n".join(f"{b}\t{a}" for a, b in build_pairs()[:8]).encode()           # Italian first
    import_tmx(client, es2, swapped, "pairs.tsv", partner_corpus_id=it2, swap=True)
    assert wait_for_jobs(client, es2)[0]["status"] == "done"


def test_wrong_language_pairs_are_rejected_without_leftovers(client):
    es, it = make_corpus(client, "es", "e"), make_corpus(client, "it", "i")
    import_tmx(client, es, tmx([(b, a) for a, b in build_pairs()]), partner_corpus_id=it)   # sides swapped
    job = wait_for_jobs(client, es)[0]
    assert job["status"] == "error" and job["code"] == "language_mismatch"
    assert client.get(f"/api/corpora/{es}/documents").json() == []
    assert client.get(f"/api/corpora/{it}/documents").json() == []
    import_tmx(client, es, tmx([(b, a) for a, b in build_pairs()]), partner_corpus_id=it, force_language=True)
    assert wait_for_jobs(client, es)[-1]["status"] == "done"


def test_reimporting_the_same_file_is_skipped(client, pair):
    es, it, _ = pair
    import_tmx(client, es, tmx(build_pairs()), partner_corpus_id=it)
    last = wait_for_jobs(client, es)[-1]
    assert last["status"] == "done" and last["result"]["documents"] == 0 and last["result"]["skipped_duplicates"] == 1
    assert len(client.get(f"/api/corpora/{es}/documents").json()) == 1


def test_large_files_are_split_into_parts(client, monkeypatch):
    monkeypatch.setattr(parallel, "PAIRS_PER_DOC", 8)
    es, it = make_corpus(client, "es", "e"), make_corpus(client, "it", "i")
    import_tmx(client, es, tmx(build_pairs()), partner_corpus_id=it)
    job = wait_for_jobs(client, es)[0]
    assert job["result"]["documents"] == 3 and job["result"]["segments"] == 18
    titles = [d["title"] for d in client.get(f"/api/corpora/{es}/documents").json()]
    assert titles == ["memory (part 1)", "memory (part 2)", "memory (part 3)"]
    docs = client.get(f"/api/corpora/{it}/documents").json()
    assert all(d["pair_doc_id"] for d in docs)


# --------------------------------------------------------------------------- bilingual search
def test_bilingual_concordance_pairs_each_hit_with_its_translation(client, pair):
    es, it, _ = pair
    res = client.get(f"/api/corpora/{es}/bilingual", params={"q": "contrato"}).json()
    assert res["total"] == 6 and len(res["lines"]) == 6
    for line in res["lines"]:
        assert line["node"].lower() == "contrato"
        assert line["source"].startswith("El contrato establece")
        assert line["target"].startswith("Il contratto stabilisce")
    # the numbering ties each source segment to the target with the same number
    number = lambda text: text.split("caso ")[1].split()[0]  # noqa: E731
    numbers = {(number(ln["source"]), number(ln["target"])) for ln in res["lines"]}
    assert all(a == b for a, b in numbers) and len(numbers) == 6
    rev = client.get(f"/api/corpora/{it}/bilingual", params={"q": "contratto"}).json()        # from the other side
    assert rev["total"] == 6 and rev["lines"][0]["target"].startswith("El contrato")


def test_bilingual_search_ignores_unaligned_documents_and_respects_filters(client, pair):
    es, it, _ = pair
    client.post(f"/api/corpora/{es}/documents", json={
        "title": "plain", "tags": "plain",
        "text": "Este contrato no tiene traducción alguna en ninguna memoria de traducción disponible."})
    assert client.get(f"/api/corpora/{es}/concordance", params={"q": "contrato"}).json()["total"] == 7
    assert client.get(f"/api/corpora/{es}/bilingual", params={"q": "contrato"}).json()["total"] == 6
    only_plain = client.get(f"/api/corpora/{es}/bilingual", params={"q": "contrato", "tags": "plain"}).json()
    assert only_plain["total"] == 0
    assert client.get(f"/api/corpora/{es}/bilingual", params={"q": "inexistente"}).json()["lines"] == []
    csv_r = client.get(f"/api/corpora/{es}/bilingual", params={"q": "contrato", "format": "csv"})
    assert "target" in csv_r.text.splitlines()[0] and "Il contratto" in csv_r.text


def test_equivalents_rank_by_dice(client, pair):
    es, _, _ = pair
    res = client.get(f"/api/corpora/{es}/equivalents", params={"q": "contrato"}).json()
    assert res["node_segments"] == 6
    rows = {r["item"]: r for r in res["rows"]}
    top = rows["contratto"]
    assert (top["cooc"], top["node_segments"], top["target_segments"], top["dice"]) == (6, 6, 6, 1.0)
    assert top["logdice"] == 14.0 and top["pos"] == "NOUN"
    assert res["rows"][0]["dice"] == 1.0
    common = [r for r in res["rows"] if r["target_segments"] == 18]            # words in every target segment
    assert common and all(r["dice"] == 0.5 and r["dice"] < top["dice"] for r in common)
    plazo = {r["item"]: r for r in client.get(f"/api/corpora/{es}/equivalents", params={"q": "plazo"}).json()["rows"]}
    assert plazo["termine"]["dice"] == 1.0 and "contratto" not in plazo
    assert client.get(f"/api/corpora/{es}/equivalents", params={"q": "contrato", "min_freq": 7}).json()["rows"] == []
    assert client.get(f"/api/corpora/{es}/equivalents", params={"q": "contrato", "pos": "VERB"}).json()["rows"] != []
    assert all(r["pos"] == "VERB" for r in client.get(f"/api/corpora/{es}/equivalents",
                                                      params={"q": "contrato", "pos": "VERB"}).json()["rows"])


def test_equivalents_from_the_target_side(client, pair):
    _, it, _ = pair
    rows = {r["item"] for r in client.get(f"/api/corpora/{it}/equivalents", params={"q": "contratto"}).json()["rows"]}
    assert "contrato" in rows


# --------------------------------------------------------------------------- lifecycle
def test_reannotation_keeps_segments_and_alignment(client, pair):
    es, it, _ = pair
    before = client.get(f"/api/corpora/{es}/bilingual", params={"q": "contrato"}).json()
    with db.session() as conn:
        conn.execute("UPDATE documents SET pipeline='old 0.0' WHERE corpus_id=?", (es,))
        conn.execute("DELETE FROM segments WHERE doc_id IN (SELECT id FROM documents WHERE corpus_id=?)", (es,))
    client.post(f"/api/corpora/{es}/reannotate")
    deadline = __import__("time").time() + 30
    while __import__("time").time() < deadline:
        jobs = client.get(f"/api/corpora/{es}/jobs").json()
        if jobs[-1]["kind"] == "reannotate" and jobs[-1]["status"] in ("done", "error"):
            break
        __import__("time").sleep(0.05)
    assert jobs[-1]["status"] == "done"
    assert client.get(f"/api/corpora/{es}/bilingual", params={"q": "contrato"}).json() == before


def test_deleting_one_side_unlinks_the_other(client, pair):
    es, it, _ = pair
    [d_es] = client.get(f"/api/corpora/{es}/documents").json()
    client.delete(f"/api/documents/{d_es['id']}")
    [d_it] = client.get(f"/api/corpora/{it}/documents").json()
    assert d_it["pair_doc_id"] is None
    assert client.get(f"/api/corpora/{it}/bilingual", params={"q": "contratto"}).json()["total"] == 0
    assert client.get(f"/api/corpora/{it}/parallel").json()["documents"] == 0


def test_monolingual_analyses_work_on_each_side(client, pair):
    es, it, _ = pair
    assert "contrato" in {r["item"] for r in client.get(f"/api/corpora/{es}/frequency").json()}
    assert "contratto" in {r["item"] for r in client.get(f"/api/corpora/{it}/frequency").json()}


def test_v5_database_upgrades_to_v6(tmp_path):
    conn = sqlite3.connect(tmp_path / "v5.db")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(db._V1 + db._V2 + db._V3 + db._V4 + db._V5 + "PRAGMA user_version = 5;")
    conn.execute("INSERT INTO corpora (name, lang) VALUES ('c', 'es')")
    conn.execute("INSERT INTO documents (corpus_id,title,text,text_hash) VALUES (1,'d','t','h')")
    conn.commit()
    assert db.migrate(conn) == db.SCHEMA_VERSION
    assert conn.execute("SELECT segmented, pair_doc_id FROM documents").fetchone()[:] == (0, None)
    conn.execute("INSERT INTO segments VALUES (1, 0, 0, 3)")
    conn.execute("DELETE FROM documents WHERE id=1")
    assert conn.execute("SELECT COUNT(*) FROM segments").fetchone()[0] == 0                # cascade


# --------------------------------------------------------------------------- highlighted equivalents (T01)
def _marked(text, marks):
    return [text[m["start"]:m["end"]] for m in marks]


def test_bilingual_lines_mark_the_hit_and_the_likely_equivalent(client, pair):
    es, it, _ = pair
    res = client.get(f"/api/corpora/{es}/bilingual", params={"q": "contrato"}).json()
    assert len(res["lines"]) == 6
    for line in res["lines"]:
        assert _marked(line["source"], line["source_marks"]) == ["contrato"]
        assert _marked(line["target"], line["target_marks"]) == ["contratto"]
        assert all(m["guess"] and 0 < m["score"] <= 1 for m in line["target_marks"])
    # searching from the target corpus marks the hit in its own segment and the Spanish word in the other
    rev = client.get(f"/api/corpora/{it}/bilingual", params={"q": "contratto"}).json()
    assert _marked(rev["lines"][0]["source"], rev["lines"][0]["source_marks"]) == ["contratto"]
    assert _marked(rev["lines"][0]["target"], rev["lines"][0]["target_marks"]) == ["contrato"]


def test_an_approved_termbase_translation_beats_the_statistical_guess(client, pair):
    es, _, _ = pair
    assert client.post("/api/terms", json={"src_lang": "es", "src_term": "contrato", "tgt_term": "obblighi",
                                           "status": "approved"}).status_code == 201
    line = client.get(f"/api/corpora/{es}/bilingual", params={"q": "contrato"}).json()["lines"][0]
    assert _marked(line["target"], line["target_marks"]) == ["obblighi"]
    assert line["target_marks"][0]["guess"] is False
    # a forbidden entry is not a recommended translation: the statistical guess is used instead
    client.post("/api/terms", json={"src_lang": "es", "src_term": "plazo", "tgt_term": "scadenza",
                                    "status": "forbidden"})
    plazo = client.get(f"/api/corpora/{es}/bilingual", params={"q": "plazo"}).json()["lines"][0]
    assert plazo["target_marks"] and all(m["guess"] for m in plazo["target_marks"])
    assert "scadenza" not in _marked(plazo["target"], plazo["target_marks"])


def test_marks_follow_the_occurrence_and_the_lemma_not_the_surface_form(client):
    es, it = make_corpus(client, "es", "ES"), make_corpus(client, "it", "IT")
    pairs = [(f"El contrato anterior sustituye al contrato nuevo en el caso {k}.",
              f"I contratti precedenti sostituiscono il contratto nuovo nel caso {k}.") for k in range(1, 5)]
    import_tmx(client, es, tmx(pairs), partner_corpus_id=it)
    assert wait_for_jobs(client, es)[0]["status"] == "done"
    lines = client.get(f"/api/corpora/{es}/bilingual", params={"q": "contrato", "sort": "doc"}).json()["lines"]
    assert len(lines) == 8
    first, second = lines[0], lines[1]
    assert first["pos"] != second["pos"]
    assert first["source_marks"] != second["source_marks"]                   # each line marks its own occurrence
    assert _marked(first["source"], first["source_marks"]) == ["contrato"]
    assert first["source"].index("contrato") == first["source_marks"][0]["start"]
    assert second["source_marks"][0]["start"] == second["source"].rindex("contrato")
    assert _marked(first["target"], first["target_marks"]) == ["contratti", "contratto"]   # lemma: inflected + singular


def test_csv_export_of_a_bilingual_search_is_unchanged(client, pair):
    es, _, _ = pair
    header = client.get(f"/api/corpora/{es}/bilingual", params={"q": "contrato", "format": "csv"}).text.splitlines()[0]
    assert "marks" not in header and "target" in header


def test_a_termbase_translation_missing_from_a_segment_falls_back_to_the_guess(client, pair):
    es, _, _ = pair
    client.post("/api/terms", json={"src_lang": "es", "src_term": "contrato", "tgt_term": "accordo",
                                    "status": "approved"})
    line = client.get(f"/api/corpora/{es}/bilingual", params={"q": "contrato"}).json()["lines"][0]
    assert _marked(line["target"], line["target_marks"]) == ["contratto"] and line["target_marks"][0]["guess"]
