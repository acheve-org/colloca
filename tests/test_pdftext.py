"""PDF reading order and quality (T24): columns, tables, a quality score and a warning for garbled text."""
# ruff: noqa: E501

import pytest

from colloca import ingest, pdftext

from .pdfmaker import lines, make_pdf

LEFT = ["La primera columna habla del contrato de", "arrendamiento y de sus obligaciones para", "las dos partes que lo firman hoy.",
        "Después el arrendador entrega las llaves", "al inquilino en la fecha acordada."]
RIGHT = ["La segunda columna trata de la garantía", "y del plazo de entrega del inmueble,", "con las condiciones de pago pactadas.",
         "Por último se firma el acta de entrega", "ante el notario de la ciudad."]


def read(data: bytes, **kw):
    notes: list[str] = []
    rep: dict = {}
    text = ingest.extract_pdf(data, None, notes, None, rep)
    return text, notes, rep


def interleaved(left, right, top=700):
    """Left and right columns drawn row by row, as many producers do: the drawing order is not the reading order."""
    return [run for l_run, r_run in zip(lines(60, top, left), lines(330, top, right), strict=True) for run in (l_run, r_run)]


def two_columns():
    return make_pdf([interleaved(LEFT, RIGHT)])


def test_two_columns_are_read_one_after_the_other():
    text, _, _ = read(two_columns())
    assert text.index("La primera columna") < text.index("las dos partes que lo firman") < text.index("La segunda columna")
    assert text.index("ante el notario") > text.index("al inquilino")
    # the left column is complete before the right one starts, and no sentence is mixed across columns
    assert "contrato de arrendamiento y de sus obligaciones para las dos partes que lo firman hoy." in text
    assert "La segunda columna trata de la garantía y del plazo de entrega del inmueble," in text


def test_the_old_order_would_have_mixed_the_columns():
    import io

    from pypdf import PdfReader
    raw = PdfReader(io.BytesIO(two_columns())).pages[0].extract_text()
    assert raw.index("La segunda columna") < raw.index("las dos partes")        # pypdf's own order interleaves
    text, _, _ = read(two_columns())
    assert text.index("las dos partes") < text.index("La segunda columna")


def test_a_full_width_heading_stays_above_both_columns():
    runs = [(60, 760, "Contrato de arrendamiento de vivienda habitual entre particulares")] + interleaved(LEFT, RIGHT, 720)
    text, _, _ = read(make_pdf([runs]))
    assert text.startswith("Contrato de arrendamiento de vivienda")
    assert text.index("Contrato de arrendamiento de vivienda") < text.index("La primera columna") < text.index("La segunda")


def test_single_column_text_is_unchanged():
    text, _, rep = read(make_pdf([lines(60, 700, LEFT + RIGHT)]))
    assert text.startswith("La primera columna habla")
    assert text.index("La primera") < text.index("La segunda")
    assert rep["quality"]["level"] == "good"


def test_table_rows_stay_rows():
    rows = [("Plazo", "Importe", "Moneda"), ("30 días", "1.200", "euros"), ("60 días", "2.400", "euros"),
            ("90 días", "3.600", "euros")]
    runs = [(60, 700 - i * 16, c) for i, r in enumerate(rows) for c in [r[0]]] \
        + [(220, 700 - i * 16, r[1]) for i, r in enumerate(rows)] + [(380, 700 - i * 16, r[2]) for i, r in enumerate(rows)]
    runs += lines(60, 600, ["Después de la tabla sigue un párrafo normal que no forma parte de ella."])
    text, _, _ = read(make_pdf([runs]))
    assert text.splitlines()[:4] == ["Plazo | Importe | Moneda", "30 días | 1.200 | euros", "60 días | 2.400 | euros",
                                     "90 días | 3.600 | euros"]
    assert "Después de la tabla sigue un párrafo normal" in text.splitlines()[4]


def test_table_rows_are_not_joined_into_each_other():
    rows = [("a", "b"), ("c", "d"), ("e", "f"), ("g", "h")]
    runs = [(60, 700 - i * 16, r[0]) for i, r in enumerate(rows)] + [(300, 700 - i * 16, r[1]) for i, r in enumerate(rows)]
    text, _, _ = read(make_pdf([runs]))
    assert text.splitlines() == ["a | b", "c | d", "e | f", "g | h"]


def test_running_headers_and_page_numbers_are_still_removed():
    pages = [[(60, 770, "Informe anual de la empresa"), (300, 30, str(n))]
             + lines(60, 700, [f"{ln} (página {n})" for ln in LEFT]) for n in range(1, 5)]
    text, _, _ = read(make_pdf(pages))
    assert "Informe anual" not in text
    assert text.count("La primera columna") == 4


def test_a_good_pdf_has_a_good_score_and_no_warning():
    text, notes, rep = read(two_columns())
    assert rep["quality"]["score"] >= 90 and rep["quality"]["level"] == "good" and rep["quality"]["issues"] == []
    assert notes == []


def test_a_garbled_pdf_gets_a_low_score_and_a_warning():
    junk = ["xqzt kjhs wvbn pfrm dgtk lcxz bnmq", "ßþ§¶ ~~^^ ### @@@@ %%%% ||||", "q w r t y p s d f g h j k l z x c v b n m",
            "tqzkw hrnbf xlvjd gqmzp wkrtn dfhsl", "z x c v b n m q w e r t y"] * 6
    text, notes, rep = read(make_pdf([lines(60, 780, junk, 12)]))
    assert rep["quality"]["level"] in ("poor", "fair") and rep["quality"]["score"] < 75
    codes = {i["code"] for i in rep["quality"]["issues"]}
    assert codes & {"garbled", "split_words", "symbols"}
    assert notes and "may be unreliable" in notes[0] and "Check the preview" in notes[0]


def test_quality_reports_what_is_wrong():
    assert pdftext.quality("")["level"] == "poor"
    broken = "\n".join(["la casa de mi abuela es muy grande y tiene"] * 30)
    assert "broken_lines" in {i["code"] for i in pdftext.quality(broken)["issues"]}
    shorts = "\n".join(["si", "no", "ok", "vale", "bien"] * 12) + "\nuna frase normal que sí tiene sentido completo."
    assert "short_lines" in {i["code"] for i in pdftext.quality(shorts)["issues"]}
    decoded = ("texto con carácter � roto " * 20)
    assert "odd_chars" in {i["code"] for i in pdftext.quality(decoded)["issues"]}


def test_read_file_returns_the_quality_for_pdfs_only():
    res = ingest.read_file("two.pdf", two_columns(), "es")
    assert res["quality"]["level"] == "good" and res["warnings"] == []
    assert "quality" not in ingest.read_file("a.txt", b"Un texto cualquiera que no es un PDF.", "es")


def test_a_pdf_without_positions_falls_back_to_the_plain_order(monkeypatch):
    monkeypatch.setattr(pdftext, "fragments", lambda page: (_ for _ in ()).throw(RuntimeError("odd structure")))
    text, _, _ = read(make_pdf([lines(60, 700, LEFT)]))
    assert "La primera columna" in text


def test_empty_pdf_still_goes_to_ocr_path(monkeypatch):
    called = {}

    class Res:
        pages, confidence, text = 1, 99.0, "texto reconocido por ocr de prueba"

    import colloca.ocr as ocr
    monkeypatch.setattr(ocr, "ocr_pdf", lambda data, lang, progress: called.setdefault("ok", True) and Res)
    text, notes, _ = read(make_pdf([[]]))
    assert called and "reconocido" in text and "OCR" in notes[0]


@pytest.mark.parametrize("n", [1, 40])
def test_many_pages_stay_fast(n):
    import time
    t0 = time.perf_counter()
    read(make_pdf([interleaved(LEFT, RIGHT)] * n))
    assert time.perf_counter() - t0 < 10


# --------------------------------------------------------------------------- previews
def test_url_preview_of_a_pdf_carries_the_quality(client, monkeypatch):
    monkeypatch.setattr(ingest, "_download", lambda url, polite=False: (two_columns(), "application/pdf"))
    r = client.post("/api/preview-url", json={"url": "https://example.org/a.pdf"})
    assert r.status_code == 200
    body = r.json()
    assert body["quality"]["level"] == "good" and body["warnings"] == []
    assert body["text"].index("las dos partes") < body["text"].index("La segunda columna")


def test_file_preview_shows_text_and_quality_without_saving(client):
    from .test_api import make_corpus
    cid = make_corpus(client, "es", "pv")
    r = client.post("/api/preview-file", params={"corpus_id": cid},
                    files={"file": ("dos.pdf", two_columns(), "application/pdf")})
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "dos.pdf" and body["title"] == "dos" and body["quality"]["score"] >= 90
    assert client.get(f"/api/corpora/{cid}/documents").json() == []          # nothing was stored


def test_file_preview_of_other_formats_and_errors(client):
    r = client.post("/api/preview-file", files={"file": ("a.txt", b"Un texto de prueba largo para la vista previa.", "text/plain")})
    assert r.status_code == 200 and "quality" not in r.json() and r.json()["text"].startswith("Un texto")
    assert client.post("/api/preview-file", files={"file": ("a.xyz", b"x", "text/plain")}).status_code == 422
    assert client.post("/api/preview-file", params={"corpus_id": 99999},
                       files={"file": ("a.txt", b"hola", "text/plain")}).status_code == 404


def test_file_preview_respects_the_size_limit(client, monkeypatch):
    monkeypatch.setattr(ingest, "MAX_UPLOAD_BYTES", 50)
    r = client.post("/api/preview-file", files={"file": ("a.txt", b"x" * 60, "text/plain")})
    assert r.status_code == 413


def test_garbled_upload_job_carries_the_warning(client):
    from .test_api import make_corpus, wait_for_jobs
    cid = make_corpus(client, "es", "garbled")
    junk = ["xqzt kjhs wvbn pfrm dgtk lcxz bnmq", "q w r t y p s d f g h j k l z x c v b n m",
            "tqzkw hrnbf xlvjd gqmzp wkrtn dfhsl", "z x c v b n m q w e r t y"] * 6
    r = client.post(f"/api/corpora/{cid}/upload", params={"force_language": "true"},
                    files=[("files", ("junk.pdf", make_pdf([lines(60, 780, junk, 12)]), "application/pdf"))])
    assert r.status_code == 202
    job = wait_for_jobs(client, cid)[0]
    assert job["status"] == "done" and "may be unreliable" in " ".join(job["result"].get("warnings", []))
