"""OCR for PDFs without a text layer (optional: `uv sync --extra ocr` plus the Tesseract program).

Pages are rendered with pypdfium2 (a pip wheel, no Ghostscript or Poppler needed) and read with the `tesseract`
command line program, whose TSV output carries a confidence for every word. The result is the text plus the mean
word confidence (0-100), so the caller can warn when the scan is poor.
"""
import csv
import io
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from . import languages, ocrdata
from .ingest import IngestError

ENABLED = os.environ.get("OCR_ENABLED", "1") != "0"
MAX_OCR_PAGES = int(os.environ.get("MAX_OCR_PAGES", "100"))
PAGE_TIMEOUT_S = int(os.environ.get("OCR_PAGE_TIMEOUT", "120"))
MIN_CONFIDENCE = float(os.environ.get("OCR_MIN_CONFIDENCE", "70"))
RENDER_DPI = 300

HINT = ("Install it with `apt install tesseract-ocr` (Docker: build with --build-arg WITH_OCR=1) and "
        "`uv sync --extra ocr`, then install the language data in the Languages screen, or convert the scan to "
        "text elsewhere.")


@dataclass
class OcrResult:
    text: str
    pages: int
    confidence: float          # mean word confidence, 0-100


def _tesseract() -> str:
    exe = shutil.which("tesseract")
    if not exe:
        raise IngestError("This PDF has no text layer (it looks scanned) and OCR is not available: the Tesseract "
                          "program is not installed. " + HINT)
    return exe


def _languages(exe: str, lang: str | None) -> tuple[str, list[str]]:
    """The `-l` value and the extra tesseract arguments (`--tessdata-dir`) for a corpus language."""
    own = languages.get(lang) if lang else None
    wanted = [own.tesseract] if own and own.tesseract else [x.tesseract for x in languages.all_languages()
                                                           if x.tesseract]
    extra = ocrdata.tessdata_args(wanted)
    have = ocrdata.list_langs(extra)
    missing = [w for w in wanted if w not in have and not ocrdata.in_app_dir(w)]
    if missing or not wanted:
        raise IngestError(f"Tesseract has no language data for {', '.join(missing) or 'this language'}. "
                          "Install it in the Languages screen (or the tesseract-ocr language package).")
    return "+".join(wanted), extra


def parse_tsv(tsv: str) -> tuple[str, list[float]]:
    """(text with line breaks, confidences of the recognised words) from Tesseract TSV output."""
    lines: dict[tuple, list[str]] = {}
    confs: list[float] = []
    for row in csv.DictReader(io.StringIO(tsv), delimiter="\t", quoting=csv.QUOTE_NONE):
        word = (row.get("text") or "").strip()
        try:
            conf = float(row.get("conf") or -1)
        except ValueError:
            continue
        if not word or conf < 0:
            continue
        key = (row.get("block_num"), row.get("par_num"), row.get("line_num"))
        lines.setdefault(key, []).append(word)
        confs.append(conf)
    return "\n".join(" ".join(ws) for ws in lines.values()), confs


def ocr_pdf(data: bytes, lang: str | None, progress=None) -> OcrResult:
    if not ENABLED:
        raise IngestError("This PDF has no text layer (it looks scanned) and OCR is switched off (OCR_ENABLED=0).")
    exe = _tesseract()
    try:
        import pypdfium2
    except ImportError as exc:
        raise IngestError("This PDF has no text layer (it looks scanned) and the OCR extra is not installed. "
                          + HINT) from exc
    langs, extra = _languages(exe, lang)
    try:
        pdf = pypdfium2.PdfDocument(data)
    except Exception as exc:
        raise IngestError(f"Cannot open the PDF for OCR: {exc}") from exc
    n = len(pdf)
    if n > MAX_OCR_PAGES:
        raise IngestError(f"Scanned PDF has {n} pages; OCR is limited to {MAX_OCR_PAGES} (set MAX_OCR_PAGES)")
    texts: list[str] = []
    confs: list[float] = []
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(n):
            img = Path(tmp) / f"p{i}.png"
            pdf[i].render(scale=RENDER_DPI / 72).to_pil().save(img)
            try:
                run = subprocess.run([exe, str(img), "stdout", *extra, "-l", langs, "tsv"], capture_output=True,
                                     text=True, timeout=PAGE_TIMEOUT_S)
            except subprocess.TimeoutExpired as exc:
                raise IngestError(f"OCR of page {i + 1} took longer than {PAGE_TIMEOUT_S} s") from exc
            if run.returncode != 0:
                raise IngestError(f"Tesseract failed on page {i + 1}: {run.stderr.strip()[:200]}")
            text, page_confs = parse_tsv(run.stdout)
            texts.append(text)
            confs += page_confs
            img.unlink()
            if progress:
                progress((i + 1) / n)
    if not confs:
        raise IngestError("OCR found no readable text in this PDF")
    return OcrResult("\n".join(texts), n, sum(confs) / len(confs))
