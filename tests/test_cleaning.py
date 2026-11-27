"""Import cleaning (cleaning.py): page furniture, noise, repairs and line hashes."""

import pytest

from corpora.cleaning import clean, line_hash, line_hashes


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
