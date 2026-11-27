"""Import cleaning: removes whole lines that are not body text (page furniture, noise) and repairs PDF line breaks.

A pure module: `clean` takes the text of a document as a list of pages and returns the cleaned text with what was
removed and repaired. Steps only remove whole lines or repair line breaks; they never change words.
`IMPORT_CLEANING=0` skips the removal steps; PDF repairs still run."""

import hashlib
import os
import re
from collections import Counter
from collections.abc import Collection
from dataclasses import dataclass, field

from . import pdftext

STEPS = ("page_furniture", "site_furniture", "edges", "noise")

MAX_FURNITURE_LEN = 80     # running headers/footers are short lines
FURNITURE_ZONE = 1         # first/last lines of a page where headers may differ in digits (page numbers, dates)
MAX_HASHED_LEN = 120      # only short lines are hashed for cross-document furniture detection
PAGE_NUMBER = re.compile(r"(?i)^[-–—\s]*(p(á|a)g(ina|e|\.)?\s*)?\d{1,4}(\s*(de|di|of|/)\s*\d{1,4})?[-–—\s]*$")
HYPHENATED = re.compile(r"(\w)-\n(\w)")
# a line that doesn't end a sentence continues on the next one (never a table row)
SOFT_WRAP = re.compile(rf"(?<![.!?:;»”\"{pdftext.ROW_END}])\n(?=[a-zà-ÿ0-9(¿¡«“\"])")

# Web page chrome (menus, share buttons, related links, footers) found at the start or end of extracted text.
# "shared" is checked for every language; phrases match whole words, case-insensitively.
CHROME_PHRASES: dict[str, list[str]] = {
    "shared": ["©", "cookies", "facebook", "twitter", "whatsapp", "instagram", "linkedin", "telegram", "newsletter",
               "copyright"],
    "es": ["compartir", "comparte", "síguenos", "suscríbete", "suscripción", "relacionados", "relacionadas",
           "leer más", "lee también", "etiquetas", "todos los derechos reservados", "aviso legal",
           "política de privacidad"],
    "it": ["condividi", "seguici", "iscriviti", "abbonati", "correlati", "correlate", "leggi anche", "leggi di più",
           "tag", "tutti i diritti riservati", "privacy policy"],
    "en": ["share", "follow us", "subscribe", "related", "read more", "tags", "all rights reserved",
           "privacy policy"],
}
# Phrases that make a line chrome whatever its length (up to EDGE_STRONG_LEN): cookie notices, copyright lines,
# newsletter sign-ups. "shared" is checked for every language.
STRONG_CHROME_PHRASES: dict[str, list[str]] = {
    "shared": ["©", "cookies", "cookie policy", "copyright"],
    "es": ["todos los derechos reservados", "política de cookies", "suscríbete a nuestra newsletter",
           "suscríbete a nuestro boletín", "suscríbete al boletín"],
    "it": ["tutti i diritti riservati", "utilizza cookie", "usa cookie", "iscriviti alla newsletter",
           "iscriviti alla nostra newsletter"],
    "en": ["all rights reserved", "subscribe to our newsletter", "sign up for our newsletter"],
}
EDGE_STRONG_LEN = 300      # a line with a strong chrome phrase is chrome up to this length
EDGE_CHROME_LEN = 40       # a short line without sentence-ending punctuation is chrome at the edges
EDGE_BODY_LEN = 60         # a line this long is body text
EDGE_MAX_SHARE = 0.3       # an edge run longer than this share of the page's characters is left alone
_MONTHS = ("enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|"
           "gennaio|febbraio|aprile|maggio|giugno|luglio|settembre|ottobre|dicembre|"
           "january|february|march|april|may|june|july|august|september|october|november|december|"
           r"[a-z]{3}\.?")
DATE_LINE = re.compile(
    rf"(?i)^((publicado|actualizado|pubblicato|aggiornato|published|updated)( el| il| on)?:?\s*)?"
    rf"([a-zà-ú]+,?\s+)?"                                                   # weekday
    rf"(\d{{1,2}}(\s+de)?\s+({_MONTHS})(\s+de)?,?\s+\d{{4}}"               # 12 de marzo de 2025, 3 febbraio 2025
    rf"|({_MONTHS})\s+\d{{1,2}},?\s+\d{{4}}"                                # March 12, 2025
    rf"|\d{{1,2}}[/.-]\d{{1,2}}[/.-]\d{{2,4}}|\d{{4}}-\d{{2}}-\d{{2}})"          # 12/03/2025, 2025-03-12
    rf"([\s,·|-]+(a las\s+|alle\s+|at\s+)?\d{{1,2}}[:.]\d{{2}}(\s*h)?)?\s*$")  # time
BYLINE = re.compile(r"^(por|di|by)\s+(\w[\w.'-]*\s*){1,4}$", re.IGNORECASE)


@dataclass
class Removal:
    step: str
    lines: list[str]


@dataclass
class Cleaned:
    text: str
    removed: list[Removal] = field(default_factory=list)
    repaired: dict[str, int] = field(default_factory=dict)
    line_hashes: bytes = b""


def enabled() -> bool:
    return os.environ.get("IMPORT_CLEANING", "1") != "0"


def norm_line(line: str) -> str:
    return " ".join(line.lower().split())


def line_hash(line: str) -> bytes:
    return hashlib.blake2b(norm_line(line).encode(), digest_size=8).digest()


def line_hashes(pages: list[str]) -> bytes:
    hashes = {line_hash(ln) for p in pages for ln in p.splitlines()
              if (n := norm_line(ln)) and len(n) < MAX_HASHED_LEN}
    return b"".join(sorted(hashes))


# --------------------------------------------------------------------------- steps
# Each step takes the pages as lists of lines and returns (kept pages, removed lines).
Pages = list[list[str]]


def _sentence_like(ln: str) -> bool:
    return ln.endswith((".", "!", "?", "…")) and len(ln.split()) >= 5


def _page_furniture(pages: Pages) -> tuple[Pages, list[str]]:
    """Running headers/footers and page-number lines. A short line repeated verbatim on many pages is furniture
    anywhere on the page; within a page's header/footer zone (its first and last FURNITURE_ZONE lines, sentences
    aside) lines are compared with digits ignored, so "Report — page 3" and "Report — page 4" count as one header."""
    def key(ln: str) -> str:
        return re.sub(r"\d+", "#", norm_line(ln))

    def zone(p: list[str]) -> set[int]:
        """Indexes of the lines that may be matched with digits ignored: the first and last FURNITURE_ZONE lines of
        the page, unless they read like a sentence (headers rarely do)."""
        n = len(p)
        edge = set(range(min(FURNITURE_ZONE, n))) | set(range(max(0, n - FURNITURE_ZONE), n))
        return {i for i in edge if not _sentence_like(p[i])}

    exact: Counter = Counter()
    fuzzy: Counter = Counter()
    zones = [zone(p) for p in pages]
    for p, z in zip(pages, zones, strict=True):
        exact.update({ln for ln in p if len(ln) < MAX_FURNITURE_LEN})
        fuzzy.update({key(p[i]) for i in z if len(p[i]) < MAX_FURNITURE_LEN})
    threshold = max(3, len(pages) // 2)
    rep_exact = {ln for ln, c in exact.items() if c >= threshold}
    rep_fuzzy = {k for k, c in fuzzy.items() if c >= threshold}
    kept, removed = [], []
    for p, z in zip(pages, zones, strict=True):
        keep = []
        for i, ln in enumerate(p):
            if (ln in rep_exact or PAGE_NUMBER.match(ln)
                    or (len(ln) < MAX_FURNITURE_LEN and i in z and key(ln) in rep_fuzzy)):
                removed.append(ln)
            else:
                keep.append(ln)
        kept.append(keep)
    return kept, removed


def _site_furniture(pages: Pages, site_counts: Counter[bytes]) -> tuple[Pages, list[str]]:
    return pages, []        # Task 4


def _phrase_pattern(table: dict[str, list[str]], lang: str | None) -> re.Pattern:
    phrases = table["shared"] + table.get(lang or "", [])
    return re.compile("|".join(rf"(?<!\w){re.escape(p)}(?!\w)" for p in phrases), re.IGNORECASE)


def _is_chrome(ln: str, phrases: re.Pattern, strong: re.Pattern) -> bool:
    """A line of page chrome: a chrome phrase, a date or byline alone, or a short line that is no sentence. A line
    of EDGE_BODY_LEN characters or more is body text unless it has a strong chrome phrase (cookie notices,
    copyright, newsletter sign-ups; up to EDGE_STRONG_LEN); a shorter sentence is chrome only if it has a chrome
    phrase ("© 2025 El Diario. Todos los derechos reservados.")."""
    if len(ln) <= EDGE_STRONG_LEN and strong.search(ln):
        return True
    if len(ln) >= EDGE_BODY_LEN:
        return False
    return bool(phrases.search(ln) or DATE_LINE.match(ln) or BYLINE.match(ln)
                or (len(ln) < EDGE_CHROME_LEN and not ln.endswith((".", "!", "?", "…"))))


def _edges(lines: list[str], lang: str | None) -> tuple[list[str], list[str]]:
    """Web page chrome at the start and end of a page: from each edge, consecutive chrome lines are dropped until
    the first line that is not chrome. An edge whose run holds more than EDGE_MAX_SHARE of the page's characters
    is left untouched."""
    phrases = _phrase_pattern(CHROME_PHRASES, lang)
    strong = _phrase_pattern(STRONG_CHROME_PHRASES, lang)
    total = sum(len(ln) for ln in lines)

    def run(seq: list[str]) -> int:
        n = 0
        while n < len(seq) and _is_chrome(seq[n], phrases, strong):
            n += 1
        return n if sum(len(ln) for ln in seq[:n]) <= EDGE_MAX_SHARE * total else 0

    start = run(lines)
    end = len(lines) - run(lines[start:][::-1])
    return lines[start:end], lines[:start] + lines[end:]


def _edges_pages(pages: Pages, lang: str | None) -> tuple[Pages, list[str]]:
    kept, removed = [], []
    for p in pages:
        k, r = _edges(p, lang)
        kept.append(k)
        removed += r
    return kept, removed


def _is_noise(ln: str) -> bool:
    return not any(ch.isalpha() for ch in ln) and pdftext.ROW_END not in ln and " | " not in ln


def _noise(pages: Pages) -> tuple[Pages, list[str]]:
    """Lines with no letter at all (rules, ornaments, stray symbols), table rows aside."""
    removed = [ln for p in pages for ln in p if _is_noise(ln)]
    return [[ln for ln in p if not _is_noise(ln)] for p in pages], removed


def _repair(text: str) -> tuple[str, dict[str, int]]:
    text, hyphens = HYPHENATED.subn(r"\1\2", text)
    text, joins = SOFT_WRAP.subn(" ", text)
    return text, {"hyphenation": hyphens, "joined_lines": joins}


# --------------------------------------------------------------------------- entry point
def clean(pages: list[str], *, fmt: str, lang: str | None = None, site_counts: Counter[bytes] | None = None,
          skip: Collection[str] = ()) -> Cleaned:
    """Clean a document given as pages (`fmt` is "pdf", "html" or "text"). `lang` picks the edges step's
    phrase list; `site_counts` maps line hashes to the number of documents of the same site they appear on."""
    from .ingest import normalize_text

    hashes = line_hashes(pages)
    lines: Pages = [[s for ln in p.splitlines() if (s := ln.strip())] for p in pages]
    run = set(STEPS) - set(skip) if enabled() else set()
    steps = [
        ("page_furniture", fmt == "pdf", _page_furniture),
        ("site_furniture", fmt == "html" and site_counts is not None, lambda ps: _site_furniture(ps, site_counts)),
        ("edges", fmt == "html", lambda ps: _edges_pages(ps, lang)),
        ("noise", True, _noise),
    ]
    removed: list[Removal] = []
    for name, applies, step in steps:
        if applies and name in run:
            lines, gone = step(lines)
            if gone:
                removed.append(Removal(name, gone))
    text = "\n".join(ln for p in lines for ln in p)
    repaired: dict[str, int] = {}
    if fmt == "pdf":
        text, repaired = _repair(text)
        text = text.replace(pdftext.ROW_END, "")
    return Cleaned(normalize_text(text), removed, repaired, hashes)
