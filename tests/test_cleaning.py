"""Import cleaning (cleaning.py): page furniture, noise, repairs and line hashes."""

import sqlite3
from pathlib import Path

import pytest

from corpora import db, importer
from corpora.cleaning import clean, line_hash, line_hashes

FIXTURES = Path(__file__).parent / "fixtures" / "web"
BODY_ES = ("El pleno aprobó ayer el nuevo plan de movilidad para toda la ciudad. Las obras empezarán en primavera "
           "y durarán dos años. Los vecinos podrán presentar alegaciones durante un mes.")
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
    import trafilatura  # switch to ingest.extract_html_raw in Task 5
    return trafilatura.extract(data, include_comments=False, include_tables=True, include_links=False,
                               deduplicate=True)


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
