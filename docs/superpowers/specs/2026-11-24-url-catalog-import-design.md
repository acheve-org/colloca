# URL catalog import: design

## Intent

Today a source can be one URL (fetch, preview, trim, add) or a pasted list of URLs (T25, no preview). The user also
wants to give the address of an *index page* (a news section, a catalog) and import the articles it links to.
Colloca is for building reliable terminology corpora from hand-picked sources, so the user stays in control of which
links are imported, but does not read every article before it is added.

## Goals

- Paste one index page URL (HTML page or RSS/Atom feed), see the links it contains, pick some, import them.
- Reuse the T25 batch machinery as it is (per-URL job, polite per-host delay, SSRF checks with the connection pinned
  to the validated address, near-duplicate policy, per-URL errors).
- Flag extractions that are probably bad, so the user can check or delete them afterwards.
- Single-URL import with preview stays unchanged.

## Non-goals

- Crawling beyond the index page; following "next page" links.
- JavaScript rendering (as today, such pages fail to extract).
- Per-article preview/trim for batches.
- Automatic selection of "which links are articles" (heuristics only prune obvious non-articles).
- Raising `MAX_URL_LIST` / `MAX_URLS_PER_HOST`.

## Anti-goals

Importing a whole site by accident; a page that silently yields navigation text as an "article".

## Approaches

1. **Discover, select, import through the existing list endpoint** (chosen). Small new surface; selection by the user
   avoids guessing article links across unknown sites.
2. Import everything linked automatically. Rejected: pulls in navigation, ads and unrelated pages; no control.
3. Classify links as article/non-article with a model. Rejected: heavy, unreliable on unfamiliar sites, the user
   still would want to confirm.

## Design

### 1. Discovery: `POST /api/discover-links` `{url}`

- Fetches with `ingest._download` (same hardening as every fetch; not "polite", it is one request).
- If the content looks like RSS/Atom (content type or root element `rss`, `feed`, `rdf`), links are the entries'
  `link` and `title`.
- Otherwise parses the HTML with lxml and takes `<a href>` elements (anchor text normalised). Relative URLs are
  resolved against the page (honouring `<base href>`); fragments and `utm_*`, `fbclid`, `gclid` parameters are
  removed; http(s) only; duplicates merged (keeping the longest anchor text).
- Pruning of obvious non-articles: the page itself, links inside `<nav>`, `<header>`, `<footer>`, `<aside>`, links
  whose path matches login/register/search/tag/category/author/cart/privacy/contact-style segments, and links with
  empty anchor text and no `title` attribute.
- Response: `{url, title, links: [{url, text, same_host}]}`, capped to a sane maximum (a few thousand) with a flag
  `truncated`. Errors map like `/api/preview-url`: 422 for `IngestError`, 502 for network errors.
- Implemented as `ingest.discover_links(url)`; the parsing is a pure function of `(html bytes, base url)` so it is
  tested with fixtures without network.

### 2. Selection (frontend, *Sources*)

- A "Catalog" mode next to the single URL form: address field, *Find links*.
- Result list: checkbox, anchor text, URL. Controls: substring filter on URL/text, "same host only" (default on),
  select all / none (applies to the filtered rows), a count of selected links.
- *Import selected* sends the selection to the existing `POST /api/corpora/{id}/urls` in chunks of
  `min(MAX_URL_LIST, MAX_URLS_PER_HOST)` addresses (the limits are exposed by the discovery response so the UI does not
  hardcode them). Chunk answers are merged into one per-URL result list. The metadata form (tags, type, date, author,
  similar policy) is the same as for lists and applies to all.
- Strings in English, Spanish and Italian (i18n catalogues are kept in step by a test).

### 3. Suspicious-extraction flags

`importer.import_url` adds `warnings` to the job result (the field file imports already use, shown in the job report).
Heuristics, as a pure function `ingest.extraction_warnings(page, url)`:

- text shorter than 300 characters;
- boilerplate phrases (cookie consent, "enable JavaScript", "subscribe to read", paywall wording) in the first
  500 characters, in English, Spanish and Italian;
- title equal to the host name (the fallback used when the page has no title), typical of landing pages;
- title identical to another article imported in the same corpus from the same host (checked at import time).

Near-duplicate text is already covered by the T16 policy and is not re-implemented. A flagged document is still
imported: flags are information, not rejection.

## Constraints

- Single worker: jobs run one at a time, so a 50-article batch takes minutes; the existing job list shows progress.
- Fetch rules are unchanged: private addresses blocked, size caps, no robots.txt handling (documented in the README).
- `lxml` is currently a dev dependency; it must become a runtime dependency (or discovery uses the parser trafilatura
  already pulls in, which is lxml). Builder to confirm and adjust `pyproject.toml`.

## Left to the builder

Exact pruning lists, boilerplate phrases and the 300-character threshold (tune on a few real catalogs); UI layout of
the list; README and `docs/backlog.md` updates; tests: discovery fixtures (HTML with nav/footer, relative links,
tracking parameters, an RSS feed), the flag heuristics, the chunking of a selection in the frontend, and an API test
with the network stubbed as in `tests/test_url_fetching.py`.
