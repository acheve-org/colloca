"""Reading order and quality of PDF text (T24).

`pypdf` returns a page's text in the order it was drawn, which for a two-column article or a table is not the order
a person reads. Here the text fragments of a page are collected with their positions (pypdf's visitor), grouped into
lines, and then read column by column; rows of a table are kept as rows (cells joined by " | "). A quality score
looks at the finished text and says when it looks garbled, so the user can check it before adding it to a corpus.

Everything is heuristic: it works from positions only (no fonts metrics, no ruling lines), so unusual layouts fall
back to the order pypdf gives. The limits are listed in the README."""
import re
from dataclasses import dataclass
from statistics import median

ROW_END = "⁣"            # invisible separator closing a table row; keeps the soft-wrap join away from rows
CELL_SEP = " | "
_CHAR_WIDTH = 0.5             # a character is about half its font size wide (positions give only where a run starts)


@dataclass
class Frag:
    x: float
    y: float
    size: float
    text: str

    @property
    def end(self) -> float:
        return self.x + len(self.text) * self.size * _CHAR_WIDTH


@dataclass
class Cell:
    x: float
    end: float
    text: str


def fragments(page) -> list[Frag]:
    """The text runs of a page with the position where each starts (user space, y up)."""
    out: list[Frag] = []

    def visit(text, cm, tm, font_dict, font_size):
        if not text or not text.strip():
            return
        tx, ty = tm[4], tm[5]
        x = tx * cm[0] + ty * cm[2] + cm[4]
        y = tx * cm[1] + ty * cm[3] + cm[5]
        scale = abs(tm[0] * cm[0]) or 1.0          # text matrices often carry the font size as a scale
        out.append(Frag(float(x), float(y), float(font_size or 0) * scale if font_size else 10.0, text))

    page.extract_text(visitor_text=visit)
    # a size of 0 (some producers put the size in the matrix only) falls back to the commonest size
    sizes = [f.size for f in out if f.size > 0]
    base = median(sizes) if sizes else 10.0
    for f in out:
        if f.size <= 0:
            f.size = base
    return out


def _lines(frags: list[Frag]) -> list[list[Frag]]:
    """Fragments grouped by baseline, top to bottom, each line left to right."""
    lines: list[list[Frag]] = []
    for f in sorted(frags, key=lambda f: (-f.y, f.x)):
        if lines and abs(lines[-1][0].y - f.y) <= 0.45 * max(f.size, lines[-1][0].size):
            lines[-1].append(f)
        else:
            lines.append([f])
    for ln in lines:
        ln.sort(key=lambda f: f.x)
    return lines


def _cells(line: list[Frag]) -> list[Cell]:
    """Runs on one line, merged when they touch, so two cells are separated by a visible gap."""
    cells: list[Cell] = []
    for f in line:
        gap = 2.2 * f.size
        if cells and f.x - cells[-1].end <= gap:
            c = cells[-1]
            glue = " " if f.x - c.end > 0.15 * f.size else ""
            cells[-1] = Cell(c.x, max(c.end, f.end), c.text + glue + f.text)
        else:
            cells.append(Cell(f.x, f.end, f.text))
    return cells


def _is_table(rows: list[list[Cell]]) -> bool:
    """Three or more consecutive multi-cell lines of short cells: a table, not running text in columns."""
    if len(rows) < 3:
        return False
    lengths = [len(c.text.strip()) for r in rows for c in r]
    return sum(lengths) / len(lengths) <= 32


def _join(cells: list[Cell]) -> str:
    return " ".join(c.text.strip() for c in cells if c.text.strip())


def read_page(frags: list[Frag], width: float) -> str:
    """The page's text in reading order, one line per line of text, table rows as `a | b | c`."""
    if not frags:
        return ""
    lines = [(_cells(ln), ln[0].size) for ln in _lines(frags)]
    out: list[str] = []
    i = 0
    while i < len(lines):
        cells, _ = lines[i]
        if len(cells) < 2:
            out.append(_join(cells))
            i += 1
            continue
        j = i                                                     # a run of lines with several cells
        while j < len(lines) and len(lines[j][0]) >= 2:
            j += 1
        # lines inside the run with one cell (a column that ended earlier) stay with their block
        end = j
        while end < len(lines) and len(lines[end][0]) == 1 and lines[end][0][0].end - lines[end][0][0].x < 0.5 * width:
            end += 1
        block = lines[i:end]
        rows = [c for c, _ in block if len(c) >= 2]
        if _is_table(rows) and all(len(c) >= 2 for c, _ in block[:j - i]):
            out.extend(CELL_SEP.join(c.text.strip() for c in cs) + ROW_END for cs, _ in block[:j - i])
            out.extend(_join(cs) for cs, _ in block[j - i:])
        else:
            out.extend(_columns(block, width))
        i = end
    return "\n".join(s for s in out if s)


def _columns(block: list[tuple[list[Cell], float]], width: float) -> list[str]:
    """A block of multi-column text: the left column from top to bottom, then the next one, and so on."""
    starts = sorted(c.x for cells, _ in block for c in cells)
    edges: list[float] = []
    for x in starts:                                               # column left edges: starts far enough apart
        if not edges or x - edges[-1] > 0.15 * width:
            edges.append(x)
    if len(edges) < 2:
        return [_join(cells) for cells, _ in block]

    def column(x: float) -> int:
        return max(k for k, e in enumerate(edges) if x >= e - 0.05 * width)

    streams: list[list[str]] = [[] for _ in edges]
    for cells, _ in block:
        for c in cells:
            streams[column(c.x)].append(c.text.strip())
    return [t for s in streams for t in s]


def page_text(page) -> str:
    """One page in reading order; falls back to pypdf's own order when the layout cannot be read."""
    try:
        frags = fragments(page)
        if frags:
            return read_page(frags, float(page.mediabox.width) or 600.0)
    except Exception:  # noqa: BLE001 - any odd PDF structure: use the plain order instead
        pass
    return page.extract_text() or ""


# --------------------------------------------------------------------------- quality
_VOWELS = set("aeiouáéíóúàèìòùâêîôûäëïöüyAEIOUÁÉÍÓÚÀÈÌÒÙ")
_ONE_LETTER_OK = set("aeoyuiàAEOYUIÀ")


def quality(text: str) -> dict:
    """{"score" 0-100, "level" good|fair|poor, "issues": [{"code", "message"}]} for extracted text."""
    body = text.replace(ROW_END, "")
    lines = [ln for ln in body.splitlines() if ln.strip()]
    chars = [ch for ch in body if not ch.isspace()]
    words = re.findall(r"[^\W\d_]+", body)
    issues: list[tuple[str, float, str]] = []
    if len(chars) < 40 or len(words) < 8:
        return {"score": 0, "level": "poor", "issues": [
            {"code": "no_text", "message": "Almost no text could be read from this PDF."}]}
    odd = sum(1 for ch in chars if ch == "�" or (ord(ch) < 32) or 0xE000 <= ord(ch) <= 0xF8FF) / len(chars)
    if odd > 0.005:
        issues.append(("odd_chars", min(40, odd * 800), "Many characters could not be decoded (� or private symbols): "
                                                         "the PDF's fonts have no text mapping."))
    letters = sum(1 for ch in chars if ch.isalpha()) / len(chars)
    if letters < 0.6:
        issues.append(("symbols", min(25, (0.6 - letters) * 100),
                       "Much of the text is symbols or numbers rather than words."))
    long_words = [w for w in words if len(w) >= 5]
    vowelless = sum(1 for w in long_words if not any(ch in _VOWELS for ch in w)) / max(len(long_words), 1)
    if vowelless > 0.08:
        issues.append(("garbled", min(35, vowelless * 200), "Many words have no vowels: the text looks garbled."))
    single = sum(1 for w in words if len(w) == 1 and w not in _ONE_LETTER_OK) / len(words)
    if single > 0.1:
        issues.append(("split_words", min(30, single * 150), "Words seem to be split into single letters."))
    if len(lines) >= 20:
        short = sum(1 for ln in lines if len(ln) < 20) / len(lines)
        if short > 0.6:
            issues.append(("short_lines", min(20, (short - 0.6) * 80), "Most lines are very short (a table, a form or "
                                                                      "a column layout that was not recognised)."))
        mid = sum(1 for ln in lines if ln[-1].islower() or ln[-1] == ",") / len(lines)
        if mid > 0.5:
            issues.append(("broken_lines", min(25, (mid - 0.5) * 90), "Many lines stop in the middle of a sentence."))
    score = max(0, round(100 - sum(p for _, p, _ in issues)))
    level = "good" if score >= 75 else "fair" if score >= 50 else "poor"
    return {"score": score, "level": level, "issues": [{"code": c, "message": m} for c, _, m in issues]}
