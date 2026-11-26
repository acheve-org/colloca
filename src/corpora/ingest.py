"""Turn URLs and uploaded files into clean plain text."""
import contextlib
import io
import ipaddress
import os
import re
import socket
import threading
import time
import unicodedata
from collections import Counter
from urllib.parse import urljoin, urlparse, urlsplit, urlunsplit

import httpx

MAX_BYTES = int(os.environ.get("MAX_DOWNLOAD_MB", "15")) * 1024 * 1024
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "25")) * 1024 * 1024   # per uploaded file
MAX_UPLOAD_FILES = int(os.environ.get("MAX_UPLOAD_FILES", "50"))              # per upload request
MAX_PDF_PAGES = int(os.environ.get("MAX_PDF_PAGES", "1000"))
MAX_TEXT_CHARS = int(os.environ.get("MAX_TEXT_MB", "10")) * 1024 * 1024       # per document, after extraction
ALLOW_PRIVATE =os.environ.get("ALLOW_PRIVATE_URLS", "") == "1"
USER_AGENT = "corpora/0.1 (personal terminology research)"
URL_DELAY = float(os.environ.get("URL_DELAY_SECONDS", "1"))                  # between two requests to one host (lists)
MAX_URL_LIST = int(os.environ.get("MAX_URL_LIST", "50"))                      # URLs in one list
MAX_URLS_PER_HOST = int(os.environ.get("MAX_URLS_PER_HOST", "20"))            # of them, to the same host
MAX_DISCOVERED = 2000                                                         # links listed from one index page


class IngestError(ValueError):
    pass


# --------------------------------------------------------------------------- helpers
def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text).replace(" ", " ").replace("­", "")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.splitlines()]
    return "\n".join(ln for ln in lines if ln)


def _behind_proxy() -> bool:
    return any(os.environ.get(k) for k in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"))


def _check_public(url: str) -> str | None:
    """Refuse addresses that are not on the public internet. Returns the validated IP address the connection
    must use (see `_download`), or None when no pinning applies: a literal IP, ALLOW_PRIVATE_URLS, or a proxy
    that resolves the name itself."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise IngestError("Only http(s) URLs are supported")
    if ALLOW_PRIVATE:
        return None
    host = parsed.hostname.lower()
    blocked = IngestError("URL points to a private/internal address (blocked). "
                          "Set ALLOW_PRIVATE_URLS=1 to allow it.")
    try:                                    # literal IP address (IngestError is a ValueError: parse only in the try)
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not literal.is_global:
            raise blocked
        return None
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan")):
        raise blocked
    try:
        infos = socket.getaddrinfo(host, parsed.port or (80 if parsed.scheme == "http" else 443),
                                   proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        if _behind_proxy():                 # the proxy resolves names, not this machine
            return None
        raise IngestError(f"Cannot resolve host: {host}") from exc
    addresses = [str(info[4][0]) for info in infos]
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise blocked
    return None if _behind_proxy() else addresses[0]


# Set by tests to answer requests without a network (an httpx transport).
_transport: httpx.BaseTransport | None = None

_last_request: dict[str, float] = {}
_gate = threading.Lock()


def _be_polite(host: str) -> None:
    """Wait until URL_DELAY seconds have passed since the last request to `host` (list imports only)."""
    if URL_DELAY <= 0:
        return
    with _gate:
        wait = _last_request.get(host, 0.0) + URL_DELAY - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_request[host] = time.monotonic()


def _pinned(url: str, ip: str) -> tuple[str, dict, dict]:
    """The request for `url` aimed at the already validated `ip`: the URL carries the address, the Host header
    and the TLS server name keep the host, so certificates are still checked against the host name."""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    literal = f"[{ip}]" if ":" in ip else ip
    netloc = literal + (f":{parsed.port}" if parsed.port else "")
    host_header = host + (f":{parsed.port}" if parsed.port else "")
    return parsed._replace(netloc=netloc).geturl(), {"Host": host_header}, {"sni_hostname": host}


def _fetch(url: str, polite: bool = False) -> tuple[bytes, str, str]:
    """Fetch (body, content type, final URL after redirects) with redirect-by-redirect SSRF checks and a size cap.

    Each hop resolves the host once, checks the answer, and then connects to that very address (DNS rebinding:
    a name that answers differently the second time cannot redirect the connection to an internal address)."""
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "es,it;q=0.9,en;q=0.5"}
    with httpx.Client(timeout=20, follow_redirects=False, headers=headers, transport=_transport,
                      trust_env=_transport is None) as client:
        for _ in range(6):
            ip = _check_public(url)
            if polite:
                _be_polite((urlparse(url).hostname or "").lower())
            target, extra, ext = (_pinned(url, ip) if ip else (url, {}, {}))
            with client.stream("GET", target, headers=extra, extensions=ext) as resp:
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
                return b"".join(chunks), resp.headers.get("content-type", "").lower(), url
    raise IngestError("Too many redirects")


def _download(url: str, polite: bool = False) -> tuple[bytes, str]:
    data, ctype, _ = _fetch(url, polite)
    return data, ctype


def parse_url_list(raw: list[str]) -> tuple[list[str], list[dict]]:
    """The distinct usable http(s) URLs of a pasted list (in order), and the rejected lines with the reason."""
    urls: list[str] = []
    bad: list[dict] = []
    seen: set[str] = set()
    per_host: dict[str, int] = {}
    for line in raw:
        url = line.strip()
        if not url or url.startswith("#"):
            continue
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            bad.append({"url": url, "error": "Not an http(s) address"})
        elif url in seen:
            bad.append({"url": url, "error": "Listed twice"})
        elif len(urls) >= MAX_URL_LIST:
            bad.append({"url": url, "error": f"More than {MAX_URL_LIST} addresses in one list (set MAX_URL_LIST)"})
        elif per_host.get(parsed.hostname.lower(), 0) >= MAX_URLS_PER_HOST:
            bad.append({"url": url, "error": f"More than {MAX_URLS_PER_HOST} addresses of {parsed.hostname} in one "
                                              "list (set MAX_URLS_PER_HOST); add the rest in another list"})
        else:
            seen.add(url)
            per_host[parsed.hostname.lower()] = per_host.get(parsed.hostname.lower(), 0) + 1
            urls.append(url)
    return urls, bad


# --------------------------------------------------------------------------- catalogs
_NON_ARTICLE_SEGMENTS = frozenset({
    "login", "signin", "register", "signup", "search", "tag", "tags", "category", "categories", "author",
    "authors", "cart", "privacy", "contact", "about", "terms", "cookies"})
_TRACKING = ("utm_",)
_TRACKING_EXACT = frozenset({"fbclid", "gclid"})
_FEED_ROOTS = frozenset({"rss", "feed", "rdf"})


def _clean_link(href: str, base: str) -> str | None:
    """An absolute http(s) URL without fragment and tracking parameters, or None (also for a malformed address).
    The query is only touched to drop tracking parameters; otherwise it stays exactly as written."""
    try:
        parts = urlsplit(urljoin(base, href.strip()))
        if parts.scheme not in ("http", "https") or not parts.hostname:
            return None
    except ValueError:
        return None
    if parts.query:
        pairs = parts.query.split("&")
        keep = [p for p in pairs if not p.split("=", 1)[0].lower().startswith(_TRACKING)
                and p.split("=", 1)[0].lower() not in _TRACKING_EXACT]
        parts = parts._replace(query="&".join(keep))
    return urlunsplit(parts._replace(fragment=""))


def _local(tag) -> str:
    return tag.rsplit("}", 1)[-1].lower() if isinstance(tag, str) else ""


def _feed_links(root, base: str) -> tuple[str, list[tuple[str, str]]]:
    title = ""
    out: list[tuple[str, str]] = []
    for el in root.iter():
        name = _local(el.tag)
        if name == "title" and not title and _local(el.getparent().tag) in ("channel", "feed"):
            title = " ".join((el.text or "").split())
        elif name in ("item", "entry"):
            text, href = "", ""
            for child in el:
                cname = _local(child.tag)
                if cname == "title":
                    text = " ".join((child.text or "").split())
                elif cname == "link":
                    if child.get("href"):                         # Atom: prefer rel="alternate" (or none)
                        if not href or child.get("rel", "alternate") == "alternate":
                            href = child.get("href") or ""
                    elif child.text and not href:                 # RSS
                        href = child.text.strip()
            if href:
                out.append((href, text))
    return title, out


def parse_links(data: bytes, base_url: str) -> dict:
    """The links of an index page (or the entries of an RSS/Atom feed): {title, links: [{url, text, same_host}]}.
    Navigation, header, footer and aside links, account/search/tag-style paths, empty links and the page itself
    are left out of HTML pages; fragments and tracking parameters are removed; duplicates are merged."""
    from lxml import etree
    from lxml import html as lxml_html
    root = None
    root = None
    with contextlib.suppress(etree.XMLSyntaxError):
        root = etree.fromstring(data, etree.XMLParser(recover=True, resolve_entities=False, no_network=True))
    is_feed = root is not None and _local(root.tag) in _FEED_ROOTS
    raw: list[tuple[str, str]]
    if is_feed:
        title, raw = _feed_links(root, base_url)
    else:
        try:
            try:                                  # UTF-8 first; otherwise lxml reads the page's own charset
                doc = lxml_html.fromstring(data.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                doc = lxml_html.fromstring(data)
        except (etree.ParserError, ValueError):
            return {"title": "", "links": []}
        title = " ".join(str(doc.xpath("string(//title)")).split())
        bases = doc.xpath("//base/@href")
        if bases:
            with contextlib.suppress(ValueError):
                base_url = urljoin(base_url, bases[0])
        raw = []
        for a in doc.xpath("//a[@href][not(ancestor::nav or ancestor::header or ancestor::footer "
                           "or ancestor::aside)]"):
            text = " ".join(a.text_content().split()) or (a.get("title") or "").strip()
            if text:
                raw.append((a.get("href"), text))
    page = _clean_link(base_url, base_url)
    host = (urlparse(base_url).hostname or "").lower()
    found: dict[str, str] = {}
    for href, text in raw:
        url = _clean_link(href, base_url)
        if not url or (not is_feed and (url == page or
                                        _NON_ARTICLE_SEGMENTS & {s.lower() for s in urlparse(url).path.split("/")})):
            continue
        if len(text) > len(found.get(url, "")) or url not in found:
            found[url] = text
    links = [{"url": u, "text": t, "same_host": (urlparse(u).hostname or "").lower() == host}
             for u, t in found.items()]
    return {"title": title, "links": links}


def discover_links(url: str) -> dict:
    """Fetch an index page or feed and list the links on it (one request; nothing is imported)."""
    data, ctype, url = _fetch(url)               # links resolve against the page we ended up on
    head = data[:2048].lower()
    media = ctype.split(";")[0].strip()
    markup = media in ("text/html", "application/xhtml+xml", "text/xml", "application/xml") or \
        media.endswith("+xml") or "rss" in media or "atom" in media
    if not (markup or (not media.startswith(("application/", "image/", "audio/", "video/")) and
                       any(m in head for m in (b"<html", b"<?xml", b"<rss", b"<feed", b"<!doctype html")))):
        raise IngestError("Not a web page or a feed")
    res = parse_links(data, url)
    truncated = len(res["links"]) > MAX_DISCOVERED
    return {"url": url, "title": res["title"] or urlparse(url).netloc, "links": res["links"][:MAX_DISCOVERED],
            "truncated": truncated, "max_per_request": min(MAX_URL_LIST, MAX_URLS_PER_HOST)}


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


def extract_pdf(data: bytes, lang: str | None = None, notes: list[str] | None = None,
                progress=None, report: dict | None = None) -> str:
    """Text of a PDF, columns read one after the other and table rows kept as rows (see pdftext). Without a text
    layer the pages are OCRed (see ocr.py). `notes` collects warnings; `report`, if given, receives the quality of
    the extracted text under "quality" (see pdftext.quality)."""
    from pypdf import PdfReader

    from . import pdftext
    reader = PdfReader(io.BytesIO(data))
    if len(reader.pages) > MAX_PDF_PAGES:
        raise IngestError(f"PDF has {len(reader.pages)} pages (limit {MAX_PDF_PAGES}; set MAX_PDF_PAGES)")
    pages = [pdftext.page_text(p) for p in reader.pages]
    if not any(p.strip() for p in pages):
        from . import ocr
        res = ocr.ocr_pdf(data, lang, progress)
        if notes is not None:
            notes.append(f"Text recognised by OCR ({res.pages} pages, mean confidence {res.confidence:.0f}%).")
            if res.confidence < ocr.MIN_CONFIDENCE:
                notes.append(f"OCR quality is low (below {ocr.MIN_CONFIDENCE:.0f}%): check the text, expect "
                             "misspelt words and wrong lemmas, or rescan at a higher resolution.")
        return normalize_text(res.text)
    # drop running headers/footers: short lines repeated on many pages
    line_pages: Counter = Counter()
    for p in pages:
        for ln in {ln.strip() for ln in p.splitlines() if ln.strip()}:
            line_pages[ln] += 1
    threshold = max(3, len(pages) // 2)
    repeated = {ln for ln, c in line_pages.items() if c >= threshold and len(ln) < 80}
    out = []
    for p in pages:
        lines = [ln.strip() for ln in p.splitlines() if ln.strip() and ln.strip() not in repeated
                 and not re.fullmatch(r"\d{1,4}", ln.strip())]
        out.append("\n".join(lines))
    text = "\n".join(out)
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)           # de-hyphenate line breaks
    # join soft-wrapped lines: a line that doesn't end a sentence continues on the next one (never a table row)
    text = re.sub(rf"(?<![.!?:;»”\"{pdftext.ROW_END}])\n(?=[a-zà-ÿ0-9(¿¡«“\"])", " ", text)
    text = normalize_text(text.replace(pdftext.ROW_END, ""))
    score = pdftext.quality(text)
    if report is not None:
        report["quality"] = score
    if notes is not None and score["level"] != "good":
        notes.append(f"The text of this PDF may be unreliable (quality {score['score']}/100, {score['level']}): "
                     + " ".join(i["message"] for i in score["issues"]) + " Check the preview before adding it.")
    return text


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


def decode_bytes(data: bytes) -> str:
    """Raw text of a file, without normalisation (tabs and blank lines are kept)."""
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise IngestError("Cannot decode text file")


def decode_text(data: bytes) -> str:
    return normalize_text(decode_bytes(data))


# --------------------------------------------------------------------------- entry points
def fetch_url(url: str, polite: bool = False) -> dict:
    data, ctype = _download(url, polite)
    extra: dict = {}
    if "pdf" in ctype or data[:5] == b"%PDF-":
        notes: list[str] = []
        text, title, fmt = extract_pdf(data, None, notes, None, extra), "", "pdf"
        extra["warnings"] = notes
    elif "html" in ctype or "xml" in ctype or b"<html" in data[:2048].lower():
        title, text = extract_html(data)
        fmt = "html"
    elif ctype.startswith("text/"):
        text, title, fmt = decode_text(data), "", "text"
    else:
        raise IngestError(f"Unsupported content type: {ctype or 'unknown'}")
    return {"url": url, "title": title or urlparse(url).netloc, "text": text, "format": fmt, **extra}


MIN_ARTICLE_CHARS = 300
_BOILERPLATE = re.compile(
    r"enable javascript|javascript (is )?(required|disabled)|accept (all )?cookies|we use cookies|"
    r"subscribe to (read|continue)|sign in to (read|continue)|"
    r"aceptar (las |todas las )?cookies|(activa|habilita|activar|habilitar) javascript|suscr[ií]bete para|"
    r"accetta (i|tutti i) cookie|abilita javascript|abbonati per|"
    r"cookies? (policy|consent)|política de cookies", re.IGNORECASE)


def extraction_warnings(page: dict, url: str) -> list[str]:
    """Reasons to doubt that a fetched page is an article (the document is imported anyway)."""
    text, title = page["text"], page["title"].strip()
    out = []
    if len(text) < MIN_ARTICLE_CHARS:
        out.append(f"Very short text ({len(text)} characters): the page may not be an article.")
    if _BOILERPLATE.search(text[:500]):
        out.append("The text starts with cookie, JavaScript or paywall boilerplate: check the extraction.")
    if page.get("format", "html") == "html" and title.lower() == urlparse(url).netloc.lower():
        out.append("The page has no title of its own (landing page or index?).")
    return out


READ_EXTENSIONS = (".docx", ".pdf", ".odt", ".rtf", ".xlsx", ".csv", ".tsv", ".xlf", ".xliff", ".srt", ".vtt",
                   ".txt", ".md", ".html", ".htm")


def read_file(filename: str, data: bytes, lang: str | None = None, columns: str = "", progress=None) -> dict:
    """{"title", "text", "warnings"}. `lang` (corpus language, es/it) selects the OCR language and the side of an
    XLIFF to read; `columns` picks the text columns of a spreadsheet (see formats.select_text_columns)."""
    from . import formats
    ext = os.path.splitext(filename)[1].lower()
    title = os.path.splitext(os.path.basename(filename))[0]
    notes: list[str] = []
    extra: dict = {}
    if ext == ".docx":
        text = extract_docx(data)
    elif ext == ".pdf":
        text = extract_pdf(data, lang, notes, progress, extra)
    elif ext == ".odt":
        text = formats.extract_odt(data)
    elif ext == ".rtf":
        text = formats.extract_rtf(data)
    elif ext in (".xlsx", ".csv", ".tsv"):
        text = formats.extract_table(filename, data, columns)
    elif ext in (".xlf", ".xliff"):
        text = formats.extract_xliff(data, lang)
    elif ext in (".srt", ".vtt"):
        text = formats.extract_subtitles(data)
    elif ext in (".html", ".htm"):
        title2, text = extract_html(data)
        title = title2 or title
    elif ext in (".txt", ".md", ".text", ""):
        text = decode_text(data)
    else:
        raise IngestError(f"Unsupported file type '{ext}' (use .docx, .pdf, .odt, .rtf, .xlsx, .csv, .xlf, .srt, "
                          ".vtt, .txt, .md, .html)")
    if not text.strip():
        raise IngestError("File contains no text")
    return {"title": title, "text": text, "warnings": notes, **extra}
