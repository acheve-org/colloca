"""Termbase exports: CSV, Excel and TBX (TermBase eXchange, ISO 30042).

TBX comes in two flavours because CAT tools differ in what they read:
  version 3  ISO 30042:2019 structure (tbx / conceptEntry / langSec / termSec), as in current TBX-Basic;
  version 2  ISO 30042:2008 structure (martif / termEntry / langSet / tig), the one most CAT tools read.
Both use TBX-Basic data categories only. One concept groups all rows sharing the same source term.
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
]
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")
_XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
_ADMIN_STATUS = {"approved": "preferredTerm-admn-sts", "candidate": "admittedTerm-admn-sts",
                 "forbidden": "deprecatedTerm-admn-sts"}


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
    for column, width in zip("ABCDEFGHIJKL", (28, 28, 9, 9, 13, 11, 18, 40, 40, 50, 24, 18), strict=True):
        ws.column_dimensions[column].width = width
    ws.freeze_panes = "A2"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


# --------------------------------------------------------------------------- TBX
def _concepts(rows: list[dict]) -> list[list[dict]]:
    """Rows grouped per concept (project, language pair and source term, case-insensitive)."""
    groups: dict[tuple, list[dict]] = {}
    for r in rows:
        key = (r.get("project_id"), r["src_lang"], r["tgt_lang"], r["src_term"].lower())
        groups.setdefault(key, []).append(r)
    return list(groups.values())


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
        src_sec = el(source, names["term"])
        el(src_sec, "term", first["src_term"])
        pos = next((r["pos"] for r in group if r.get("pos")), "")
        if pos:
            el(src_sec, "termNote", pos, type="partOfSpeech")
        context = next((r for r in group if r.get("context")), None)
        if context:
            el(src_sec, "descrip", context["context"], type="context")
        translated = [r for r in group if r.get("tgt_term")]
        if translated:
            target = el(concept, names["lang"], **{_XML_LANG: first["tgt_lang"]})
            for r in translated:
                sec = el(target, names["term"])
                el(sec, "term", r["tgt_term"])
                if r.get("pos"):
                    el(sec, "termNote", r["pos"], type="partOfSpeech")
                el(sec, "termNote", _ADMIN_STATUS[r["status"]], type="administrativeStatus")
                if r.get("notes"):
                    el(sec, "note", r["notes"])
    ET.indent(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def lang_name(code: str) -> str:
    return nlp.SUPPORTED.get(code, code)
