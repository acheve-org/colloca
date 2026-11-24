"""Glossary import: CSV/TSV, Excel and TBX (2008 and 2019 structures) into the termbase.

The mirror of `termexport`: what it writes (`approved`, `admitted`, `superseded`, `forbidden`, `candidate`; TBX
administrativeStatus, a candidate having none) is read back the same way.

An import is two steps on the same file: a dry run reports what would be added, skipped as duplicates and rejected
(with the reason per row); the same call with `dry_run=False` writes the rows to add. Nothing is stored in between.
Row validation is `termbase.clean` and `termbase.check_consistency`, the rules of the entry form.
"""
import csv
import io
import re
import sqlite3
from collections import Counter

import defusedxml
from defusedxml import ElementTree as SafeET
from openpyxl import load_workbook

from . import nlp, termbase
from .termexport import _FORMULA_START

MAX_BYTES = 25 * 1024 * 1024
MAX_ROWS = 100_000
REPORT_ROWS = 200          # rejected / duplicate rows listed in a report (the counts are always complete)
PREVIEW_ROWS = 10

FIELDS = ("src_term", "tgt_term", "pos", "status", "domain", "definition", "notes", "context",
          "src_lang", "tgt_lang", "src_gender", "src_number", "src_note", "tgt_gender", "tgt_number", "tgt_note",
          "concept")
# Header words (lower-case) recognised when guessing the mapping: the labels `termexport` writes, plus common ones.
_HEADERS = {
    "src_term": ("source term", "source", "term", "src", "termino", "término", "termine"),
    "tgt_term": ("translation", "target term", "target", "tgt", "traduccion", "traducción", "traduzione"),
    "pos": ("part of speech", "pos"),
    "status": ("status", "estado", "stato"),
    "domain": ("domain", "subject field", "subject", "field", "dominio", "ambito", "ámbito"),
    "definition": ("definition", "definición", "definizione"),
    "notes": ("notes", "note", "notas", "comment", "comments"),
    "context": ("example", "context", "ejemplo", "esempio"),
    "src_lang": ("source language", "src lang", "source lang"),
    "tgt_lang": ("target language", "tgt lang", "target lang"),
    "src_gender": ("source gender",), "src_number": ("source number",), "src_note": ("source note",),
    "tgt_gender": ("translation gender", "target gender"), "tgt_number": ("translation number", "target number"),
    "tgt_note": ("translation note", "target note"),
    "concept": ("concept", "concept id"),      # rows with the same value are synonyms of one concept
}
_STATUS_WORDS = {
    "approved": "approved", "preferred": "approved", "admitted": "admitted", "superseded": "superseded",
    "forbidden": "forbidden", "deprecated": "forbidden", "candidate": "candidate", "proposed": "candidate"}
_TBX_STATUS = {"preferredterm": "approved", "admittedterm": "admitted", "supersededterm": "superseded",
               "deprecatedterm": "forbidden"}
_XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"


class ImportFailure(ValueError):
    """The file cannot be read at all (as opposed to a row that is rejected)."""


def kind_of(filename: str) -> str:
    name = (filename or "").lower()
    for ext, kind in ((".xlsx", "sheet"), (".csv", "sheet"), (".tsv", "sheet"), (".txt", "sheet"), (".tbx", "tbx"),
                      (".xml", "tbx")):
        if name.endswith(ext):
            return kind
    raise ImportFailure("Upload a .xlsx, .csv, .tsv or .tbx file")


def _check_size(data: bytes) -> None:
    if not data:
        raise ImportFailure("The file is empty")
    if len(data) > MAX_BYTES:
        raise ImportFailure(f"The file is larger than {MAX_BYTES // (1024 * 1024)} MB")


# --------------------------------------------------------------------------- spreadsheets
def _decode(data: bytes) -> str:
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def _csv_rows(data: bytes, filename: str) -> list[list[str]]:
    text = _decode(data)
    sample = text[:8192]
    if filename.lower().endswith(".tsv"):
        delimiter = "\t"
    else:
        try:
            delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
        except csv.Error:
            delimiter = ","
    rows = []
    for row in csv.reader(io.StringIO(text, newline=""), delimiter=delimiter):
        # termexport writes a leading apostrophe in front of text that looks like a formula: take it off again
        rows.append([c[1:] if c[:1] == "'" and c[1:2] and c[1] in _FORMULA_START else c for c in row])
        if len(rows) > MAX_ROWS:
            raise ImportFailure(f"More than {MAX_ROWS} rows: split the file")
    return rows


def _xlsx_rows(data: bytes) -> list[list[str]]:
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:    # a corrupt or non-Excel file: openpyxl raises several unrelated types
        raise ImportFailure("The file is not a readable .xlsx workbook") from exc
    try:
        ws = wb.worksheets[0]
        rows = []
        for values in ws.iter_rows(values_only=True):
            rows.append(["" if v is None else (str(int(v)) if isinstance(v, float) and v.is_integer() else str(v))
                         for v in values])
            if len(rows) > MAX_ROWS:
                raise ImportFailure(f"More than {MAX_ROWS} rows: split the file")
    finally:
        wb.close()
    return rows


def read_sheet(data: bytes, filename: str) -> list[list[str]]:
    _check_size(data)
    rows = _xlsx_rows(data) if filename.lower().endswith(".xlsx") else _csv_rows(data, filename)
    return [r for r in rows if any(c.strip() for c in r)] if rows else []


def guess_mapping(first_row: list[str]) -> tuple[bool, dict[str, int]]:
    """(the first row looks like a header, {field: column index})."""
    mapping: dict[str, int] = {}
    for index, cell in enumerate(first_row):
        word = " ".join(cell.lower().split())
        for field, words in _HEADERS.items():
            if word in words and field not in mapping:
                mapping[field] = index
                break
    return bool(mapping), mapping


def preview(data: bytes, filename: str) -> dict:
    """What the import dialog shows: the kind of file and, for a spreadsheet, the first rows and a guessed mapping."""
    if kind_of(filename) == "tbx":
        _check_size(data)
        return {"kind": "tbx"}
    rows = read_sheet(data, filename)
    if not rows:
        raise ImportFailure("The file has no rows")
    header, mapping = guess_mapping(rows[0])
    if not header:
        mapping = {"src_term": 0, **({"tgt_term": 1} if len(rows[0]) > 1 else {})}
    return {"kind": "sheet", "rows": rows[:PREVIEW_ROWS], "columns": max(len(r) for r in rows[:PREVIEW_ROWS]),
            "total_rows": len(rows) - (1 if header else 0), "header": header, "mapping": mapping}


def sheet_records(data: bytes, filename: str, mapping: dict[str, int], header: bool) -> list[dict]:
    if "src_term" not in mapping:
        raise ImportFailure("Map a column to the source term")
    for field, column in mapping.items():
        if field not in FIELDS or not isinstance(column, int) or column < 0:
            raise ImportFailure(f"Invalid column mapping for {field}")
    rows = read_sheet(data, filename)
    records = []
    for number, row in enumerate(rows, 1):
        if header and number == 1:
            continue
        record: dict = {"row": number}
        for field, column in mapping.items():
            record[field] = row[column].strip() if column < len(row) else ""
        records.append(record)
    return records


# --------------------------------------------------------------------------- TBX
def _local(node) -> str:
    tag = node.tag
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _lang(value: str | None) -> str:
    return (value or "").split("-")[0].split("_")[0].lower()


def _text(node) -> str:
    return " ".join("".join(node.itertext()).split())


def _descrips(node, kind: str, *, deep: bool = False) -> list[str]:
    found = node.iter() if deep else list(node)
    return [t for n in found if _local(n) == "descrip" and n.get("type") == kind and (t := _text(n))]


def _term_sections(lang_sec) -> list[dict]:
    """The terms of a language section (`tig`/`ntig` in 2008, `termSec` in 2019) with their data categories."""
    out = []
    for sec in lang_sec:
        if _local(sec) not in ("tig", "ntig", "termSec"):
            continue
        term = next((n for n in sec.iter() if _local(n) == "term"), None)
        if term is None or not _text(term):
            continue
        notes: dict = {}
        for n in sec.iter():
            if _local(n) == "termNote" and n.get("type"):
                notes.setdefault(n.get("type"), _text(n))
        out.append({
            "term": _text(term), "pos": notes.get("partOfSpeech", ""), "admin": notes.get("administrativeStatus", ""),
            "gender": notes.get("grammaticalGender", ""),
            "context": next(iter(_descrips(sec, "context", deep=True)), ""),
            "definition": next(iter(_descrips(sec, "definition", deep=True)), ""),
            "notes": "\n".join(t for n in sec.iter() if _local(n) == "note" and (t := _text(n)))})
    return out


def _parse_tbx(data: bytes):
    _check_size(data)
    try:
        # entities are refused (entity bombs, external entities); a DOCTYPE that merely names a DTD is harmless
        # because the parser never fetches it
        root = SafeET.fromstring(data, forbid_entities=True, forbid_external=True)
    except defusedxml.EntitiesForbidden as exc:
        raise ImportFailure("The file defines XML entities, which are refused for safety") from exc
    except defusedxml.ExternalReferenceForbidden as exc:
        raise ImportFailure("The file refers to an external resource, which is refused for safety") from exc
    except defusedxml.DefusedXmlException as exc:
        raise ImportFailure("The XML in this file is refused for safety") from exc
    except SafeET.ParseError as exc:
        raise ImportFailure(f"The file is not well-formed XML ({exc})") from exc
    if _local(root) not in ("tbx", "martif"):
        raise ImportFailure("The file is not TBX (no <tbx> or <martif> root element)")
    entries = []
    for n, entry in enumerate((e for e in root.iter() if _local(e) in ("termEntry", "conceptEntry")), 1):
        sections: dict = {}
        for sec in entry:
            if _local(sec) in ("langSet", "langSec"):
                lang = _lang(sec.get(_XML_LANG) or sec.get("lang"))
                section = sections.setdefault(lang, {"terms": [], "definition": "", "notes": ""})
                section["terms"] += _term_sections(sec)
                section["definition"] = section["definition"] or next(iter(_descrips(sec, "definition")), "")
        entries.append({
            "row": entry.get("id") or f"entry {n}", "sections": sections,
            "domain": next(iter(_descrips(entry, "subjectField")), ""),
            "definition": next(iter(_descrips(entry, "definition")), "")})
    return root, entries


def _detect_pair(root, entries, src_lang: str, tgt_lang: str) -> tuple[str, str]:
    counts = Counter(lang for e in entries for lang in e["sections"] if lang in nlp.SUPPORTED)
    src = src_lang or (_lang(root.get(_XML_LANG)) if _lang(root.get(_XML_LANG)) in counts else "")
    src = src or (counts.most_common(1)[0][0] if counts else "")
    tgt = tgt_lang or next((lang for lang, _ in counts.most_common() if lang != src), "")
    if not src or not tgt:
        raise ImportFailure("Could not find two supported languages in the file: choose the language pair")
    return src, tgt


def tbx_records(data: bytes, src_lang: str = "", tgt_lang: str = "") -> tuple[list[dict], str, str]:
    root, entries = _parse_tbx(data)
    src_lang, tgt_lang = _detect_pair(root, entries, src_lang, tgt_lang)
    records = []
    for entry in entries:
        sources = entry["sections"].get(src_lang, {}).get("terms", [])
        targets = entry["sections"].get(tgt_lang, {}).get("terms", [])
        base = {"row": entry["row"], "src_lang": src_lang, "tgt_lang": tgt_lang, "domain": entry["domain"],
                "concept": f"tbx:{entry['row']}"}              # the terms of one entry are one concept
        if not sources:
            records.append({**base, "src_term": "", "tgt_term": targets[0]["term"] if targets else ""})
            continue
        definition = (entry["sections"][src_lang]["definition"] or entry["definition"]
                      or next((s["definition"] for s in sources if s["definition"]), ""))
        for src in sources:
            for tgt in targets or [None]:
                pos = (tgt or {}).get("pos") or src["pos"]
                status = _TBX_STATUS.get(re.sub(r"-admn-sts$", "", (tgt or {}).get("admin", "")).lower(), "candidate")
                records.append({
                    **base, "src_term": src["term"], "tgt_term": tgt["term"] if tgt else "",
                    "pos": pos if pos in termbase.POS_VALUES else ("other" if pos else ""),
                    "status": status if tgt else "candidate", "definition": definition,
                    "notes": (tgt or src)["notes"], "context": src["context"],
                    "src_gender": src["gender"], "tgt_gender": (tgt or {}).get("gender", ""),
                    "src_note": src["notes"] if tgt else ""})
    return records, src_lang, tgt_lang


# --------------------------------------------------------------------------- dry run and apply
_ASCII_FOLD = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")


def _key(project_id, src_lang, tgt_lang, src_term, tgt_term) -> tuple:
    # SQLite's lower() (used by idx_terms_unique) folds ASCII only, so the same fold decides what is a duplicate;
    # a smarter one would let a row through that the index then refuses.
    return project_id or 0, src_lang, tgt_lang, src_term.translate(_ASCII_FOLD), tgt_term.translate(_ASCII_FOLD)


def plan(conn: sqlite3.Connection, records: list[dict], *, project_id: int | None, src_lang: str, tgt_lang: str,
         default_status: str = "candidate") -> dict:
    """Classify every record as to add, duplicate or rejected. `src_lang`/`tgt_lang` fill the rows that carry none."""
    seen = {_key(*r) for r in conn.execute(
        "SELECT project_id, src_lang, tgt_lang, src_term, tgt_term FROM terms "
        "WHERE IFNULL(project_id, 0)=? AND deleted_at IS NULL",
        (project_id or 0,))}
    add, duplicates, rejected = [], [], []
    for rec in records:
        shown = {"row": rec["row"], "src_term": rec.get("src_term", ""), "tgt_term": rec.get("tgt_term", "")}
        try:
            fields = {k: rec[k] for k in FIELDS if rec.get(k)}
            fields["src_lang"] = (fields.get("src_lang") or src_lang).lower()
            fields["tgt_lang"] = (fields.get("tgt_lang") or tgt_lang).lower()
            word = (fields.pop("status", "") or default_status).strip().lower()
            if word not in _STATUS_WORDS:
                raise termbase.TermError(
                    f"Unknown status '{word}' (use {', '.join(termbase.STATUSES)})")
            fields["status"] = _STATUS_WORDS[word]
            fields.setdefault("src_term", "")
            fields.setdefault("tgt_term", "")
            group = fields.pop("concept", "")
            entry = termbase.clean(fields)
            entry.setdefault("status", fields["status"])
            termbase.check_consistency(entry)
            if group:
                entry["group"] = str(group)
        except termbase.TermError as exc:
            rejected.append({**shown, "reason": str(exc)})
            continue
        key = _key(project_id, entry["src_lang"], entry["tgt_lang"], entry["src_term"], entry["tgt_term"])
        if key in seen:
            duplicates.append({**shown, "reason": "already in the termbase or repeated in the file"})
            continue
        seen.add(key)
        add.append((rec["row"], entry))
    return {"add": add, "duplicates": duplicates, "rejected": rejected}


def report(result: dict, *, fmt: str, src_lang: str, tgt_lang: str, applied: bool) -> dict:
    return {
        "format": fmt, "src_lang": src_lang, "tgt_lang": tgt_lang, "applied": applied,
        "to_add": len(result["add"]), "duplicates": len(result["duplicates"]), "rejected": len(result["rejected"]),
        "total": len(result["add"]) + len(result["duplicates"]) + len(result["rejected"]),
        "sample": [{"row": row, "src_term": e["src_term"], "tgt_term": e["tgt_term"], "status": e["status"]}
                   for row, e in result["add"][:PREVIEW_ROWS]],
        "duplicate_rows": result["duplicates"][:REPORT_ROWS], "rejected_rows": result["rejected"][:REPORT_ROWS]}


def apply(conn: sqlite3.Connection, result: dict, project_id: int | None) -> int:
    """Insert the rows to add in one transaction; returns how many were stored."""
    before = conn.total_changes
    for _, e in result["add"]:
        termbase.drop_trashed_twin(conn, project_id, e["src_lang"], e["tgt_lang"], e["src_term"], e["tgt_term"])
    # the file's own grouping (a TBX entry, a "Concept" column) -> the concept id it became
    groups: dict[str, int] = {}
    for _, e in result["add"]:
        group = e.get("group")
        try:
            concept = termbase.assign_concept(conn, project_id, e["src_lang"], e["tgt_lang"], e["src_term"],
                                              groups.get(group) if group else None)
        except termbase.TermError:                # the first row of the group was not stored: start from the term
            concept = termbase.assign_concept(conn, project_id, e["src_lang"], e["tgt_lang"], e["src_term"])
        if group:
            groups.setdefault(group, concept)
        conn.execute(
            """INSERT OR IGNORE INTO terms (project_id, src_lang, tgt_lang, src_term, tgt_term, pos, status, domain,
                                            definition, notes, context, context_source, origin, concept_id,
                                            src_gender, src_number, tgt_gender, tgt_number, src_note, tgt_note)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'manual',?,?,?,?,?,?,?)""",
            (project_id, e["src_lang"], e["tgt_lang"], e["src_term"], e["tgt_term"], e.get("pos", ""), e["status"],
             e.get("domain", ""), e.get("definition", ""), e.get("notes", ""), e.get("context", ""),
             e.get("context_source", ""), concept, e.get("src_gender", ""), e.get("src_number", ""),
             e.get("tgt_gender", ""), e.get("tgt_number", ""), e.get("src_note", ""), e.get("tgt_note", "")))
    return conn.total_changes - before


def run(conn, data: bytes, filename: str, *, project_id: int | None, src_lang: str = "", tgt_lang: str = "",
        mapping: dict[str, int] | None = None, header: bool = True, default_status: str = "candidate",
        dry_run: bool = True) -> dict:
    """Read the file, classify its rows and, unless `dry_run`, store the new ones."""
    kind = kind_of(filename)
    if src_lang and src_lang not in nlp.SUPPORTED or tgt_lang and tgt_lang not in nlp.SUPPORTED:
        raise ImportFailure(f"Languages must be one of {', '.join(nlp.SUPPORTED)}")
    if kind == "tbx":
        records, src_lang, tgt_lang = tbx_records(data, src_lang, tgt_lang)
    else:
        if not src_lang:
            raise ImportFailure("Choose the source language")
        default = tgt_lang or termbase.other_lang(src_lang)
        if not default:
            raise ImportFailure("A termbase needs two languages: add a second one in the Languages screen")
        tgt_lang = default
        records = sheet_records(data, filename, mapping or {}, header)
    if src_lang == tgt_lang:
        raise ImportFailure("The target language must differ from the source language")
    result = plan(conn, records, project_id=project_id, src_lang=src_lang, tgt_lang=tgt_lang,
                  default_status=default_status)
    if not dry_run:
        apply(conn, result, project_id)
    return report(result, fmt=kind, src_lang=src_lang, tgt_lang=tgt_lang, applied=not dry_run)
