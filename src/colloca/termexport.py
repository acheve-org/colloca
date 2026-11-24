"""Termbase exports: CSV, Excel and TBX (TermBase eXchange, ISO 30042).

TBX comes in two flavours because CAT tools differ in what they read:
  version 3  ISO 30042:2019 structure (tbx / conceptEntry / langSec / termSec), as in current TBX-Basic;
  version 2  ISO 30042:2008 structure (martif / termEntry / langSet / tig), the one most CAT tools read.
Both use TBX-Basic data categories only. One concept groups the rows that share a concept id (by default all rows
with the same source term): its source terms and its translations become the terms of the two language sections.
TBX-Basic has a gender category (grammaticalGender) but none for number, so number is written to CSV and Excel only.
"""
import csv
import io
import xml.etree.ElementTree as ET
from collections import Counter

from openpyxl import Workbook
from openpyxl.styles import Font

from . import nlp

COLUMNS = [
    ("src_term", "Source term"), ("tgt_term", "Translation"), ("src_lang", "Source language"),
    ("tgt_lang", "Target language"), ("pos", "Part of speech"), ("status", "Status"), ("domain", "Domain"),
    ("definition", "Definition"), ("notes", "Notes"), ("context", "Example"),
    ("context_source", "Example source"), ("project", "Project"),
    ("src_gender", "Source gender"), ("src_number", "Source number"), ("src_note", "Source note"),
    ("tgt_gender", "Translation gender"), ("tgt_number", "Translation number"), ("tgt_note", "Translation note"),
    ("concept_id", "Concept"),
]
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")
_XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
# A candidate has no TBX-Basic equivalent (the value list has no "proposed"), so it is exported without a status.
_ADMIN_STATUS = {"approved": "preferredTerm-admn-sts", "admitted": "admittedTerm-admn-sts",
                 "superseded": "supersededTerm-admn-sts", "forbidden": "deprecatedTerm-admn-sts"}
# TBX-Basic partOfSpeech is limited to noun, verb, adjective, adverb and other: a proper noun is exported as noun.
_TBX_POS = {"properNoun": "noun"}


def csv_safe(value):
    """Neutralise spreadsheet formulas in text that came from scraped web pages."""
    if isinstance(value, str) and value.startswith(_FORMULA_START):
        return "'" + value
    return value


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([label for _, label in COLUMNS])
    for r in rows:
        writer.writerow([csv_safe(r.get(key) or "") for key, _ in COLUMNS])
    return "﻿" + buf.getvalue()


def to_xlsx(rows: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Termbase"
    ws.append([label for _, label in COLUMNS])
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for r in rows:
        ws.append([r.get(key) or "" for key, _ in COLUMNS])
        for cell in ws[ws.max_row]:
            if isinstance(cell.value, str):
                cell.data_type = "s"     # always text: a term like "=1+1" must never become a formula
    widths = (28, 28, 9, 9, 13, 11, 18, 40, 40, 50, 24, 18, 12, 12, 30, 12, 12, 30, 9)
    for column, width in zip("ABCDEFGHIJKLMNOPQRS", widths, strict=True):
        ws.column_dimensions[column].width = width
    ws.freeze_panes = "A2"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


# --------------------------------------------------------------------------- TBX
def _concepts(rows: list[dict]) -> list[list[dict]]:
    """Rows grouped per concept: the rows sharing a concept id, or (rows without one) a project, language pair
    and source term, case-insensitively."""
    groups: dict[tuple, list[dict]] = {}
    for r in rows:
        cid = r.get("concept_id")
        key = ("c", cid, r.get("project_id")) if cid else \
            ("t", r.get("project_id"), r["src_lang"], r["tgt_lang"], r["src_term"].lower())
        groups.setdefault(key, []).append(r)
    return list(groups.values())


def _unique(rows: list[dict], key: str) -> list[dict]:
    """One row for each distinct (case-insensitive, non-empty) value of `key`, in order. A term that appears in
    several rows (a source term with two translations) keeps what any of its rows says: the first non-empty value
    of every field wins, so a note or a gender entered on one row is not lost."""
    merged: dict[str, dict] = {}
    for r in rows:
        value = (r.get(key) or "").strip()
        if not value:
            continue
        have = merged.setdefault(value.lower(), dict(r))
        for k, v in r.items():
            if v and not have.get(k):
                have[k] = v
    return list(merged.values())


def to_tbx(rows: list[dict], version: int = 3, title: str = "Colloca termbase") -> bytes:
    if version not in (2, 3):
        raise ValueError("TBX version must be 2 or 3")
    v3 = version == 3
    ns = "{urn:iso:std:iso:30042:ed-2}" if v3 else ""
    names = (dict(root="tbx", header="tbxHeader", entry="conceptEntry", lang="langSec", term="termSec")
             if v3 else dict(root="martif", header="martifHeader", entry="termEntry", lang="langSet", term="tig"))
    if v3:
        ET.register_namespace("", ns[1:-1])

    def el(parent, name, text=None, **attrs):
        node = ET.SubElement(parent, ns + name, {k: v for k, v in attrs.items() if v is not None})
        if text is not None:
            node.text = text
        return node

    src_langs = Counter(r["src_lang"] for r in rows)
    main_lang = src_langs.most_common(1)[0][0] if src_langs else "es"
    root = ET.Element(ns + names["root"], {_XML_LANG: main_lang, "type": "TBX-Basic" if v3 else "TBX"})
    if v3:
        root.set("style", "dca")
    header = el(root, names["header"])
    desc = el(el(header, "fileDesc"), "sourceDesc")
    el(desc, "p", f"{title}: {len(rows)} entries, exported from Colloca")
    if not v3:
        el(el(header, "encodingDesc"), "p", "TBXBasicXCSV02.xcs", type="DCSName")
    body = el(el(root, "text"), "body")

    for n, group in enumerate(_concepts(rows), 1):
        first = group[0]
        concept = el(body, names["entry"], id=f"c{n}")
        domain = next((r["domain"] for r in group if r.get("domain")), "")
        if domain:
            el(concept, "descrip", domain, type="subjectField")
        source = el(concept, names["lang"], **{_XML_LANG: first["src_lang"]})
        definition = next((r["definition"] for r in group if r.get("definition")), "")
        if definition:
            el(source, "descrip", definition, type="definition")
        for n_src, r in enumerate(_unique(group, "src_term")):       # every source term of the concept
            src_sec = el(source, names["term"])
            el(src_sec, "term", r["src_term"])
            pos = r.get("pos") or (next((g["pos"] for g in group if g.get("pos")), "") if n_src == 0 else "")
            pos = _TBX_POS.get(pos, pos)
            if pos:
                el(src_sec, "termNote", pos, type="partOfSpeech")
            if r.get("src_gender"):
                el(src_sec, "termNote", r["src_gender"], type="grammaticalGender")
            context = r if r.get("context") else (next((g for g in group if g.get("context")), None)
                                                  if n_src == 0 else None)
            if context:
                el(src_sec, "descrip", context["context"], type="context")
            if r.get("src_note"):
                el(src_sec, "note", r["src_note"])
        translated = _unique([g for g in group if g.get("tgt_term")], "tgt_term")
        if translated:
            target = el(concept, names["lang"], **{_XML_LANG: first["tgt_lang"]})
            for r in translated:
                sec = el(target, names["term"])
                el(sec, "term", r["tgt_term"])
                if r.get("pos"):
                    el(sec, "termNote", _TBX_POS.get(r["pos"], r["pos"]), type="partOfSpeech")
                if r.get("tgt_gender"):
                    el(sec, "termNote", r["tgt_gender"], type="grammaticalGender")
                if r["status"] in _ADMIN_STATUS:
                    el(sec, "termNote", _ADMIN_STATUS[r["status"]], type="administrativeStatus")
                notes = [x for x in (r.get("notes"), r.get("tgt_note")) if x]
                if notes:
                    el(sec, "note", "\n".join(notes))
    ET.indent(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def lang_name(code: str) -> str:
    return nlp.SUPPORTED.get(code, code)
