"""Readers for the less common input formats: XLIFF, ODT, RTF, XLSX/CSV columns, SRT/VTT subtitles.

Every reader returns plain text (one paragraph, row cell or cue per line); `read_xliff` also returns aligned
(source, target) pairs, which `parallel.read_pairs` uses for the aligned-text import. XML is parsed with
defusedxml; zipped formats are checked against a size limit before they are opened.
"""
import csv
import io
import re
import zipfile
from dataclasses import dataclass, field

from defusedxml import DefusedXmlException
from defusedxml import ElementTree as SafeET

from .ingest import IngestError, decode_bytes, normalize_text

MAX_ZIP_PART_BYTES = 100 * 1024 * 1024        # uncompressed size of the XML part of an ODT/XLSX (zip bomb guard)
MAX_TABLE_ROWS = 500_000


def _local(tag) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


# --------------------------------------------------------------------------- XLIFF
_XLIFF_CODES = {"bpt", "ept", "ph", "it", "ut", "sub", "x", "bx", "ex", "sc", "ec"}    # inline codes: no text
_XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"


@dataclass
class XliffDoc:
    source_lang: str = ""
    target_lang: str = ""
    pairs: list[tuple[str, str]] = field(default_factory=list)     # (source, target), only translated units
    sources: list[str] = field(default_factory=list)                # every source text, translated or not
    skipped: int = 0                                                # units without a target


def _inline_text(el) -> str:
    parts = [el.text or ""]
    for child in el:
        if _local(child.tag) not in _XLIFF_CODES:
            parts.append(_inline_text(child))
        parts.append(child.tail or "")
    return "".join(parts)


def read_xliff(data: bytes) -> XliffDoc:
    """XLIFF 1.2 (`trans-unit`) and 2.x (`unit`/`segment`). Source and target texts have their inline codes
    removed. Units with an empty target are counted in `skipped` and left out of `pairs`."""
    doc = XliffDoc()
    try:
        root = SafeET.fromstring(data)
    except (SafeET.ParseError, DefusedXmlException) as exc:
        raise IngestError(f"Not a readable XLIFF file: {exc}") from exc
    if _local(root.tag) != "xliff":
        raise IngestError("Not an XLIFF file (the root element is not <xliff>)")
    is2 = (root.get("version") or "").startswith("2")
    if is2:
        doc.source_lang, doc.target_lang = root.get("srcLang") or "", root.get("trgLang") or ""
    else:
        files = [f for f in root if _local(f.tag) == "file"]
        langs = {(f.get("source-language") or "", f.get("target-language") or "") for f in files}
        if len(langs) > 1:
            raise IngestError("This XLIFF mixes several language pairs in different <file> elements; split it first")
        if langs:
            doc.source_lang, doc.target_lang = next(iter(langs))
    unit_tag = "segment" if is2 else "trans-unit"
    for el in root.iter():
        if _local(el.tag) != unit_tag:
            continue
        src = next((c for c in el if _local(c.tag) == "source"), None)
        tgt = next((c for c in el if _local(c.tag) == "target"), None)
        if src is None:
            continue
        s = " ".join(_inline_text(src).split())
        t = " ".join(_inline_text(tgt).split()) if tgt is not None else ""
        if not s:
            continue
        doc.sources.append(s)
        if t:
            doc.pairs.append((s, t))
        else:
            doc.skipped += 1
    if not doc.sources:
        raise IngestError("The XLIFF file has no translation units")
    return doc


def _same_lang(code: str, lang: str) -> bool:
    return (code or "").lower().replace("_", "-").split("-")[0] == lang


def extract_xliff(data: bytes, lang: str | None) -> str:
    """Plain text of an XLIFF: the side written in the corpus language (target if it matches, else source)."""
    doc = read_xliff(data)
    if lang and doc.pairs and _same_lang(doc.target_lang, lang) and not _same_lang(doc.source_lang, lang):
        return normalize_text("\n".join(t for _, t in doc.pairs))
    return normalize_text("\n".join(doc.sources))


# --------------------------------------------------------------------------- ODT
_ODF_TEXT = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"


def _odf_para(el) -> str:
    out = [el.text or ""]
    for child in el:
        name = _local(child.tag)
        if name == "s":
            out.append(" " * int(child.get(_ODF_TEXT + "c") or 1))
        elif name == "tab":
            out.append(" ")
        elif name == "line-break":
            out.append("\n")
        elif name not in ("note", "annotation"):                # footnote bodies and comments are not running text
            out.append(_odf_para(child))
        out.append(child.tail or "")
    return "".join(out)


def extract_odt(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            info = z.getinfo("content.xml")
            if info.file_size > MAX_ZIP_PART_BYTES:
                raise IngestError("ODT content is too large to read safely")
            xml = z.read("content.xml")
    except (zipfile.BadZipFile, KeyError) as exc:
        raise IngestError("Not a readable ODT file") from exc
    try:
        root = SafeET.fromstring(xml)
    except (SafeET.ParseError, DefusedXmlException) as exc:
        raise IngestError(f"Not a readable ODT file: {exc}") from exc
    paras: list[str] = []

    def walk(el) -> None:
        for child in el:
            if child.tag in (_ODF_TEXT + "p", _ODF_TEXT + "h"):
                paras.append(_odf_para(child))
            elif _local(child.tag) not in ("note", "annotation"):
                walk(child)
    walk(root)
    return normalize_text("\n".join(paras))


# --------------------------------------------------------------------------- RTF
def extract_rtf(data: bytes) -> str:
    from striprtf.striprtf import rtf_to_text
    raw = data.decode("latin-1")            # RTF is 7-bit; non-ASCII arrives as \'xx escapes that striprtf decodes
    if not raw.lstrip().startswith("{\\rtf"):
        raise IngestError("Not an RTF file")
    try:
        return normalize_text(rtf_to_text(raw, errors="ignore"))
    except Exception as exc:
        raise IngestError(f"Cannot read the RTF file: {exc}") from exc


# --------------------------------------------------------------------------- SRT / VTT
_TIMING = re.compile(r"\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}")
_CUE_TAGS = re.compile(r"</?[a-zA-Z][^>]*>|\{\\[^}]*\}")


def extract_subtitles(data: bytes) -> str:
    """One line per cue (a cue's own line breaks are joined with a space); numbers, timings, tags, VTT
    header/NOTE/STYLE blocks are dropped."""
    text = decode_bytes(data).replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿")
    cues = []
    for block in re.split(r"\n\s*\n", text):
        lines = [ln for ln in block.split("\n")]
        idx = next((i for i, ln in enumerate(lines) if _TIMING.search(ln)), None)
        if idx is None:
            continue                    # WEBVTT header, NOTE, STYLE, REGION blocks
        body = " ".join(_CUE_TAGS.sub("", ln).strip() for ln in lines[idx + 1:])
        body = " ".join(body.split())
        if body:
            cues.append(body)
    if not cues:
        raise IngestError("No subtitle cues found")
    return normalize_text("\n".join(cues))


# --------------------------------------------------------------------------- XLSX / CSV
def read_table(filename: str, data: bytes) -> list[list[str]]:
    """All rows (of every sheet for XLSX) as lists of strings."""
    if filename.lower().endswith(".xlsx"):
        from openpyxl import load_workbook
        try:
            wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as exc:
            raise IngestError(f"Not a readable XLSX file: {exc}") from exc
        rows: list[list[str]] = []
        for ws in wb.worksheets:
            for row in ws.iter_rows(values_only=True):
                rows.append(["" if c is None else str(c) for c in row])
                if len(rows) > MAX_TABLE_ROWS:
                    raise IngestError(f"Spreadsheet has more than {MAX_TABLE_ROWS} rows")
        wb.close()
        return rows
    text = decode_bytes(data)
    sample = "\n".join(text.splitlines()[:20])
    delim = max("\t;,", key=sample.count)
    return [r for r in csv.reader(io.StringIO(text), delimiter=delim)]


def _is_texty(cell: str) -> bool:
    return bool(re.search(r"[^\W\d_]{2}", cell)) and not re.fullmatch(r"[\d\s.,:;/%€$£+\-]+", cell)


def select_text_columns(rows: list[list[str]], columns: str = "") -> tuple[list[int], bool]:
    """(0-based column indexes to import, whether row 0 is a header).
    `columns` is a list like "2,4" (1-based numbers) or header names ("Texto, Notas"); empty = automatic:
    the columns whose cells are mostly words (not numbers, codes or dates), averaging at least two words."""
    width = max((len(r) for r in rows), default=0)
    if not rows or width == 0:
        raise IngestError("The file has no data")
    first = rows[0]
    header_like = all(not c.strip() or (len(c.strip()) <= 40 and _is_texty(c)) for c in first) and any(
        c.strip() for c in first)
    if columns.strip():
        wanted = [w.strip() for w in re.split(r"[,;]", columns) if w.strip()]
        names = [c.strip().lower() for c in first]
        picked: list[int] = []
        by_name = 0
        for w in wanted:
            if w.isdigit() and 1 <= int(w) <= width:
                picked.append(int(w) - 1)
            elif w.lower() in names:
                picked.append(names.index(w.lower()))
                by_name += 1
            else:
                listing = ", ".join(c or str(i + 1) for i, c in enumerate(first))
                raise IngestError(f"Column '{w}' not found (columns: {listing})")
        return picked, bool(by_name) or header_like
    body = rows[1:] if header_like else rows
    picked = []
    for j in range(width):
        cells = [r[j].strip() for r in body if j < len(r) and r[j].strip()]
        if len(cells) >= 1 and sum(map(_is_texty, cells)) / len(cells) >= 0.6 \
                and sum(len(c.split()) for c in cells) / len(cells) >= 2:
            picked.append(j)
    if not picked:                                   # short labels only (a term list): take the texty columns
        for j in range(width):
            cells = [r[j].strip() for r in body if j < len(r) and r[j].strip()]
            if cells and sum(map(_is_texty, cells)) / len(cells) >= 0.6:
                picked.append(j)
    if not picked:
        raise IngestError("No column with text found; name the column(s) to import")
    return picked, header_like


def extract_table(filename: str, data: bytes, columns: str = "") -> str:
    rows = read_table(filename, data)
    picked, header = select_text_columns(rows, columns)
    out = []
    for r in rows[1 if header else 0:]:
        for j in picked:
            if j < len(r) and r[j].strip():
                out.append(r[j].replace("\r", " ").replace("\n", " "))
    return normalize_text("\n".join(out))
