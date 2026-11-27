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


def _edges(pages: Pages) -> tuple[Pages, list[str]]:
    return pages, []        # Task 2


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
    """Clean a document given as pages (`fmt` is "pdf", "html" or "text"). `lang` is reserved for language-aware
    steps; `site_counts` maps line hashes to the number of documents of the same site they appear on."""
    from .ingest import normalize_text

    hashes = line_hashes(pages)
    lines: Pages = [[s for ln in p.splitlines() if (s := ln.strip())] for p in pages]
    run = set(STEPS) - set(skip) if enabled() else set()
    steps = [
        ("page_furniture", fmt == "pdf", _page_furniture),
        ("site_furniture", fmt == "html" and site_counts is not None, lambda ps: _site_furniture(ps, site_counts)),
        ("edges", fmt == "html", _edges),
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
