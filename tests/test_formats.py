"""Input formats (T12). All fixtures are synthetic, built in this file: no real CAT-tool exports or real scans."""
import io
import os
import shutil
import stat
import zipfile

import pytest
from openpyxl import Workbook

from colloca import formats, ingest, ocr, parallel

from .test_api import make_corpus, wait_for_jobs

ES = ("El contrato establece las obligaciones del arrendador y del arrendatario en cada caso concreto. "
      "El plazo de entrega termina el viernes por la tarde y el cliente debe confirmar el pedido por escrito.")


def doc_job(client, cid, name, data, **params):
    files = [("files", (name, data, "application/octet-stream"))]
    r = client.post(f"/api/corpora/{cid}/upload", params=params, files=files)
    assert r.status_code == 202, r.text
    job = wait_for_jobs(client, cid)[-1]
    return job


# --------------------------------------------------------------------------- ODT / RTF / subtitles
def make_odt(paragraphs, extra=""):
    body = "".join(f"<text:p>{p}</text:p>" for p in paragraphs)
    xml = ('<?xml version="1.0" encoding="UTF-8"?><office:document-content '
           'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
           'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>'
           f"<text:h>Título</text:h>{body}{extra}</office:text></office:body></office:document-content>")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/vnd.oasis.opendocument.text")
        z.writestr("content.xml", xml)
    return buf.getvalue()


def test_odt_text_spaces_and_notes():
    data = make_odt(["Primera<text:s text:c=\"2\"/>línea<text:line-break/>segunda <text:span>con estilo</text:span>"],
                    extra="<text:p>Fin<text:note><text:note-body><text:p>NOTA AL PIE</text:p></text:note-body>"
                          "</text:note></text:p>")
    text = ingest.read_file("a.odt", data)["text"]
    assert "Título" in text and "Primera línea\nsegunda con estilo" in text and "Fin" in text
    assert "NOTA AL PIE" not in text


def test_odt_rejects_garbage_and_xxe():
    with pytest.raises(ingest.IngestError):
        ingest.read_file("a.odt", b"not a zip")
    xxe = make_odt(["x"]).replace(b"<office:document-content", b"<!DOCTYPE d [<!ENTITY e SYSTEM \"file:///etc/passwd\">]>"
                                  b"<office:document-content")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("content.xml", zipfile.ZipFile(io.BytesIO(make_odt(["&e;"]))).read("content.xml").decode()
                   .replace("<office:document-content", '<!DOCTYPE d [<!ENTITY e SYSTEM "file:///etc/passwd">]>'
                            "<office:document-content", 1))
    with pytest.raises(ingest.IngestError):
        ingest.read_file("a.odt", buf.getvalue())
    assert xxe


RTF = (r"{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}\pard Contrato de arrendamiento\par "
       r"El arrendador debe entregar la vivienda en perfecto estado. Habr\'e1 un plazo de cinco d\'edas.\par}")


def test_rtf_text_with_accents():
    text = ingest.read_file("a.rtf", RTF.encode())["text"]
    assert "Contrato de arrendamiento" in text and "Habrá un plazo de cinco días." in text
    assert "\\" not in text and "Arial" not in text
    with pytest.raises(ingest.IngestError):
        ingest.read_file("a.rtf", b"plain text")


SRT = ("﻿1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Buenos días,</i>\r\nseñor García.\r\n\r\n"
       "2\r\n00:00:04,000 --> 00:00:06,000\r\n{\\an8}¿Dónde está el contrato?\r\n\r\n"
       "3\r\n00:00:07,000 --> 00:00:08,000\r\n\r\n").encode()
VTT = ("WEBVTT\n\nNOTE esto es un comentario\n\nSTYLE\n::cue { color: red }\n\n"
       "intro\n00:01.000 --> 00:03.000 align:start\n<v Ana>Buenos días,</v>\nseñor García.\n\n"
       "00:00:04.000 --> 00:00:06.000\n¿Dónde está el contrato?\n").encode()


@pytest.mark.parametrize("name,data", [("a.srt", SRT), ("a.vtt", VTT)])
def test_subtitles_strip_timing_and_tags(name, data):
    assert ingest.read_file(name, data)["text"] == "Buenos días, señor García.\n¿Dónde está el contrato?"


def test_subtitles_without_cues():
    with pytest.raises(ingest.IngestError):
        ingest.read_file("a.srt", b"hello\nworld")


# --------------------------------------------------------------------------- tables
def make_xlsx(rows):
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


TABLE = [["ID", "Texto", "Importe", "Notas"],
         [1, "El arrendador debe entregar la vivienda limpia.", 1200.5, "revisar"],
         [2, "El plazo de entrega termina el viernes por la tarde.", 80, "urgente ya"],
         [3, "El cliente debe confirmar el pedido por escrito.", 15, ""]]


def test_xlsx_auto_detects_text_column():
    text = ingest.read_file("t.xlsx", make_xlsx(TABLE))["text"]
    assert text.splitlines() == ["El arrendador debe entregar la vivienda limpia.",
                                 "El plazo de entrega termina el viernes por la tarde.",
                                 "El cliente debe confirmar el pedido por escrito."]


def test_xlsx_column_choice_by_name_and_number():
    data = make_xlsx(TABLE)
    assert ingest.read_file("t.xlsx", data, columns="Notas")["text"].splitlines() == ["revisar", "urgente ya"]
    both = ingest.read_file("t.xlsx", data, columns="2,4")["text"].splitlines()
    assert both[:2] == ["El arrendador debe entregar la vivienda limpia.", "revisar"]
    with pytest.raises(ingest.IngestError, match="not found"):
        ingest.read_file("t.xlsx", data, columns="Nope")


def test_csv_semicolon_and_tsv():
    csv_data = "\n".join(";".join(str(c) for c in r) for r in TABLE).encode()
    assert len(ingest.read_file("t.csv", csv_data)["text"].splitlines()) == 3
    tsv = "\n".join("\t".join(str(c) for c in r) for r in TABLE).encode()
    assert ingest.read_file("t.tsv", tsv, columns="2")["text"].startswith("El arrendador")


# --------------------------------------------------------------------------- XLIFF
XLIFF12 = """<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
 <file original="a.docx" source-language="es-ES" target-language="it-IT" datatype="plaintext"><body>
  <trans-unit id="1"><source>El contrato <g id="1">establece</g> las <x id="2"/>obligaciones.</source>
   <target>Il contratto <g id="1">stabilisce</g> gli <x id="2"/>obblighi.</target></trans-unit>
  <group id="g"><trans-unit id="2"><source>El plazo termina el viernes <ph id="3">{0}</ph>.</source>
   <target>Il termine scade venerdì <ph id="3">{0}</ph>.</target></trans-unit>
  <trans-unit id="3"><source>Sin traducir todavía.</source><target/></trans-unit></group>
 </body></file></xliff>""".encode()

XLIFF2 = """<?xml version="1.0" encoding="UTF-8"?>
<xliff version="2.1" xmlns="urn:oasis:names:tc:xliff:document:2.0" srcLang="it" trgLang="es">
 <file id="f1"><unit id="u1"><segment>
  <source>Il contratto <pc id="1">stabilisce</pc> gli obblighi.</source>
  <target>El contrato <pc id="1">establece</pc> las obligaciones.</target></segment></unit>
 <unit id="u2"><segment><source>Il termine scade <ph id="2"/>venerdì.</source>
  <target>El plazo termina el viernes.</target>
 </segment>
 <segment><source>Nessuna traduzione.</source></segment></unit></file></xliff>""".encode()


def test_read_xliff_12_strips_inline_codes():
    doc = formats.read_xliff(XLIFF12)
    assert (doc.source_lang, doc.target_lang) == ("es-ES", "it-IT")
    assert doc.pairs == [("El contrato establece las obligaciones.", "Il contratto stabilisce gli obblighi."),
                         ("El plazo termina el viernes .", "Il termine scade venerdì .")]
    assert doc.skipped == 1 and len(doc.sources) == 3


def test_read_xliff_2x():
    doc = formats.read_xliff(XLIFF2)
    assert (doc.source_lang, doc.target_lang) == ("it", "es")
    assert doc.pairs[0] == ("Il contratto stabilisce gli obblighi.", "El contrato establece las obligaciones.")
    assert len(doc.pairs) == 2 and doc.skipped == 1


def test_xliff_plain_text_follows_corpus_language():
    assert ingest.read_file("a.xlf", XLIFF12, "es")["text"].startswith("El contrato establece")
    assert ingest.read_file("a.xlf", XLIFF12, "it")["text"].startswith("Il contratto stabilisce")
    assert ingest.read_file("a.xliff", XLIFF2, "es")["text"].startswith("El contrato establece")


def test_xliff_errors_and_xxe():
    with pytest.raises(ingest.IngestError):
        formats.read_xliff(b"<html/>")
    with pytest.raises(ingest.IngestError):
        formats.read_xliff(b"<xliff><broken")
    bomb = (b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]>'
            b'<xliff version="1.2"><file><body><trans-unit><source>&b;</source></trans-unit></body></file></xliff>')
    with pytest.raises(ingest.IngestError):
        formats.read_xliff(bomb)


def test_read_pairs_orients_xliff_by_language_codes():
    es_it = parallel.read_pairs("a.xlf", XLIFF12, "es", "it")[0]
    it_es = parallel.read_pairs("a.xlf", XLIFF12, "it", "es")[0]
    assert es_it[0][0].startswith("El contrato") and it_es[0][0].startswith("Il contratto")
    # an XLIFF written Italian -> Spanish, read as (es, it)
    assert parallel.read_pairs("a.xliff", XLIFF2, "es", "it")[0][0][0].startswith("El contrato")
    pairs, skipped = parallel.read_pairs("a.xliff", XLIFF2, "it", "es")
    assert pairs[0][0].startswith("Il contratto") and skipped == 1


def test_xliff_aligned_import_end_to_end(client):
    es, it = make_corpus(client, "es", "xl-es"), make_corpus(client, "it", "xl-it")
    units = "".join(f'<trans-unit id="{k}"><source>{a}</source><target>{b}</target></trans-unit>' for k, (a, b) in
                    enumerate(__import__("tests.test_parallel", fromlist=["x"]).build_pairs()[:8]))
    data = ('<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2"><file source-language="es" '
            f'target-language="it" original="x"><body>{units}</body></file></xliff>').encode()
    r = client.post(f"/api/corpora/{es}/upload-pairs", params={"partner_corpus_id": it},
                    files=[("files", ("memory.xlf", data, "text/xml"))])
    assert r.status_code == 202
    job = wait_for_jobs(client, es)[0]
    assert job["status"] == "done" and job["result"]["segments"] == 8


def test_xliff_monolingual_upload_with_language_check(client):
    es = make_corpus(client, "es", "xl-mono")
    job = doc_job(client, es, "a.xlf", _long_xliff())
    assert job["status"] == "done" and job["result"]["tokens"] > 20
    it = make_corpus(client, "it", "xl-mono-it")
    assert doc_job(client, it, "b.xlf", _long_xliff())["status"] == "error"      # Spanish text, Italian corpus


def _long_xliff():
    return (f'<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2"><file source-language="es" '
            f'target-language="it" original="x"><body><trans-unit id="1"><source>{ES}</source><target>x</target>'
            "</trans-unit></body></file></xliff>").encode()


@pytest.mark.parametrize("name,data", [
    ("a.odt", make_odt([ES])),
    ("a.rtf", ("{\\rtf1\\ansi " + ES.replace("í", "\\'ed").replace("é", "\\'e9") + "\\par}").encode()),
    ("a.srt", b"1\n00:00:01,000 --> 00:00:03,000\n" + ES.encode() + b"\n"),
    ("a.xlsx", make_xlsx([["Texto"], [ES]])),
])
def test_new_formats_import_with_token_counts(client, name, data):
    es = make_corpus(client, "es", "fmt-" + name)
    job = doc_job(client, es, name, data)
    assert job["status"] == "done", job
    assert job["result"]["tokens"] > 25                         # the whole paragraph, not markup
    it = make_corpus(client, "it", "fmt-it-" + name)
    wrong = doc_job(client, it, name, data)
    assert wrong["status"] == "error" and wrong["code"] == "language_mismatch"


# --------------------------------------------------------------------------- OCR
def scanned_pdf(pages=1):
    from PIL import Image
    imgs = [Image.new("RGB", (400, 300), "white") for _ in range(pages)]
    buf = io.BytesIO()
    imgs[0].save(buf, "PDF", save_all=True, append_images=imgs[1:])
    return buf.getvalue()


def fake_tesseract(tmp_path, monkeypatch, conf=95, langs="eng\nspa\nita"):
    exe = tmp_path / "tesseract"
    rows = "\n".join(f"5\t1\t1\t1\t1\t{i}\t0\t0\t10\t10\t{conf}\t{w}" for i, w in enumerate(ES.split()))
    head = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"
    listing = f"printf 'List of available languages:\\n{langs}\\n'"
    exe.write_text(f"#!/bin/sh\nif [ \"$1\" = \"--list-langs\" ]; then {listing}; "
                   f"exit 0; fi\ncat <<'EOF'\n{head}\n{rows}\n5\t1\t1\t1\t1\t99\t0\t0\t1\t1\t-1\t\nEOF\n")
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}{os.environ['PATH']}")


def test_scanned_pdf_without_tesseract_is_actionable(monkeypatch):
    monkeypatch.setenv("PATH", "/nonexistent")
    with pytest.raises(ingest.IngestError) as e:
        ingest.read_file("scan.pdf", scanned_pdf())
    msg = str(e.value)
    assert "Tesseract" in msg and "tesseract-ocr" in msg and "Traceback" not in msg


def test_scanned_pdf_ocr_text_and_confidence(tmp_path, monkeypatch):
    fake_tesseract(tmp_path, monkeypatch, conf=92)
    res = ingest.read_file("scan.pdf", scanned_pdf(2), "es")
    assert res["text"].startswith("El contrato establece")
    assert any("OCR" in w and "92%" in w for w in res["warnings"]) and not any("low" in w for w in res["warnings"])


def test_scanned_pdf_low_confidence_warns(tmp_path, monkeypatch):
    fake_tesseract(tmp_path, monkeypatch, conf=41)
    res = ingest.read_file("scan.pdf", scanned_pdf(), "it")
    assert any("quality is low" in w for w in res["warnings"])


def test_ocr_missing_language_data_and_switch_and_page_limit(tmp_path, monkeypatch):
    fake_tesseract(tmp_path, monkeypatch, langs="eng")
    with pytest.raises(ingest.IngestError, match="language data for spa"):
        ingest.read_file("scan.pdf", scanned_pdf(), "es")
    fake_tesseract(tmp_path, monkeypatch)
    monkeypatch.setattr(ocr, "ENABLED", False)
    with pytest.raises(ingest.IngestError, match="switched off"):
        ingest.read_file("scan.pdf", scanned_pdf(), "es")
    monkeypatch.setattr(ocr, "ENABLED", True)
    monkeypatch.setattr(ocr, "MAX_OCR_PAGES", 1)
    with pytest.raises(ingest.IngestError, match="limited to 1"):
        ingest.read_file("scan.pdf", scanned_pdf(2), "es")


def test_scanned_pdf_upload_job_carries_warning(client, tmp_path, monkeypatch):
    fake_tesseract(tmp_path, monkeypatch, conf=50)
    es = make_corpus(client, "es", "ocr-job")
    job = doc_job(client, es, "scan.pdf", scanned_pdf())
    assert job["status"] == "done", job
    assert any("quality is low" in w for w in job["result"]["warnings"])


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="Tesseract is not installed")
def test_real_tesseract_reads_rendered_text():
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (1600, 400), "white")
    try:
        font = ImageFont.load_default(size=60)
    except TypeError:
        pytest.skip("Pillow too old for a sized default font")
    ImageDraw.Draw(img).text((40, 150), "El contrato establece las obligaciones", fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, "PDF")
    try:
        res = ingest.read_file("scan.pdf", buf.getvalue(), "es")
    except ingest.IngestError as exc:
        if "language data" in str(exc):
            pytest.skip(str(exc))
        raise
    assert "contrato" in res["text"].lower()
