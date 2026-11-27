# Import Cleaning Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every URL and uploaded file goes through one cleaning stage after extraction that removes headers,
footers, page numbers, site furniture and web-page edge junk, reports what it removed, and lets the preview
put any group back.

**Architecture:** A pure module `src/corpora/cleaning.py` holds the steps and `clean()`; extractors in
`ingest.py` hand it raw pages and return the cleaned text plus `removed`, `repaired`, `raw` and `line_hashes`.
Each document stores hashes of its raw short lines and its host (migration v16), which the site-furniture step
counts across a host's other pages. The preview shows removals and re-cleans through `POST /api/clean` with a
step skipped.

**Tech Stack:** Python 3.14, FastAPI, SQLite, pypdf, trafilatura, pytest; Svelte 5 + vitest frontend.

**Spec:** `docs/superpowers/specs/2026-11-27-import-cleaning-design.md`

## Global Constraints

- No new dependencies.
- Steps only remove whole lines or repair line breaks; they never change words.
- Not cleaned: pasted text, sentence files, aligned texts, spreadsheets (`.xlsx/.csv/.tsv`), document alignment
  uploads (`_read_upload`), job analysis input.
- Off switch: `IMPORT_CLEANING=0` skips steps 1–4; repairs (step 5) still run for PDFs.
- User-facing strings in en, es and it (`frontend/src/lib/locales/*.ts`); backend messages in English as today.
- Step codes, used everywhere (API, UI, tests): `page_furniture`, `site_furniture`, `edges`, `noise`.
- Format codes passed to `clean()`: `pdf`, `html`, `text`.
- Run backend tests with `uv run pytest`, lint with `uv run ruff check .`; frontend with `mise run ui:test` and
  `mise run ui:lint`.

## Review Focus

- A web page whose real body is mostly short lines (poem, list, recipe steps): the edges step must stop at its
  30 % cap and keep the page — test in Task 2.
- A standard sentence repeated on every page of a site but sitting mid-article (legal notice, author bio): the
  site step only acts in the first/last 25 % of lines — test in Task 4.
- Numeric table rows in a PDF (`2023 | 2024 | 2025`) and numbers-only data lines in a table: the noise step
  must keep table rows — test in Task 1.
- Cleaning that would empty a document (a page that is all chrome by the rules): keep the uncleaned text and add
  a warning instead of failing with "no text" — test in Task 5.
- Put back after the user edited the preview text: confirm before discarding edits; cancel keeps the edits —
  test in Task 7.

---

### Task 1: Cleaning module core — page furniture, noise, repairs, line hashes

**Files:**
- Create: `src/corpora/cleaning.py`
- Test: `tests/test_cleaning.py`

**Interfaces:**
- Produces:
  - `@dataclass Removal: step: str; lines: list[str]`
  - `@dataclass Cleaned: text: str; removed: list[Removal]; repaired: dict[str, int]; line_hashes: bytes`
  - `STEPS = ("page_furniture", "site_furniture", "edges", "noise")`
  - `def norm_line(line: str) -> str` — lowercase, whitespace collapsed, stripped.
  - `def line_hash(line: str) -> bytes` — `hashlib.blake2b(norm_line(line).encode(), digest_size=8).digest()`.
  - `def line_hashes(pages: list[str]) -> bytes` — sorted, de-duplicated concatenation of `line_hash` for every
    non-empty line whose `norm_line` is shorter than 120 chars.
  - `def clean(pages: list[str], *, fmt: str, lang: str | None = None, site_counts: Counter[bytes] | None = None, skip: Collection[str] = ()) -> Cleaned`
  - `def enabled() -> bool` — `os.environ.get("IMPORT_CLEANING", "1") != "0"`.
- `clean` applies, in order: `page_furniture` (fmt `pdf`), `site_furniture` (fmt `html` and `site_counts` not
  None; Task 4), `edges` (fmt `html`; Task 2), `noise` (all fmts), repairs (fmt `pdf`), then
  `ingest.normalize_text`. Steps in `skip`, or steps 1–4 when `not enabled()`, are not run. A `Removal` is
  emitted only for a step that removed something. `line_hashes` is always computed from the input `pages`.
  Until Tasks 2 and 4 land, those steps are no-ops.

- [ ] **Step 1: Write the failing tests**

```python
def _pdf(pages): return clean(pages, fmt="pdf")

def test_running_header_and_page_numbers_removed():
    pages = [f"ACME Annual Report\nBody text of page {i} goes on.\n{i}" for i in range(1, 7)]
    c = _pdf(pages)
    assert "ACME Annual Report" not in c.text and "\n3\n" not in f"\n{c.text}\n"
    assert {r.step for r in c.removed} == {"page_furniture"}

def test_header_differing_only_in_digits_is_one_header():
    pages = [f"Report 2024 — page {i}\nReal sentence number {i} here." for i in range(1, 7)]
    assert "Report 2024" not in _pdf(pages).text

@pytest.mark.parametrize("pn", ["- 12 -", "Page 12", "Página 12 de 40", "Pag. 12", "12/40"])
def test_page_number_shapes(pn):
    assert pn not in _pdf([f"Some body sentence.\n{pn}"]).text

def test_noise_lines_removed_but_table_rows_kept():
    c = clean(["Intro sentence.\n* * *\n2023 | 2024 | 2025\n---"], fmt="text")
    assert "* * *" not in c.text and "---" not in c.text and "2023 | 2024 | 2025" in c.text

def test_repairs_dehyphenate_and_join_and_are_counted():
    c = _pdf(["The transla-\ntion of this\nsentence ends here."])
    assert c.text == "The translation of this sentence ends here."
    assert c.repaired == {"hyphenation": 1, "joined_lines": 1}

def test_off_switch_skips_removals_but_keeps_repairs(monkeypatch):
    monkeypatch.setenv("IMPORT_CLEANING", "0")
    c = _pdf([f"HDR\nwor-\nds {i}" for i in range(6)])
    assert "HDR" in c.text and "words" in c.text and c.removed == []

def test_skip_parameter():
    pages = [f"HDR\nBody {i}." for i in range(6)]
    assert "HDR" in clean(pages, fmt="pdf", skip={"page_furniture"}).text

def test_line_hashes_sorted_unique_and_short_lines_only():
    h = line_hashes(["A  line\na line\n" + "x" * 130])
    assert len(h) == 8 and h == line_hash("a line")
```

- [ ] **Step 2: Run `uv run pytest tests/test_cleaning.py -v`** — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `cleaning.py`**

Move the header/footer logic and the two repair regexes from `ingest.extract_pdf` (lines ~323–339) into
private step functions; keep their thresholds (`< 80` chars, `>= max(3, len(pages)//2)` pages). Compare
header candidates by `re.sub(r"\d+", "#", norm_line(line))`. Page-number lines: a line matching
`(?i)^[-–—\s]*(p(á|a)g(ina|e|\.)?\s*)?\d{1,4}(\s*(de|di|of|/)\s*\d{1,4})?[-–—\s]*$`. Noise: a line with no
letter (`not any(ch.isalpha() for ch in line)`) that does not contain `pdftext.ROW_END` or ` | `. Count
repairs with `re.subn`. Strip `pdftext.ROW_END` after repairs, as `extract_pdf` does today.

- [ ] **Step 4: Run `uv run pytest tests/test_cleaning.py -v`** — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "cleaning: page furniture, noise and repair steps"`

---

### Task 2: Edges step for web pages

**Files:**
- Modify: `src/corpora/cleaning.py`
- Create: `tests/fixtures/web/` — three saved pages (a news article in es, a blog post in it, an institutional
  page in en), each with menus/share/related/copyright chrome; plus `tests/fixtures/web/README.md` naming each
  page's source and saving date.
- Test: `tests/test_cleaning.py`

**Interfaces:**
- Consumes: `clean`, `Removal` from Task 1.
- Produces: `def _edges(lines: list[str], lang: str | None) -> tuple[list[str], list[str]]` (kept, removed),
  wired into `clean` for fmt `html`.
- Rules (spec): from the start, then from the end, drop consecutive chrome lines until the first body line.
  Chrome = matches the phrase list, is a date or a byline alone, or is < 40 chars without sentence-ending
  punctuation. Body = ≥ 60 chars, or ends with `.!?…` and has ≥ 6 words. If removing an edge's run would remove
  more than 30 % of the page's characters, that edge is left untouched.
- Phrase list: one module-level dict `CHROME_PHRASES: dict[str, list[str]]` keyed `es`, `it`, `en`, plus a
  shared list checked for every language. At least: share/compartir/condividi, follow us/síguenos/seguici,
  subscribe/suscríbete/iscriviti/abbonati, cookies, related/relacionados/correlati, read more/leer más/leggi
  anche, tags/etiquetas, ©, all rights reserved/todos los derechos reservados/tutti i diritti riservati.

- [ ] **Step 1: Write the failing tests**

```python
def test_edges_trims_menu_and_footer():
    lines = ["Inicio", "Noticias", "Compartir en Facebook", "12 de marzo de 2025",
             BODY_ES,  # a 3-sentence paragraph, module constant
             "Noticias relacionadas", "© 2025 El Diario. Todos los derechos reservados."]
    c = clean(["\n".join(lines)], fmt="html", lang="es")
    assert c.text == BODY_ES and [r.step for r in c.removed] == ["edges"]

def test_edges_never_removes_more_than_30_percent():
    poem = "\n".join(["Verde que te quiero verde"] * 8 + [BODY_ES])
    assert clean([poem], fmt="html", lang="es").text.startswith("Verde")

def test_edges_runs_without_a_phrase_list_for_the_language():
    c = clean(["Home\nMenu\n" + BODY_EN], fmt="html", lang="pt")
    assert c.text == BODY_EN

@pytest.mark.parametrize("name,kept,gone", FIXTURE_CASES)   # per fixture: a body sentence and 2+ chrome lines
def test_real_pages(name, kept, gone):
    text = ingest.extract_html_raw((FIXTURES / name).read_bytes())[1]
    c = clean([text], fmt="html", lang=name[:2])
    assert kept in c.text and not any(g in c.text for g in gone)
```

`ingest.extract_html_raw` is defined in Task 5; until then build `text` with
`trafilatura.extract(data, include_comments=False, include_tables=True, include_links=False, deduplicate=True)`
in a test helper and switch it in Task 5.

- [ ] **Step 2: Run `uv run pytest tests/test_cleaning.py -k edges or real_pages -v`** — Expected: FAIL.
- [ ] **Step 3: Implement `_edges` and wire it into `clean`.** Tune phrases on the fixtures, never past the rules above.
- [ ] **Step 4: Run `uv run pytest tests/test_cleaning.py -v`** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "cleaning: trim chrome at the edges of web pages"`

---

### Task 3: Store raw line hashes and host (migration v16)

**Files:**
- Modify: `src/corpora/db.py` (add `_V16`, append to `MIGRATIONS`)
- Modify: `src/corpora/importer.py` (`add_document`, `import_text`)
- Test: `tests/test_migrations.py`, `tests/test_cleaning.py`

**Interfaces:**
- Produces:
  - Columns `documents.line_hashes BLOB` (NULL allowed) and `documents.host TEXT NOT NULL DEFAULT ''`, index
    `idx_docs_host ON documents(corpus_id, host)`. Migration backfills `host` for `kind='url'` rows as the
    lowercased part of `source` between `://` and the next `/` (whole remainder when there is no `/`).
  - `importer.add_document(..., line_hashes: bytes | None = None)` stores it; sets `host` to
    `(urlparse(source).hostname or "").lower()` when `kind == "url"`, else `''`.
  - `importer.import_text(..., line_hashes: bytes | None = None)` passes it through.

- [ ] **Step 1: Write the failing tests**

```python
def test_v16_backfills_host(old_db_at_v15):   # follow the existing fixtures in test_migrations.py
    # rows: url "https://WWW.Example.com/a/b", url "http://example.org", file "report.pdf"
    assert hosts == ["www.example.com", "example.org", ""]

def test_add_document_stores_line_hashes_and_host(conn, corpus):
    r = importer.add_document(conn, corpus, "T", LONG_ES_TEXT, "https://ex.com/p", "url", line_hashes=b"\x01" * 8)
    row = conn.execute("SELECT line_hashes, host FROM documents WHERE id=?", (r["id"],)).fetchone()
    assert row["line_hashes"] == b"\x01" * 8 and row["host"] == "ex.com"
```

- [ ] **Step 2: Run `uv run pytest tests/test_migrations.py tests/test_cleaning.py -v`** — Expected: FAIL.
- [ ] **Step 3: Implement the migration and the two parameters.** Comment `_V16` in the style of `_V15`.
- [ ] **Step 4: Run `uv run pytest -q`** — Expected: PASS (whole suite: schema version bump touches many tests).
- [ ] **Step 5: Commit** — `git commit -m "db v16: raw line hashes and host per document"`

---

### Task 4: Site furniture step

**Files:**
- Modify: `src/corpora/cleaning.py`
- Test: `tests/test_cleaning.py`

**Interfaces:**
- Consumes: `line_hash`, `norm_line` (Task 1); columns from Task 3.
- Produces:
  - `def site_counts(conn, corpus_id: int, host: str, exclude_source: str = "") -> Counter[bytes]` — for the
    200 most recent (`ORDER BY id DESC LIMIT 200`) non-deleted documents with that `corpus_id` and `host`,
    `line_hashes` not NULL and `source != exclude_source`: how many documents contain each 8-byte hash.
  - In `clean`, the `site_furniture` step removes a line when `site_counts[line_hash(line)] >= 2`,
    `len(norm_line(line)) < 120`, and the line's index lies in the first or last 25 % of the page's lines.

- [ ] **Step 1: Write the failing tests**

```python
def test_site_line_in_edge_zone_removed():
    counts = Counter({line_hash("Suscríbete a nuestro boletín"): 2})
    page = "\n".join(["Suscríbete a nuestro boletín", *BODY_LINES_ES])   # 8 body lines
    c = clean([page], fmt="html", lang="es", site_counts=counts, skip={"edges"})
    assert "Suscríbete" not in c.text and c.removed[0].step == "site_furniture"

def test_site_line_mid_article_kept():
    counts = Counter({line_hash("Aviso legal estándar."): 5})
    page = "\n".join([*BODY_LINES_ES[:4], "Aviso legal estándar.", *BODY_LINES_ES[4:]])
    assert "Aviso legal" in clean([page], fmt="html", site_counts=counts, skip={"edges"}).text

def test_needs_two_other_pages():
    counts = Counter({line_hash("Menú principal"): 1})
    assert "Menú principal" in clean(["Menú principal\n" + BODY_ES], fmt="html", site_counts=counts, skip={"edges"}).text

def test_site_counts_reads_same_corpus_and_host_only(conn, corpus, other_corpus):
    # two docs on ex.com in corpus, one on ex.com in other_corpus, one on other.com, one deleted: all share hash H
    assert site_counts(conn, corpus["id"], "ex.com")[H] == 2
```

- [ ] **Step 2: Run `uv run pytest tests/test_cleaning.py -v`** — Expected: FAIL.
- [ ] **Step 3: Implement `site_counts` and the step.**
- [ ] **Step 4: Run `uv run pytest tests/test_cleaning.py -v`** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "cleaning: remove lines repeated across a site's pages"`

---

### Task 5: Wire cleaning into extraction and background imports

**Files:**
- Modify: `src/corpora/ingest.py` (`extract_html`, `extract_pdf`, `fetch_url`, `read_file`)
- Modify: `src/corpora/ocr.py` (`OcrResult`, `ocr_pdf`)
- Modify: `src/corpora/importer.py` (`import_url`, `import_file`)
- Modify: `src/corpora/main.py` (`_read_upload` ~line 949, job analysis ~line 1109: pass `clean=False`)
- Modify: `docs/importing.md` (new "Cleaning" section; PDF section points to it)
- Test: `tests/test_cleaning.py`, existing `tests/test_pdftext.py`, `tests/test_extraction_flags.py`,
  `tests/test_url_fetching.py`, `tests/test_formats.py`

**Interfaces:**
- Consumes: `cleaning.clean`, `cleaning.site_counts`, `Cleaned`.
- Produces:
  - `ingest.extract_html_raw(data: bytes) -> tuple[str, str]` — (title, text) from trafilatura with
    `favor_recall` removed (default balance), `deduplicate=True` kept; raises the same `IngestError` on < 40 chars.
  - `ingest.extract_pdf_pages(data, lang, notes, progress) -> list[str]` — raw per-page text (text layer or OCR).
  - `OcrResult.pages: list[str]` (per-page text); `OcrResult.text` stays as `"\n".join(pages)`.
  - `ingest.fetch_url(url, polite=False, corpus_id: int | None = None)` and
    `ingest.read_file(filename, data, lang=None, columns="", progress=None, *, clean: bool = True, corpus_id: int | None = None)`
    both return, besides today's keys: `removed: list[{"step": str, "lines": list[str]}]`,
    `repaired: dict[str, int]`, `raw: list[str]`, `fmt: str` (`pdf`/`html`/`text`), `line_hashes: str` (hex).
    Site counts are used only by `fetch_url` with HTML and a `corpus_id`, via `db.session()` and
    `cleaning.site_counts(conn, corpus_id, host, exclude_source=url)`.
    Spreadsheets and `clean=False` return `removed=[]`, `repaired={}`, `raw=[text]`, `fmt="text"`,
    `line_hashes=""` and today's text (PDFs with `clean=False` still get repairs, as today).
  - `ingest.cleaning_summary(removed: list[dict]) -> str | None` — e.g.
    `"Cleaning removed 14 lines (repeated on every page, site menus and links)."`; None when nothing removed.
  - Empty guard: if the cleaned text is < 40 chars while the raw text was longer, return the uncleaned
    (repaired) text, `removed=[]`, and add the warning
    `"Cleaning would have removed almost everything, so the text is kept as extracted: check it."`
  - `import_url` / `import_file` pass `corpus_id`, forward `bytes.fromhex(parsed["line_hashes"])` (None when
    empty) to `import_text`, and add `cleaning_summary(...)` to the job warnings.
  - PDF quality is scored on the cleaned text.

- [ ] **Step 1: Write the failing tests**

```python
def test_read_file_pdf_reports_removals(make_pdf):          # tests/pdfmaker.py
    r = ingest.read_file("a.pdf", make_pdf([f"HDR\nBody sentence {i}." for i in range(6)]))
    assert "HDR" not in r["text"] and r["removed"][0]["step"] == "page_furniture"
    assert r["fmt"] == "pdf" and len(r["raw"]) == 6 and len(bytes.fromhex(r["line_hashes"])) % 8 == 0

def test_read_file_clean_false_keeps_text(make_pdf):
    r = ingest.read_file("a.pdf", make_pdf([f"HDR\nBody {i}." for i in range(6)]), clean=False)
    assert "HDR" in r["text"] and r["removed"] == []

def test_spreadsheet_not_cleaned(): ...           # a CSV with a "---" cell keeps it

def test_all_chrome_page_kept_with_warning(): ... # html page of only short menu lines + one 45-char line

def test_import_url_stores_hashes_and_reports_summary(client, serve):
    # serve three pages of one host sharing a "Síguenos en redes" first line; import them in order
    # third document's text lacks the line; its job warnings include "Cleaning removed"
```

- [ ] **Step 2: Run `uv run pytest tests/test_cleaning.py -v`** — Expected: new tests FAIL.
- [ ] **Step 3: Implement.** `extract_html` and `extract_pdf` remain as thin wrappers (raw extraction +
  `clean`) for any caller that only wants text; move the furniture/repair code out of `extract_pdf` (now in
  `cleaning`). Write the docs section: the steps in plain words, the formats each applies to, `IMPORT_CLEANING`,
  and that a document imported before this change and again after it is caught by the near-duplicate check, not
  as identical.
- [ ] **Step 4: Run `uv run pytest -q && uv run ruff check .`** — Expected: PASS, no lint errors. Fix any
  existing PDF test whose expectation depended on the old in-place code only if the behaviour is unchanged.
- [ ] **Step 5: Commit** — `git commit -m "Clean every extracted import and report what was removed"`

---

### Task 6: API — preview corpus, re-clean endpoint, hashes on add

**Files:**
- Modify: `src/corpora/main.py` (`UrlIn` or the preview endpoint, `/api/preview-file`, `DocIn`, `add_document`
  endpoint, new `/api/clean`)
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: Task 5's `fetch_url`/`read_file` result keys; `cleaning.clean`, `cleaning.site_counts`.
- Produces:
  - `POST /api/preview-url` accepts optional `corpus_id: int | None` in the body and passes it on.
  - `/api/preview-file` passes its `corpus_id` to `read_file`.
  - `POST /api/clean` body `CleanIn{raw: list[str] (max 1000 items), fmt: Literal["pdf","html","text"], corpus_id: int | None = None, source: str = "", lang: str | None = None, skip: list[Literal[STEPS]] = []}`
    → `{text, removed, repaired}` (same shapes as Task 5). Site counts when `fmt=="html"`, `corpus_id` and a
    URL `source` are given. Total raw size over `MAX_TEXT_CHARS` → 413.
  - `DocIn.line_hashes: str = ""` (hex, max length 16 × 20 000); invalid hex → 422; passed to `import_text`.

- [ ] **Step 1: Write the failing tests**

```python
def test_clean_endpoint_skip_puts_lines_back(client):
    raw = [f"HDR\nBody {i}." for i in range(6)]
    a = client.post("/api/clean", json={"raw": raw, "fmt": "pdf"}).json()
    b = client.post("/api/clean", json={"raw": raw, "fmt": "pdf", "skip": ["page_furniture"]}).json()
    assert "HDR" not in a["text"] and "HDR" in b["text"]

def test_clean_endpoint_rejects_unknown_step(client):
    assert client.post("/api/clean", json={"raw": ["x"], "fmt": "pdf", "skip": ["bogus"]}).status_code == 422

def test_add_document_with_line_hashes(client, corpus_id):
    r = client.post(f"/api/corpora/{corpus_id}/documents", json={..., "kind": "url", "source": "https://ex.com/a", "line_hashes": "01" * 8})
    # stored row has line_hashes == bytes.fromhex("01"*8), host == "ex.com"

def test_add_document_bad_hex_is_422(client, corpus_id): ...
```

- [ ] **Step 2: Run `uv run pytest tests/test_api.py -k "clean or line_hashes" -v`** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `uv run pytest -q`** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "API: re-clean endpoint, preview corpus, line hashes on add"`

---

### Task 7: Preview UI — removed lines and Put back

**Files:**
- Modify: `frontend/src/lib/addDocuments.svelte.ts` (`Preview`, `fetchPreview`, `previewFile`, `addPreview`,
  new `putBack`)
- Modify: `frontend/src/lib/ui/add/PreviewBlock.svelte`
- Modify: `frontend/src/lib/locales/en.ts`, `es.ts`, `it.ts`
- Test: `frontend/tests/AddFromWeb.test.ts`, `frontend/tests/AddUpload.test.ts`

**Interfaces:**
- Consumes: Task 5/6 response keys and `POST /api/clean`.
- Produces:
  - `Preview` gains `removed: { step: Step; lines: string[] }[]`, `raw: string[]`, `fmt: 'pdf'|'html'|'text'`,
    `lineHashes: string`, `skipped: Step[]`, `cleanText: string` (text as last returned by the server, to detect
    edits). `type Step = 'page_furniture'|'site_furniture'|'edges'|'noise'`.
  - `fetchPreview` sends `corpus_id`; `addPreview` sends `line_hashes: p.lineHashes`.
  - `putBack(step: Step): Promise<boolean>` — if `p.text !== p.cleanText`, asks to confirm (use the app's
    existing confirm dialog used elsewhere in `addDocuments`/screens); on cancel returns false and leaves the
    text. Otherwise posts `/api/clean` with `skip: [...p.skipped, step]` and replaces `text`, `cleanText`,
    `removed`, `skipped`.
- UI: below the quality line, a `<details>` "Removed while cleaning: N lines" (hidden when nothing removed),
  one group per step with its label, up to 50 lines each then "and N more", and a "Put back" button per group.
- Labels (en; translate to es/it): `src.clean.summary` "Removed while cleaning: {n} lines",
  `src.clean.page_furniture` "Repeated on every page", `src.clean.site_furniture` "Repeated on other pages of
  this site", `src.clean.edges` "Menus and links at the start or end", `src.clean.noise` "Lines without words",
  `src.clean.more` "and {n} more", `src.clean.putBack` "Put back", `src.clean.confirm` "Putting these lines
  back discards your edits to the text. Continue?"

- [ ] **Step 1: Write the failing tests**

```ts
it('lists removed lines grouped by step', async () => {
  // mock /api/preview-url → removed: [{step:'edges', lines:['Inicio','Compartir']}]
  // expect "Removed while cleaning: 2 lines", "Menus and links at the start or end", "Compartir"
});
it('put back re-cleans with the step skipped', async () => {
  // click "Put back" → POST /api/clean with skip ['edges']; textarea shows returned text; group disappears
});
it('put back after an edit asks first and cancel keeps the edit', async () => {
  // edit textarea, click "Put back", cancel the dialog → no /api/clean request, edited text kept
});
it('sends line hashes when adding the preview', async () => { /* body.line_hashes === lineHashes */ });
```

- [ ] **Step 2: Run `mise run ui:test`** — Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `mise run ui:test && mise run ui:lint`** — Expected: PASS (includes the colour-contrast checks).
- [ ] **Step 5: Commit** — `git commit -m "Preview: show what cleaning removed and put it back"`

---

### Task 8: End-to-end check

- [ ] **Step 1:** Run `uv run pytest -q && uv run ruff check . && mise run ui:test && mise run ui:lint`. Expected: all pass.
- [ ] **Step 2:** Run the app (`mise run dev`, `mise run ui:dev`), preview one real news URL and one multi-page
  PDF in a corpus; confirm removed lines show, Put back restores them, and the imported document reads clean
  in *Read*. Note anything a rule cut wrongly and fix it in the owning task's tests.
