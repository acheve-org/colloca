"""Turn URLs and uploaded files into clean plain text."""
import io
import ipaddress
import os
import re
import socket
import unicodedata
from collections import Counter
from urllib.parse import urljoin, urlparse

import httpx

MAX_BYTES = int(os.environ.get("MAX_DOWNLOAD_MB", "15")) * 1024 * 1024
ALLOW_PRIVATE = os.environ.get("ALLOW_PRIVATE_URLS", "") == "1"
USER_AGENT = "corpus-tool/0.1 (personal terminology research)"


class IngestError(ValueError):
    pass


# --------------------------------------------------------------------------- helpers
def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text).replace(" ", " ").replace("­", "")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.splitlines()]
    return "\n".join(ln for ln in lines if ln)


def _behind_proxy() -> bool:
    return any(os.environ.get(k) for k in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"))


def _check_public(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise IngestError("Only http(s) URLs are supported")
    if ALLOW_PRIVATE:
        return
    host = parsed.hostname.lower()
    blocked = IngestError("URL points to a private/internal address (blocked). "
                          "Set ALLOW_PRIVATE_URLS=1 to allow it.")
    try:                                    # literal IP address
        if not ipaddress.ip_address(host).is_global:
            raise blocked
        return
    except ValueError:
        pass
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan")):
        raise blocked
    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        if _behind_proxy():                 # the proxy resolves names, not this machine
            return
        raise IngestError(f"Cannot resolve host: {host}") from exc
    for info in infos:
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise blocked


def _download(url: str) -> tuple[bytes, str]:
    """Fetch with redirect-by-redirect SSRF checks and a size cap."""
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "es,it;q=0.9,en;q=0.5"}
    with httpx.Client(timeout=20, follow_redirects=False, headers=headers) as client:
        for _ in range(6):
            _check_public(url)
            with client.stream("GET", url) as resp:
                if resp.is_redirect:
                    url = urljoin(url, resp.headers.get("location", ""))
                    continue
                if resp.status_code >= 400:
                    raise IngestError(f"Server answered HTTP {resp.status_code}")
                chunks, size = [], 0
                for chunk in resp.iter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise IngestError(f"Download larger than {MAX_BYTES // 1024 // 1024} MB")
                    chunks.append(chunk)
                return b"".join(chunks), resp.headers.get("content-type", "").lower()
    raise IngestError("Too many redirects")


# --------------------------------------------------------------------------- formats
def extract_html(data: bytes) -> tuple[str, str]:
    import trafilatura
    text = trafilatura.extract(data, include_comments=False, include_tables=True,
                               include_links=False, deduplicate=True, favor_recall=True)
    if not text or len(text.strip()) < 40:
        raise IngestError("No main text could be extracted (page may need JavaScript or a login)")
    meta = trafilatura.extract_metadata(data)
    title = (meta.title if meta and meta.title else "").strip()
    return title, normalize_text(text)


def extract_pdf(data: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    pages = [(p.extract_text() or "") for p in reader.pages]
    if not any(p.strip() for p in pages):
        raise IngestError("PDF has no text layer (scanned PDFs need OCR, not supported yet)")
    # drop running headers/footers: short lines repeated on many pages
    line_pages = Counter()
    for p in pages:
        for ln in {l.strip() for l in p.splitlines() if l.strip()}:
            line_pages[ln] += 1
    threshold = max(3, len(pages) // 2)
    repeated = {ln for ln, c in line_pages.items() if c >= threshold and len(ln) < 80}
    out = []
    for p in pages:
        lines = [l.strip() for l in p.splitlines() if l.strip() and l.strip() not in repeated
                 and not re.fullmatch(r"\d{1,4}", l.strip())]
        out.append("\n".join(lines))
    text = "\n".join(out)
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)           # de-hyphenate line breaks
    # join soft-wrapped lines: a line that doesn't end a sentence continues on the next one
    text = re.sub(r"(?<![.!?:;»”\"])\n(?=[a-zà-ÿ0-9(¿¡«“\"])", " ", text)
    return normalize_text(text)


def extract_docx(data: bytes) -> str:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    doc = Document(io.BytesIO(data))
    parts = []
    for child in doc.element.body.iterchildren():
        if child.tag.endswith("}p"):
            parts.append(Paragraph(child, doc).text)
        elif child.tag.endswith("}tbl"):
            for row in Table(child, doc).rows:
                for cell in row.cells:
                    parts.append(cell.text)
    return normalize_text("\n".join(parts))


def decode_text(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return normalize_text(data.decode(enc))
        except UnicodeDecodeError:
            continue
    raise IngestError("Cannot decode text file")


# --------------------------------------------------------------------------- entry points
def fetch_url(url: str) -> dict:
    data, ctype = _download(url)
    if "pdf" in ctype or data[:5] == b"%PDF-":
        text, title = extract_pdf(data), ""
    elif "html" in ctype or "xml" in ctype or b"<html" in data[:2048].lower():
        title, text = extract_html(data)
    elif ctype.startswith("text/"):
        text, title = decode_text(data), ""
    else:
        raise IngestError(f"Unsupported content type: {ctype or 'unknown'}")
    return {"url": url, "title": title or urlparse(url).netloc, "text": text}


def read_file(filename: str, data: bytes) -> dict:
    ext = os.path.splitext(filename)[1].lower()
    title = os.path.splitext(os.path.basename(filename))[0]
    if ext == ".docx":
        text = extract_docx(data)
    elif ext == ".pdf":
        text = extract_pdf(data)
    elif ext in (".html", ".htm"):
        title2, text = extract_html(data)
        title = title2 or title
    elif ext in (".txt", ".md", ".text", ""):
        text = decode_text(data)
    else:
        raise IngestError(f"Unsupported file type '{ext}' (use .docx, .pdf, .txt, .md, .html)")
    if not text.strip():
        raise IngestError("File contains no text")
    return {"title": title, "text": text}
