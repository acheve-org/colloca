"""Saved job reports (T11): keep the report of an analysis, reopen it later, download all of it as one workbook."""
import io
import json
import sqlite3

from openpyxl import Workbook
from openpyxl.styles import Font

# The tables of a report, in workbook order: sheet name, key in the report, (column title, row key) pairs.
_SHEETS = (
    ("Termbase terms", "known_terms", (("Term", "item"), ("Times", "occurrences"), ("First occurrence", "example"),
                                       ("Translations", "_translations"))),
    ("Gaps", "gaps", (("Lemma", "item"), ("POS", "pos"), ("In text", "job_freq"), ("In corpus", "corpus_freq"),
                      ("Termbase", "termbase"))),
    ("Key terms", "key_terms", (("Lemma", "item"), ("POS", "pos"), ("In text", "job_freq"),
                                ("In corpus", "corpus_freq"), ("Base per million", "base_per_million"),
                                ("Log ratio", "log_ratio"), ("LL", "ll"), ("Termbase", "termbase"))),
    ("Phrases", "phrases", (("Phrase", "item"), ("In text", "job_freq"), ("In corpus", "corpus_freq"),
                            ("Termbase", "termbase"))),
)
_SUMMARY = (
    ("Words in the text", "words"), ("Content words", "content_words"), ("Distinct lemmas", "distinct_lemmas"),
    ("Sentences", "sentences"), ("Language check", "language_check"),
    ("Covered content words (%)", "coverage_tokens_pct"), ("Content words seen at all (%)", "coverage_seen_pct"),
    ("Distinct lemmas covered (%)", "coverage_types_pct"), ("Gaps (distinct words below the threshold)",
                                                            "uncovered_types"),
    ("Termbase terms found", "termbase_terms_found"), ("Termbase size", "termbase_size"),
    ("Corpus words", "corpus_words"), ("Corpus filtered by document filter", "corpus_filtered"),
    ("Coverage threshold (corpus occurrences)", "min_corpus_freq"), ("Key term threshold (times in text)",
                                                                   "min_job_freq"),
    ("Compared with", "reference"),
)


def _cell(value):
    """A value for a workbook cell: text stays text (a scraped term like =1+1 must never become a formula)."""
    return value if value is not None else ""


def _known(row: dict) -> dict:
    translations = "; ".join(f"{t['term'] or '—'} [{t['status']}]" for t in row.get("translations", []))
    return {**row, "_translations": translations}


def to_xlsx(report: dict, title: str = "", source: str = "") -> bytes:
    """The whole report in one workbook: a Summary sheet and one sheet per table."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    ws.append(["Report", title or "Job report"])
    ws.append(["Analysed text", source or "pasted text"])
    ws.append([])
    summary = report.get("summary", {})
    for label, key in _SUMMARY:
        value = summary.get(key)
        ws.append([label, "yes" if value is True else "no" if value is False else _cell(value)])
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str):
                c.data_type = "s"
    for c in ws["A"]:
        c.font = Font(bold=True)
    ws.column_dimensions["A"].width = 46
    ws.column_dimensions["B"].width = 40
    for name, key, columns in _SHEETS:
        sheet = wb.create_sheet(name)
        sheet.append([label for label, _ in columns])
        for c in sheet[1]:
            c.font = Font(bold=True)
        for row in report.get(key, []):
            row = _known(row) if key == "known_terms" else row
            sheet.append([_cell(row.get(k)) for _, k in columns])
            for c in sheet[sheet.max_row]:
                if isinstance(c.value, str):
                    c.data_type = "s"
        sheet.freeze_panes = "A2"
        for letter, width in zip("ABCDEFGH", (30, 12, 12, 12, 18, 12, 10, 24), strict=False):
            sheet.column_dimensions[letter].width = width
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def save(conn: sqlite3.Connection, corpus_id: int, report: dict, title: str, source: str, params: dict,
         text: str | None) -> int:
    return conn.execute(
        "INSERT INTO job_reports (corpus_id, title, source, params, payload, text) VALUES (?,?,?,?,?,?)",
        (corpus_id, title.strip()[:200] or "Job report", source[:300], json.dumps(params), json.dumps(report),
         text)).lastrowid or 0


def listing(conn: sqlite3.Connection, corpus_id: int) -> list[dict]:
    rows = conn.execute("""SELECT id, title, source, created, params, payload, text IS NOT NULL AS has_text
                           FROM job_reports WHERE corpus_id=? ORDER BY created DESC, id DESC""", (corpus_id,))
    out = []
    for r in rows:
        summary = json.loads(r["payload"]).get("summary", {})
        out.append({"id": r["id"], "title": r["title"], "source": r["source"], "created": r["created"],
                    "has_text": bool(r["has_text"]), "params": json.loads(r["params"]),
                    "words": summary.get("words"), "coverage_tokens_pct": summary.get("coverage_tokens_pct"),
                    "gaps": summary.get("uncovered_types"), "terms_found": summary.get("termbase_terms_found")})
    return out


def get(conn: sqlite3.Connection, report_id: int):
    """The stored row (corpus_id, title, source, created, params, payload and text), or None."""
    row = conn.execute("""SELECT r.* FROM job_reports r JOIN corpora c ON c.id=r.corpus_id
                          WHERE r.id=? AND c.deleted_at IS NULL""", (report_id,)).fetchone()
    return row


def delete(conn: sqlite3.Connection, report_id: int) -> bool:
    return conn.execute("DELETE FROM job_reports WHERE id=?", (report_id,)).rowcount > 0
