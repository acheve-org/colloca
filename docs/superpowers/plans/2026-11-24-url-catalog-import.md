# URL Catalog Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user give an index page (HTML or RSS/Atom), pick links from it, and import them as a batch, with suspicious extractions flagged in the job result.

**Architecture:** A new `ingest.discover_links` (pure parser plus a fetch wrapper) behind `POST /api/discover-links`; a "Catalog" block in *Sources* that sends the selection, in chunks, to the existing T25 `POST /api/corpora/{id}/urls`; `importer.import_url` gains extraction warnings in its result.

**Tech Stack:** Python (FastAPI, httpx, lxml, trafilatura), Svelte 5 + vitest, pytest. Tests stub the network with `httpx.MockTransport` as in `tests/test_url_fetching.py`.

**Spec:** `docs/superpowers/specs/2026-11-24-url-catalog-import-design.md`

## Global Constraints

- Fetching goes through `ingest._download` only (SSRF checks, pinned address, `MAX_BYTES`). No new HTTP client.
- Discovery is one request, not polite. Batch imports keep `URL_DELAY_SECONDS`, `MAX_URL_LIST` (50), `MAX_URLS_PER_HOST` (20) unchanged.
- Flags never reject a document: it is imported and the flag goes in `warnings`.
- Strings exist in `en.ts`, `es.ts` and `it.ts` (a test keeps them in step). No per-article preview for batches. No crawling, no pagination, no JS rendering.
- Pruned tracking parameters: `utm_*`, `fbclid`, `gclid`. Short-text threshold: 300 characters.

## Review Focus

- Relative links, `<base href>`, `//host/path` and `../x` resolve correctly against the page URL (Task 1).
- A page with no usable links returns an empty list, not an error (Task 1).
- A malformed or non-HTML/feed response (PDF, image) gives a clear 422, not a 500 (Task 2).
- Selecting more links than one request allows still imports all of them, in order, with no address sent twice (Task 4).
- A URL the server rejects in one chunk does not stop the next chunks (Task 4).
- Page text in Spanish/Italian boilerplate ("Aceptar cookies", "Accetta i cookie") is flagged, not only English (Task 3).

---

### Task 1: Link discovery parser

**Files:**
- Modify: `src/colloca/ingest.py` (add after `parse_url_list`)
- Modify: `pyproject.toml` (add `"lxml>=5"` to runtime `dependencies`; keep the dev entry)
- Test: `tests/test_discover_links.py` (create)

**Interfaces:**
- Produces: `ingest.parse_links(data: bytes, base_url: str) -> dict` returning `{"title": str, "links": [{"url": str, "text": str, "same_host": bool}]}`, and `ingest.discover_links(url: str) -> dict` returning `{**parse_links(...), "url": url, "truncated": bool, "max_per_request": int}` where `max_per_request = min(MAX_URL_LIST, MAX_URLS_PER_HOST)`. Constant `MAX_DISCOVERED = 2000`.

- [ ] **Step 1: Write failing tests** in `tests/test_discover_links.py`, all on `parse_links` with inline HTML/XML strings and base `https://news.example/section/`:
  - `test_resolves_relative_links_and_base_href`: `<a href="a1">`, `<a href="../b">`, `<a href="//cdn.example/x">`, then the same with `<base href="https://other.example/dir/">`; assert the exact absolute URLs.
  - `test_strips_fragments_and_tracking_but_keeps_other_params`: `/a?utm_source=x&id=7#top` becomes `https://news.example/a?id=7`.
  - `test_dedupes_keeping_the_longest_anchor_text`.
  - `test_prunes_nav_footer_aside_and_non_http_and_self_links`: links inside `<nav>`, `<header>`, `<footer>`, `<aside>`, `mailto:`, `javascript:`, `#frag`, the page itself, and empty-text links without a `title` attribute are absent.
  - `test_prunes_login_search_tag_category_author_paths`: `/login`, `/search?q=x`, `/tag/x`, `/category/x`, `/author/x`, `/privacy`, `/contact` absent; `/2026/05/story` present.
  - `test_same_host_flag`.
  - `test_rss_and_atom_entries`: an RSS `<item><title/><link/>` and an Atom `<entry><link href=.../>` both give `{url, text}`.
  - `test_page_without_links_gives_empty_list`.
  - `test_title_is_the_page_title`.
- [ ] **Step 2: Run** `uv run pytest tests/test_discover_links.py -q`. Expected: FAIL (`parse_links` missing).
- [ ] **Step 3: Implement `parse_links` in `src/colloca/ingest.py`.** Detect a feed when the root element (via `lxml.etree.fromstring`, recover mode) is `rss`, `feed` or `RDF`; otherwise parse with `lxml.html`. Skip any `<a>` that has an ancestor `nav|header|footer|aside`. Pruned path segments are a module constant `_NON_ARTICLE_SEGMENTS` (login, signin, register, signup, search, tag, tags, category, categories, author, authors, cart, privacy, contact, about, terms, cookies). Normalise anchor text with `normalize_text` collapsed to one line. Preserve document order.
- [ ] **Step 4: Implement `discover_links(url)`**: `_download(url)` (not polite), `parse_links`, cap to `MAX_DISCOVERED` setting `truncated`. If the content type is neither HTML nor XML-ish (PDF, image), raise `IngestError("Not a web page or a feed")`.
- [ ] **Step 5: Run** `uv run pytest tests/test_discover_links.py -q`. Expected: PASS.
- [ ] **Step 6: Commit** `git add tests/test_discover_links.py src/colloca/ingest.py pyproject.toml && git commit -m "Discover links on an index page or feed"` (with the Co-Authored-By trailer).

### Task 2: Discovery endpoint

**Files:**
- Modify: `src/colloca/main.py` (next to `preview_url`, reusing `UrlIn`)
- Test: `tests/test_discover_links.py` (append)

**Interfaces:**
- Consumes: `ingest.discover_links(url: str) -> dict`, `UrlIn`.
- Produces: `POST /api/discover-links` body `{url}` returning the `discover_links` dict; 422 for `IngestError`, 502 for other exceptions.

- [ ] **Step 1: Write failing tests** using the `client` fixture and the `net`-style stubbing from `tests/test_url_fetching.py` (copy the small fixture locally or import `net`, `answers`, `PUBLIC` from it):
  - `test_discover_endpoint_lists_links`: page with three article links and a footer link; response `links` has the three, `max_per_request == 20`, `truncated is False`.
  - `test_discover_endpoint_refuses_internal_address`: private resolve gives 422 with "private".
  - `test_discover_endpoint_rejects_a_pdf`: `application/pdf` response gives 422 "Not a web page or a feed".
  - `test_discover_endpoint_network_error_is_502`: transport raising `httpx.ConnectError` gives 502.
- [ ] **Step 2: Run** `uv run pytest tests/test_discover_links.py -q`. Expected: the four new tests FAIL (404).
- [ ] **Step 3: Implement `discover_links_endpoint(body: UrlIn)`** with the same error mapping as `preview_url`.
- [ ] **Step 4: Run** `uv run pytest tests/test_discover_links.py tests/test_url_fetching.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** "Add the discover-links endpoint".

### Task 3: Suspicious-extraction flags

**Files:**
- Modify: `src/colloca/ingest.py` (add `extraction_warnings`)
- Modify: `src/colloca/importer.py` (`import_url`)
- Test: `tests/test_extraction_flags.py` (create)

**Interfaces:**
- Produces: `ingest.extraction_warnings(page: dict, url: str) -> list[str]` where `page` is the `fetch_url` result; `MIN_ARTICLE_CHARS = 300`. `import_url` result gains the warnings appended to the existing `result["warnings"]` list (key already exists from `add_document`).

- [ ] **Step 1: Write failing tests.** Unit tests on `extraction_warnings` with `page = {"url","title","text"}`:
  - `test_short_text_is_flagged` (200 chars flagged, 400 not).
  - `test_boilerplate_in_first_500_chars_is_flagged_in_three_languages`: parametrised with "Please enable JavaScript to continue", "Aceptar cookies para seguir leyendo", "Accetta i cookie per continuare"; same phrase after char 500 is not flagged.
  - `test_title_equal_to_host_is_flagged_as_landing_page`: title `news.example` for `https://news.example/` flagged; a real title not.
  - `test_clean_article_has_no_warnings`.
  API test in the same file with the `client` fixture and stubbing: `test_import_url_reports_flags_and_still_imports` (a short page imports, job `done`, result `warnings` contains the short-text message) and `test_same_title_on_same_host_is_flagged` (two URLs of one host with the same `<title>`, second job's warnings mention the first; different host not flagged). Read job results the way `tests/test_url_fetching.py` does (`wait_for_jobs`).
- [ ] **Step 2: Run** `uv run pytest tests/test_extraction_flags.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement `extraction_warnings`** with module constants `_BOILERPLATE` (compiled case-insensitive regex of English, Spanish and Italian cookie, JavaScript and paywall phrases) and messages as plain English strings (warnings in results are English today).
- [ ] **Step 4: Modify `import_url`**: after `import_text(...)(job)` returns, extend `result["warnings"]` with `extraction_warnings(page, url)` plus a duplicate-title warning from a query on `documents` (same `corpus_id`, `kind='url'`, same `title`, different `id`, `deleted_at IS NULL`, source host equal to this URL's host, host compared in Python after `urlparse`). Create the `warnings` list if missing.
- [ ] **Step 5: Run** `uv run pytest tests/test_extraction_flags.py tests/test_url_fetching.py -q`. Expected: PASS.
- [ ] **Step 6: Commit** "Flag suspicious URL extractions in the job result".

### Task 4: Catalog mode in Sources, strings and docs

**Files:**
- Modify: `frontend/src/screens/Sources.svelte` (new block after the address list, before the upload card)
- Create: `frontend/src/lib/catalog.ts` (pure helpers)
- Modify: `frontend/src/lib/locales/en.ts`, `es.ts`, `it.ts`
- Modify: `README.md` (Sources step: catalog import; limits note), `docs/backlog.md` (nothing to remove: T25 is done; add no entry)
- Test: `frontend/tests/catalog.test.ts` (create), `frontend/tests/Sources.test.ts` (append)

**Interfaces:**
- Consumes: `POST /api/discover-links` returning `{url, title, links: {url,text,same_host}[], truncated, max_per_request}`; `POST /api/corpora/{id}/urls` returning `{url, ok, job_id?, error?}[]`.
- Produces in `catalog.ts`: `filterLinks(links: Link[], query: string, sameHostOnly: boolean): Link[]` (case-insensitive substring on url or text), `chunk<T>(items: T[], size: number): T[][]`, type `Link = { url: string; text: string; same_host: boolean }`.

- [ ] **Step 1: Write failing unit tests** in `frontend/tests/catalog.test.ts`: `filterLinks` matches url and text case-insensitively, honours `sameHostOnly`, empty query keeps all; `chunk([1..5], 2)` equals `[[1,2],[3,4],[5]]`; `chunk([], 3)` equals `[]`.
- [ ] **Step 2: Write failing component tests** in `frontend/tests/Sources.test.ts`, extending the existing fetch stub (`/api/discover-links`, `/api/corpora/1/urls`):
  - `finds links and lists them with all checked by default except filtered-out ones`.
  - `the filter hides rows and "select all" applies only to visible rows`.
  - `importing 45 selected links with max_per_request 20 posts three requests of 20, 20 and 5 addresses in order, with the metadata`.
  - `an error answer for one chunk is reported and the next chunks are still sent`.
  - `nothing selected sends nothing and says so`.
- [ ] **Step 3: Run** `cd frontend && npx vitest run tests/catalog.test.ts tests/Sources.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement `catalog.ts`**, then the Sources block following the existing `act(...)`/`still(id)`/`reportUpload(...)`/`watch(true)` pattern of `addUrlList`: states `catalogUrl`, `catalogLinks`, `selected: Set<string>`, `filter`, `sameHostOnly = true`, `maxPerRequest`. Buttons: *Find links* (calls discovery), *Import selected* (chunks with `chunk(urls, maxPerRequest)`, posts sequentially with `force_language` and `metaParams()`, merges the answers into one `reportUpload` call). Show the count of selected and a "truncated" hint when `truncated`.
- [ ] **Step 5: Add i18n keys** under `src.catalog.*` (title, address, find, none, filter, sameHost, selectAll, selectNone, count, import, needed, truncated, hint) in en, es and it.
- [ ] **Step 6: Update README** (Sources: paste an index page or feed, pick links, import; the batch limits; flags appear in the job report; no robots.txt, no pagination).
- [ ] **Step 7: Run** `cd frontend && npx vitest run && npx svelte-check` and `uv run pytest -q && uv run ruff check src tests`. Expected: all pass.
- [ ] **Step 8: Commit** "Catalog mode in Sources: pick links from an index page and import them".
