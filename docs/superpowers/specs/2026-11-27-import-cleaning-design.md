# Import cleaning pipeline — design

## Intent

Imported text should be as clean as possible: no boilerplate, running headers, footers, page numbers, or the
random text web pages carry at their start and end (menus, share buttons, bylines, "related articles", cookie and
subscription notices, copyright lines). Junk in a reference corpus skews frequencies, collocations and
concordances, and a translator should not have to trim every import by hand.

## Goals

- One cleaning stage that runs after extraction for every extracted source: URLs (HTML and PDF) and uploaded
  files of every format.
- Remove, in this order of value: repeated page furniture (headers, footers, page numbers), site furniture
  repeated across pages of the same website, junk at the start and end of web pages, and leftover noise lines.
- Repair text: words hyphenated across line breaks, soft-wrapped lines.
- Show what was removed, so a wrong cut can be spotted and undone in the preview.
- Spanish, Italian and English phrase lists (the languages the interface and typical corpora use); a language
  without a list still gets every step that does not depend on phrases.

## Non-goals

- Pasted text: what the user pastes is what they chose; it is not cleaned.
- Re-cleaning documents already in a corpus. Only new imports are cleaned.
- Sentence files (`sentences` mode), aligned texts (TMX/XLIFF pairs, document alignment) and spreadsheets: lines
  there are records or segments, and removing or joining any would break them or their alignment.
- Job analysis input (`/api/.../job-analysis`): out of scope for now; it can adopt the same stage later.
  `ingest.read_file` gets a `clean: bool = True` parameter; document alignment (`_read_upload`) and job
  analysis pass `clean=False` so they keep today's text.

## Anti-goals

- Cutting real text silently. A false positive in a reference corpus is worse than leftover junk: every
  step is conservative, and every removal is reported.
- Rewording text. Steps only remove whole lines or join/repair line breaks; they never change words.
- External services or heavy models (the app promises "local only").

## Constraints

- Today the URL preview (`/api/preview-url`) and file preview (`/api/preview-file`) return the extracted text,
  the user may edit it, and the import then stores that text via `import_text`. Background URL/file imports
  call `ingest.fetch_url` / `ingest.read_file` directly. So cleaning must live in the extraction path
  (`fetch_url`, `read_file`), not in `importer.add_document`; otherwise the preview would differ from what is
  stored and user edits would be re-cleaned.
- `text_hash` and the near-duplicate fingerprint are computed from the stored (cleaned) text. A document
  imported before this change and imported again afterwards will no longer be "identical"; the near-duplicate
  check will catch it instead (it is what that check is for). Mention this in the docs.
- No new dependencies.

## Approaches considered

1. **Shared rule-based cleaning stage (chosen).** Each extractor yields raw text; an ordered list of small steps
   removes one kind of junk each and records what it removed. Local, transparent, tunable; needs tuning
   against real pages, and the site step improves as more pages of a site are imported.
2. **Better web extraction only** (trafilatura in precision mode, a second extractor). Cheap, but web only.
   Its cheap part is adopted: trafilatura moves from `favor_recall=True` to its default balance (see Steps).
3. **AI model cleaning.** Flexible, but either breaks "local only" or needs a large local model, is slow, and
   may reword text. Rejected.

## Design

### Module

New `src/corpora/cleaning.py`:

```python
@dataclass
class Removal:
    step: str          # step code, e.g. "page_furniture", "site_furniture", "edges", "noise"
    lines: list[str]   # removed lines, in order (capped for reporting, e.g. first 50)

@dataclass
class Cleaned:
    text: str
    removed: list[Removal]
    repaired: dict[str, int]   # counts, e.g. {"hyphenation": 12, "joined_lines": 40}

def clean(pages: list[str], *, fmt: str, lang: str | None, site_lines: Counter | None = None) -> Cleaned
```

`pages` is the text split by page (PDF, OCR) or a one-element list (everything else). `fmt` says which steps
apply. Each step is a plain function, easy to test in isolation.

### Steps (in order)

1. **Page furniture** (paged formats: PDF text layer and OCR). Moved out of `extract_pdf` unchanged in
   behaviour: short lines (< 80 chars) on at least `max(3, pages/2)` pages are removed, plus lines that are only
   a page number. Extended to match numbers inside common page-number shapes (`12`, `- 12 -`, `Page 12`,
   `Página 12 de 40`, `Pag. 12`, `12/40`), and to treat lines that differ only in their digits as the same line
   (so "Report 2024 — page 3" and "… page 4" count as one header). OCR output now gets this step too: OCR
   returns per-page text for that.
2. **Site furniture** (HTML only). Lines of the new page that also appear in at least 2 other non-deleted
   documents from the same host in the same corpus are removed when they are short (< 120 chars) and lie in
   the first or last 25 % of the page's lines. The comparison uses the *raw* extracted lines of the other
   pages, not their stored (cleaned, possibly edited) text: each document stores the hashes of its raw lines
   (see "Raw line hashes" below). Lines are normalised (case, whitespace) before hashing. With fewer than 2
   other pages from the host the step does nothing.
3. **Edges** (HTML only). From the start, then from the end, drop consecutive lines that look like chrome until
   the first line that looks like body text. Chrome: matches a phrase list (share/follow/subscribe/cookies/
   related/read more/tags/copyright/"all rights reserved", per language), is a date or byline alone, or is
   short (< 40 chars) without sentence-ending punctuation. Body text: ≥ 60 chars, or ends a sentence and has ≥ 6
   words. Never removes more than 30 % of the page's characters; if it would, the step does nothing for that edge.
4. **Noise lines** (all cleaned formats). Remove lines with no letters (only digits, punctuation, symbols)
   that are not table rows (`a | b | c`).
5. **Repairs** (paged formats). The existing de-hyphenation and soft-wrap joining from `extract_pdf`, moved here.

`normalize_text` stays as it is and runs last.

Which steps apply:

| Format | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| PDF (text layer, OCR) | ✓ | | | ✓ | ✓ |
| HTML (URL or `.html` upload) | | ✓ (URL only) | ✓ | ✓ | |
| DOCX, ODT, RTF, TXT, MD, SRT/VTT, XLIFF | | | | ✓ | |
| XLSX/CSV/TSV | not cleaned | | | | |

Web extraction: trafilatura switches from `favor_recall=True` to its default (neither recall nor precision),
which keeps less sidebar text; edges and site furniture then catch what remains. Keep `deduplicate=True`.

### Wiring

- `ingest.extract_pdf` returns pages instead of doing furniture removal and repairs itself; `ocr.ocr_pdf`
  exposes per-page text.
- `ingest.fetch_url(url, polite, corpus_id=None)` and `ingest.read_file(..., corpus_id=None)` call
  `cleaning.clean` and add `removed` and `repaired` to their result dict. `corpus_id` is needed only for site
  furniture; `/api/preview-url` gains an optional `corpus_id` (the file preview already has one).
- PDF quality is scored on the cleaned text, as today.

### Raw line hashes (decided by the user)

- New migration: `documents.line_hashes BLOB` (nullable; older documents have none), plus a `host TEXT NOT NULL
  DEFAULT ''` column indexed on `(corpus_id, host)` so the site step finds a host's pages without parsing every
  `source`. `host` is filled for URL imports (and backfilled for existing URL documents in the migration).
- Content: the sorted, de-duplicated 8-byte hashes (e.g. first 8 bytes of blake2b) of the normalised raw lines
  shorter than 120 chars, the only ones the site step considers. A page of a few hundred lines costs a few KB.
- Write path: `fetch_url`/`read_file` return `line_hashes` alongside the text; the preview passes them back on
  import (as it does the title and text), and background imports pass them straight through
  `import_text` → `add_document`, which stores them. If they are missing (pasted text, older clients) nothing
  is stored and that document is simply not used by the site step.
- The site step counts, for each line hash of the new page, how many other non-deleted documents of the same
  corpus and host contain it. It reads at most the 200 most recent such documents.
- This also makes a later "clean again" action for a site's first pages possible; that action is not part of
  this design.
- Off switch: environment variable `IMPORT_CLEANING=0` skips steps 1–4 (repairs still run, as today for PDFs).

### What the user sees

- **Preview** (URL and file): under the quality line, a collapsed "Removed while cleaning: N lines" disclosure,
  grouped by step with a plain label ("Repeated on every page", "Repeated on other pages of this site",
  "Menus and links at the start or end", "Lines without words"). The removed lines are listed (display capped,
  e.g. first 50 per group, with "and N more"); `Removal.lines` itself is uncapped. Labels in en/es/it.
- **Put back** (decided while writing up): a per-group "Put back" re-runs cleaning with that step skipped, so the
  result is exact even where repairs joined lines across a removed header. The preview response includes the
  raw extracted pages (`raw`, as returned before cleaning); a new `POST /api/clean` takes `raw`, `fmt`,
  `corpus_id`, `source` and `skip` (step codes) and returns the cleaned text and removals, without fetching or
  re-uploading anything. If the user has edited the text, "Put back" first asks to confirm that their edits will
  be discarded.
- **Background imports** (URL lists, uploads): the job result's warnings include one line, e.g. "Cleaning
  removed 14 lines (headers, site menus)". No per-line detail there.
- **Docs**: `docs/importing.md` gains a "Cleaning" section listing the steps, the off switch, and the
  re-import/duplicate note.

### Tests

- Unit tests per step in `tests/test_cleaning.py` with small synthetic inputs, including the guard cases
  (edge step never removes > 30 %, site step needs ≥ 2 other pages, table rows survive noise removal).
- Fixtures: a few saved real-world HTML pages (news article, blog, institutional page) in es/it/en under
  `tests/fixtures/web/`, asserting the article body is kept and named chrome lines are gone.
- Existing PDF tests (`test_pdftext.py`, `test_extraction_flags.py`) keep passing after the move.
- Frontend: preview shows the removed-lines disclosure and "Put back" restores lines.

## Left to the builder

- Exact phrase lists and thresholds, tuned on the fixtures.
- How removed-line positions are represented for "Put back".
- Whether site furniture reads all of a host's documents or a recent sample (cap for performance).

## Changes made while building

- **Edges step (after testing on real pages):** a short line without sentence punctuation is removed only when a
  clear chrome marker (a chrome phrase, a date line or a byline) sits between it and the page edge; with no
  marker nothing is removed. Lines ending in ":" and list items are never chrome. Bare "cookies"/"copyright" no
  longer mark a line as chrome; cookie-notice phrases and "©" do. See `docs/importing.md`.
- **Page furniture:** header lines that differ only in digits are matched only on a page's first and last line,
  and never when the line reads like a sentence.
- **Line hashes** are stored for web pages only (the only format the site step reads).
- **`extract_html` / `extract_pdf`** were removed; `fetch_url` and `read_file` are the entry points.
