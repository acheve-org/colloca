"""Import cleaning (cleaning.py): page furniture, noise, repairs and line hashes."""

import sqlite3
from collections import Counter
from pathlib import Path

import pytest

from corpora import db, importer, ingest, metadata
from corpora.cleaning import clean, line_hash, line_hashes, site_counts

from .pdfmaker import lines, make_pdf
from .test_api import make_corpus, wait_for_jobs
from .test_extraction_flags import serve  # noqa: F401  (fixture)

FIXTURES = Path(__file__).parent / "fixtures" / "web"
BODY_ES = ("El pleno aprobó ayer el nuevo plan de movilidad para toda la ciudad. Las obras empezarán en primavera "
           "y durarán dos años. Los vecinos podrán presentar alegaciones durante un mes.")
BODY_LINES_ES = [
    "El pleno aprobó ayer el nuevo plan de movilidad para toda la ciudad.",
    "Las obras empezarán en primavera y durarán dos años.",
    "Los vecinos podrán presentar alegaciones durante un mes.",
    "El alcalde defendió que el plan reducirá el tráfico en el centro.",
    "La oposición criticó la falta de consenso con los comerciantes.",
    "El presupuesto total asciende a cuarenta millones de euros.",
    "Una parte de la financiación procede de fondos europeos.",
    "El ayuntamiento publicará el calendario de obras la próxima semana.",
]
BODY_EN = ("The council announced new grants for community archives today. The awards will fund cataloguing and "
           "volunteer training. Applications for the next round open in the autumn.")


def _pdf(pages):
    return clean(pages, fmt="pdf")


def test_running_header_and_page_numbers_removed():
    pages = [f"ACME Annual Report\nBody text of page {i} goes on.\n{i}" for i in range(1, 7)]
    c = _pdf(pages)
    assert "ACME Annual Report" not in c.text and "\n3\n" not in f"\n{c.text}\n"
    assert {r.step for r in c.removed} == {"page_furniture"}
    assert "Body text of page 3 goes on." in c.text


def test_mid_page_line_differing_only_in_digits_is_kept():
    pages = [f"ACME Annual Report\nIntro line one.\nIntro line two.\nFigure {i} shows the results.\n"
             f"Closing line one.\nClosing line two.\n{i}" for i in range(10, 16)]
    c = _pdf(pages)
    assert all(f"Figure {i} shows the results." in c.text for i in range(10, 16))
    assert "ACME Annual Report" not in c.text


def test_header_differing_only_in_digits_is_one_header():
    pages = [f"Report 2024 — page {i}\nReal sentence number {i} here." for i in range(1, 7)]
    assert "Report 2024" not in _pdf(pages).text


@pytest.mark.parametrize("pn", ["- 12 -", "Page 12", "Página 12 de 40", "Pag. 12", "12/40"])
def test_page_number_shapes(pn):
    assert pn not in _pdf([f"Some body sentence.\n{pn}"]).text


def test_noise_lines_removed_but_table_rows_kept():
    c = clean(["Intro sentence.\n* * *\n2023 | 2024 | 2025\n---"], fmt="text")
    assert "* * *" not in c.text and "---" not in c.text and "2023 | 2024 | 2025" in c.text


def test_repairs_dehyphenate_and_join_and_are_counted():
    c = _pdf(["The transla-\ntion of this\nsentence ends here."])
    assert c.text == "The translation of this sentence ends here."
    assert c.repaired == {"hyphenation": 1, "joined_lines": 1}


def test_off_switch_skips_removals_but_keeps_repairs(monkeypatch):
    monkeypatch.setenv("IMPORT_CLEANING", "0")
    c = _pdf([f"HDR\nwor-\nds {i}" for i in range(6)])
    assert "HDR" in c.text and "words" in c.text and c.removed == []


def test_skip_parameter():
    pages = [f"HDR\nBody {i}." for i in range(6)]
    assert "HDR" in clean(pages, fmt="pdf", skip={"page_furniture"}).text


def test_line_hashes_sorted_unique_and_short_lines_only():
    h = line_hashes(["A  line\na line\n" + "x" * 130])
    assert len(h) == 8 and h == line_hash("a line")


def test_sentence_in_header_zone_differing_only_in_digits_is_kept():
    pages = [f"Chapter {i} opens on a quiet morning.\nMore body text here.\nAnd more." for i in range(1, 7)]
    assert all(f"Chapter {i} opens on a quiet morning." in _pdf(pages).text for i in range(1, 7))


def test_edges_trims_menu_and_footer():
    lines = ["Inicio", "Noticias", "Compartir en Facebook", "12 de marzo de 2025",
             BODY_ES,
             "Noticias relacionadas", "© 2025 El Diario. Todos los derechos reservados."]
    c = clean(["\n".join(lines)], fmt="html", lang="es")
    assert c.text == BODY_ES and [r.step for r in c.removed] == ["edges"]


def test_edges_never_removes_more_than_30_percent():
    poem = "\n".join(["Verde que te quiero verde"] * 8 + [BODY_ES])
    assert clean([poem], fmt="html", lang="es").text.startswith("Verde")


def test_edges_runs_without_a_phrase_list_for_the_language():
    c = clean(["Home\nMenu\n" + BODY_EN], fmt="html", lang="pt")
    assert c.text == BODY_EN


def test_edges_keeps_a_long_sentence_with_a_chrome_phrase():
    last = "The museum will share its digitised photographs with every school in the region."
    assert clean([BODY_EN + "\n" + last], fmt="html", lang="en").text.endswith(last)


def test_edges_removes_a_long_cookie_notice():
    notice = ("We use cookies to improve your experience on our website, to analyse traffic and to show you "
              "relevant content. By continuing to browse you accept their use.")
    assert len(notice) > 140
    c = clean([notice + "\n" + "\n".join([BODY_EN] * 3)], fmt="html", lang="en")
    assert notice not in c.text and c.removed[0].lines == [notice]


def test_edges_removes_copyright_glued_to_the_year():
    footer = "©2025 Regional Heritage Council, registered charity no. 1234567, 10 High Street"
    c = clean(["\n".join([BODY_EN] * 4 + [footer])], fmt="html", lang="en")
    assert footer not in c.text and c.removed[0].lines == [footer]


@pytest.mark.parametrize("lang,sentence", [("en", "By then it was over."), ("es", "Por fin llegó la primavera."),
                                           ("it", "Di notte pioveva.")])
def test_edges_keeps_short_sentences_that_look_like_bylines(lang, sentence):
    assert clean(["\n".join([BODY_EN] * 3 + [sentence])], fmt="html", lang=lang).text.endswith(sentence)


def test_edges_only_for_html():
    assert clean(["Inicio\n" + BODY_ES], fmt="text", lang="es").text.startswith("Inicio")


def _extract(data: bytes) -> str:
    return ingest.extract_html_raw(data)[1]


FIXTURE_CASES = [
    ("es-news.html", "se ejecutarán por fases para reducir las molestias a los vecinos.",
     ["Movilidad\n", "Leer más: la nueva línea de autobús nocturno"]),
    ("it-blog.html", "non abbiate paura di sporcarvi le mani.",
     ["Leggi anche", "Articoli correlati", "Iscriviti alla newsletter"]),
    ("en-institution.html", "published on the funding pages of this website.",
     ["Related links", "Tags: archives"]),
]


@pytest.mark.parametrize("name,kept,gone", FIXTURE_CASES)
def test_real_pages(name, kept, gone):
    text = _extract((FIXTURES / name).read_bytes())
    c = clean([text], fmt="html", lang=name[:2])
    assert kept in c.text and not any(g in c.text for g in gone)


# --------------------------------------------------------------------------- storage (db v16)
@pytest.fixture()
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    db.migrate(c)
    yield c
    c.close()


@pytest.fixture()
def corpus(conn):
    cid = conn.execute("INSERT INTO corpora (name, lang) VALUES ('work', 'es')").lastrowid
    return conn.execute("SELECT * FROM corpora WHERE id=?", (cid,)).fetchone()


def test_add_document_stores_line_hashes_and_host(conn, corpus):
    r = importer.add_document(conn, corpus, "T", BODY_ES, "https://Ex.com/p", "url", line_hashes=b"\x01" * 8)
    row = conn.execute("SELECT line_hashes, host FROM documents WHERE id=?", (r["id"],)).fetchone()
    assert row["line_hashes"] == b"\x01" * 8 and row["host"] == "ex.com"


def test_add_document_without_line_hashes_and_not_a_url(conn, corpus):
    r = importer.add_document(conn, corpus, "T", BODY_ES, "https://ex.com/report.pdf", "file")
    row = conn.execute("SELECT line_hashes, host FROM documents WHERE id=?", (r["id"],)).fetchone()
    assert row["line_hashes"] is None and row["host"] == ""


@pytest.mark.parametrize(("source", "kind", "host"), [
    ("https://WWW.Example.com/a/b", "url", "www.example.com"), ("https://Ex.com:8080/a", "url", "ex.com"),
    ("http://example.org", "url", "example.org"), ("https://ex.com/x.pdf", "file", ""), ("", "paste", "")])
def test_host_of(source, kind, host):
    assert metadata.host_of(source, kind) == host


# --------------------------------------------------------------------------- site furniture
def test_site_line_in_edge_zone_removed():
    counts = Counter({line_hash("Suscríbete a nuestro boletín"): 2})
    page = "\n".join(["Suscríbete a nuestro boletín", *BODY_LINES_ES])   # 8 body lines
    c = clean([page], fmt="html", lang="es", site_counts=counts, skip={"edges"})
    assert "Suscríbete" not in c.text and c.removed[0].step == "site_furniture"


def test_site_line_mid_article_kept():
    counts = Counter({line_hash("Aviso legal estándar."): 5})
    page = "\n".join([*BODY_LINES_ES[:4], "Aviso legal estándar.", *BODY_LINES_ES[4:]])
    assert "Aviso legal" in clean([page], fmt="html", site_counts=counts, skip={"edges"}).text


def test_needs_two_other_pages():
    counts = Counter({line_hash("Menú principal"): 1})
    assert "Menú principal" in clean(["Menú principal\n" + BODY_ES], fmt="html", site_counts=counts,
                                     skip={"edges"}).text


def test_site_furniture_only_for_html():
    counts = Counter({line_hash("Menú principal"): 5})
    assert "Menú principal" in clean(["Menú principal\n" + BODY_ES], fmt="text", site_counts=counts).text


@pytest.fixture()
def other_corpus(conn):
    cid = conn.execute("INSERT INTO corpora (name, lang) VALUES ('other', 'es')").lastrowid
    return conn.execute("SELECT * FROM corpora WHERE id=?", (cid,)).fetchone()


def _doc(conn, corpus_id, host, hashes, source="", deleted=False):
    conn.execute("INSERT INTO documents (corpus_id, title, text, text_hash, source, host, line_hashes, deleted_at) "
                 "VALUES (?, 'T', 'x', ?, ?, ?, ?, ?)",
                 (corpus_id, f"h{conn.execute('SELECT COUNT(*) FROM documents').fetchone()[0]}", source, host,
                  hashes, "2026-11-27" if deleted else None))


def test_site_counts_reads_same_corpus_and_host_only(conn, corpus, other_corpus):
    H, other = line_hash("Menú principal"), line_hash("Portada")
    _doc(conn, corpus["id"], "ex.com", H + other, "https://ex.com/a")
    _doc(conn, corpus["id"], "ex.com", H, "https://ex.com/b")
    _doc(conn, other_corpus["id"], "ex.com", H)
    _doc(conn, corpus["id"], "other.com", H)
    _doc(conn, corpus["id"], "ex.com", H, deleted=True)
    _doc(conn, corpus["id"], "ex.com", None)
    counts = site_counts(conn, corpus["id"], "ex.com")
    assert counts[H] == 2 and counts[other] == 1
    assert site_counts(conn, corpus["id"], "ex.com", exclude_source="https://ex.com/a")[H] == 1


# --------------------------------------------------------------------------- extraction (ingest)
def _pdf_bytes(pages: list[str]) -> bytes:
    return make_pdf([lines(50, 750, p.split("\n")) for p in pages])


PDF_PAGES = [f"HDR\nBody sentence number {i} of this short test document." for i in range(6)]


def test_read_file_pdf_reports_removals():
    r = ingest.read_file("a.pdf", _pdf_bytes(PDF_PAGES))
    assert "HDR" not in r["text"] and r["removed"][0]["step"] == "page_furniture"
    assert r["fmt"] == "pdf" and len(r["raw"]) == 6 and len(bytes.fromhex(r["line_hashes"])) % 8 == 0
    assert r["removed"][0]["lines"] == ["HDR"] * 6 and "quality" in r


def test_read_file_clean_false_keeps_todays_text():
    # alignment and job analysis: running headers still go (as before cleaning existed), nothing is reported
    r = ingest.read_file("a.pdf", _pdf_bytes(PDF_PAGES), clean=False)
    assert "HDR" not in r["text"] and "Body sentence number 5" in r["text"]
    assert r["removed"] == [] and r["line_hashes"] == ""


def test_read_file_clean_false_keeps_noise():
    r = ingest.read_file("a.txt", "Una línea de texto normal y corriente.\n* * *\nOtra más.".encode(), clean=False)
    assert "* * *" in r["text"] and r["removed"] == [] and r["fmt"] == "text"


def test_read_file_text_removes_noise():
    r = ingest.read_file("a.txt", "Una línea de texto normal y corriente.\n* * *\nOtra línea más.".encode())
    assert "* * *" not in r["text"] and r["removed"] == [{"step": "noise", "lines": ["* * *"]}]


def test_import_cleaning_off_repairs_pdf_only(monkeypatch):
    monkeypatch.setenv("IMPORT_CLEANING", "0")
    r = ingest.read_file("a.pdf", _pdf_bytes(PDF_PAGES))
    assert "HDR" in r["text"] and r["removed"] == []


def test_spreadsheet_not_cleaned():
    r = ingest.read_file("t.csv", "Texto,Notas\nEl contrato se firma mañana,---\nLas partes acuerdan,ok\n".encode(),
                         columns="1,2")
    assert "---" in r["text"].splitlines() and r["removed"] == [] and r["fmt"] == "text"
    assert r["line_hashes"] == ""


def test_all_chrome_page_kept_with_warning():
    html = ("<html><body><article><p>Inicio</p><p>Noticias</p><p>2024 — 2025 — 2026</p>"
            "<p>1.234.567 · 8.910.111 · 12/13/14 · 15 16 17</p></article></body></html>").encode()
    r = ingest.read_file("a.html", html)
    assert "Inicio" in r["text"] and "1.234.567" in r["text"] and r["removed"] == []
    assert "Cleaning would have removed almost everything, so the text is kept as extracted: check it." \
        in r["warnings"]


def test_cleaning_summary():
    removed = [{"step": "page_furniture", "lines": ["a"] * 10}, {"step": "edges", "lines": ["b"] * 4}]
    assert ingest.cleaning_summary(removed) == \
        "Cleaning removed 14 lines (repeated on every page, site menus and links)."
    assert ingest.cleaning_summary([{"step": "noise", "lines": ["-"]}]) == \
        "Cleaning removed 1 line (lines without words)."
    assert ingest.cleaning_summary([]) is None


def test_import_url_stores_hashes_and_reports_summary(client, serve):  # noqa: F811  (fixture)
    body = "El contrato de arrendamiento se firma en la oficina de la empresa y todos los socios deben asistir."
    urls = [f"https://site.example/n{i}" for i in range(3)]
    for i, url in enumerate(urls):
        serve[url.removeprefix("https://")] = (
            f"<html><head><title>Noticia {i}</title></head><body><article><p>Síguenos en redes</p>"
            f"<p>{body.replace('empresa', f'empresa {i}')}</p><p>{body.replace('socios', f'socios {i}')}</p>"
            "</article></body></html>").encode()
    cid = make_corpus(client, "es", "site-clean")
    for url in urls:                                       # one at a time: each sees the ones before it
        job_id = client.post(f"/api/corpora/{cid}/urls", json={"urls": [url]}).json()[0]["job_id"]
        jobs = {j["id"]: j for j in wait_for_jobs(client, cid)}
    with db.session() as conn:
        rows = conn.execute("SELECT source, text, line_hashes FROM documents WHERE corpus_id=? ORDER BY id",
                            (cid,)).fetchall()
    assert [r["source"] for r in rows] == urls and all(r["line_hashes"] for r in rows)
    blob = rows[0]["line_hashes"]
    assert line_hash("Síguenos en redes") in {blob[i:i + 8] for i in range(0, len(blob), 8)}
    assert "Síguenos" not in rows[2]["text"]
    assert "Cleaning removed 1 line (repeated on other pages of this site)." in jobs[job_id]["result"]["warnings"]


def test_ocr_pages_cleaned_unless_clean_false(monkeypatch):
    import corpora.ocr as ocr
    monkeypatch.setattr(ocr, "ocr_pdf", lambda data, lang, progress: ocr.OcrResult(PDF_PAGES, 95.0))
    empty = make_pdf([[]])
    assert "HDR" not in ingest.read_file("scan.pdf", empty)["text"]
    assert "HDR" in ingest.read_file("scan.pdf", empty, clean=False)["text"]   # OCR text was never cleaned
