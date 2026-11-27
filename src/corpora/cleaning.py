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
MAX_HASHED_LEN = 120       # only short lines are hashed for cross-document furniture detection
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


def _page_furniture(pages: Pages) -> tuple[Pages, list[str]]:
    """Running headers/footers (short lines repeated on many pages, digits aside) and page-number lines."""
    def key(ln: str) -> str:
        return re.sub(r"\d+", "#", norm_line(ln))
    counts: Counter = Counter()
    for p in pages:
        counts.update({key(ln) for ln in p if len(ln) < MAX_FURNITURE_LEN})
    threshold = max(3, len(pages) // 2)
    repeated = {k for k, c in counts.items() if c >= threshold}
    kept, removed = [], []
    for p in pages:
        keep = []
        for ln in p:
            if (len(ln) < MAX_FURNITURE_LEN and key(ln) in repeated) or PAGE_NUMBER.match(ln):
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
