# Colloca (MVP)

Self-hosted web tool for translators to build **monolingual reference corpora** (Spanish, Italian)
from hand-picked URLs and client documents, and explore them: frequency, concordance (KWIC),
collocations, n-grams / phraseology, keyness and word clouds.

Everything stays on your machine: one SQLite file in a Docker volume, no external services
(except fetching the URLs you ask for).

## Run

```bash
docker compose build            # builds the UI too
docker compose up               # first start downloads the spaCy models into `~/.spacy`
# open http://localhost:8000
```

The image does not bundle the spaCy models; they live in `~/.spacy` on the host (mounted at `/models`), which keeps the
image small and lets you swap sizes without rebuilding: set `SPACY_SIZE` (sm|md|lg) for the `colloca` service in
`docker-compose.yml`; missing models are downloaded on start (`docker compose run --rm colloca download-models`
prefetches them). The compose file sets `SPACY_SIZE: lg`, so **Docker uses the large (`lg`) models by default**; this is
the recommended setup for real work. The active model per language is shown in the status line at the top of the
window, with a warning when a language runs on a small (`sm`) model. Data lives in the
`colloca-data` volume; back it up with `docker run --rm -v colloca-data:/d -v $PWD:/b alpine tar czf /b/colloca-backup.tgz -C /d .`.

## Workflow

1. **New corpus** (name + language), e.g. "Client X – wind energy [es]". Group the corpora of a client under a
   **project** (the *…* button next to the project selector at the top of the left rail opens *Manage projects*);
   the project selector narrows the corpus list.
2. **Sources**: paste a URL → *Fetch & preview* → trim noise in the text box → *Add*.
   Or upload DOCX / PDF (text layer) / TXT / HTML. Exact duplicates are rejected.
3. Explore with the screens of the left rail. Click any word in a table to jump to its concordance. Every table
   sorts by a click on its header, has a *Filter in results* box, and a CSV export.
4. **Keyness**: compares your corpus with the language's **base corpus** (below) by default, or with any other
   corpus of the same language you pick. The *Show* choice adds **under-used** words (negative LL), including
   words that occur only in the reference corpus.

## Projects, document details and filters

- **Projects** are clients or jobs that group corpora. A corpus belongs to at most one project (change it under
  *Sources*); deleting a project keeps its corpora. Base corpora belong to no project.
- **Document details**: every document can carry **tags**, a **text type** (contract, manual…), a **date**
  (`2024`, `2024-05` or `2024-05-17`) and an **author**. Set them for the documents you are about to add (the
  “Details” box in *Sources*; it applies to URL, upload and pasted text alike) or edit them later with *Edit*.
- **Document filter** (*Only documents with…*, above every analysis screen and the Job screen): restrict the analysis to documents with *all* the given tags, a text
  type, and/or a date range. Everything is recomputed on that subset, including the sizes behind *per million*,
  the *Docs %* column, collocation statistics and keyness (the filter narrows the studied corpus; the reference
  stays whole). CSV exports use the same filter. A partial date counts as its first day; undated documents never
  match a date filter. The API takes the same filter as query parameters on every analysis endpoint:
  `tags=a,b&text_type=contract&date_from=2022&date_to=2024-06&docs=1,2`.

## Aligned texts (translation memories)

Previous translations are the best evidence of how a client wants things said. Import them as **aligned texts**
and search them side by side:

- **Import** (*Sources* → *Import aligned texts*): a **TMX** file, or two columns (source | target) as `.tsv`,
  `.csv` (comma, semicolon or tab) or a table in a `.docx`. The corpus you are in receives the first language, the
  other-language texts go to a corpus you pick (or create). TMX is matched by its language codes (`es`, `es-ES`,
  `it_IT`…), inline markup is dropped, units missing one language are skipped. Two-column files use column order;
  tick *this corpus is the second column* if yours is the other way round. Files over 5000 units are stored in parts.
- **Each side is a normal corpus** in its own language (so frequency, keyness, collocations, the termbase… all work
  on it, and the target-language side is a ready corpus of the client's Italian). They are linked segment by
  segment: segment N of one is the translation of segment N of the other. Re-annotating keeps the alignment.
  Removing one side's document unlinks the other.
- **Concordance → *Source + target*** (appears when the corpus has aligned texts) shows each hit as its source
  segment next to the aligned target segment; run it on the target-language corpus to search by the translation
  instead.
- **Equivalents** screen (in the rail only when the corpus has aligned texts): candidate translations of a word or phrase, i.e. the target lemmas that keep appearing in
  the aligned segments of its occurrences, scored by Dice against their overall frequency in the target text (so
  everyday words score low). Single words only on the target side, and a statistical hint, not a verdict: confirm
  with the translated concordance, then **+ Term** adds the pair to the termbase with the example sentence.
- TMX is parsed with `defusedxml`, so a hostile file (entity bombs, external entities) is refused.

## Analyse a job before translating

The **Job** screen takes the text you are about to translate (a DOCX, PDF, TXT or HTML file, or pasted text) and reports,
against the current corpus (narrowed by the document filter, if set) and the termbase of its project:

- **Coverage**: the share of the text's content words whose lemma occurs at least *N* times in the corpus (default 3),
  the share seen at all, and the number of different words below the threshold.
- **Gaps**: the words the corpus has little or no evidence for, least evidence first, each with a **+ Term** button.
- **Key terms**: the words characteristic of the text compared with the language's base corpus (log-likelihood; words
  that occur at least twice). Without a base corpus the most frequent words are listed instead.
- **Termbase terms in the text**: every entry whose source term occurs (by word form or lemma, so inflected entries
  match), how often, its first sentence, and all translations with their status; forbidden ones are struck through.
  *Glossary for this job* exports exactly those entries as TBX, Excel or CSV (`/api/terms/export?ids=...`).
- **Repeated phrases** (2–4 words, no stopword at the edges) with how often the corpus already uses them.

The text is analysed and then forgotten: nothing is added to any corpus. The analysis runs as a background job
(`POST /api/corpora/{id}/analyse-job`, report at `GET /api/jobs/{id}/result`; each table also as CSV with
`?section=gaps|key_terms|known_terms|phrases&format=csv`). The report is kept in memory only, like job statuses.

## Termbase

Turn what you find into terminology you can reuse and hand over:

- **Add**: click **+ Term** next to any row of *Frequency*, *Collocations*, *N-grams*, *Keyness*, *Equivalents* or
  the Job report, use the *+ Term* button next to the concordance search, or select a hit in the *Concordance* and
  press **Ctrl/Cmd+E** (with text selected in the hit, the selection becomes the term, or the translation when it is
  in the target segment). The dialog pre-fills the term, its part of speech and the example sentence, and *Find
  examples* lists whole sentences from the current corpus (respecting the document filter) to pick an example from.
- **Entries** are (source term, translation) pairs with part of speech, status, domain, definition, notes and an
  example sentence. *Status*: `candidate` (to be reviewed; the translation may be empty), `approved` (the term to
  use) or `forbidden` (a translation that must **not** be used; it is exported as a deprecated term). Approved and
  forbidden entries need a translation. Target language is the other supported language.
- **Scope**: entries belong to the project of the corpus they were added from (corpora without a project share a
  general termbase). The *Termbase* screen lists, searches, filters by status, edits, approves, marks forbidden and
  deletes them.
- **Export** (same screen, or `GET /api/terms/export?format=...&project=...&status=...`): `tbx`, `tbx2`, `xlsx`, `csv`.
  By default only *approved* entries are exported; tick *include candidates* to add the rest.
  - **TBX** (TermBase eXchange, ISO 30042) with TBX-Basic data categories only. `tbx` uses the 2019 structure
    (`conceptEntry / langSec / termSec`), `tbx2` the 2008 one (`termEntry / langSet / tig`) that most CAT tools read.
    Rows with the same source term form one concept; approved translations are `preferredTerm`, candidates
    `admittedTerm`, forbidden ones `deprecatedTerm`.
  - **Checked so far:** the `tbx` output validates against the official TBX core structure RELAX NG schema
    (`tests/schemas/`, run with lxml in `tests/test_tbx_schema.py`), and the TBX-Basic value lists and placements
    (`partOfSpeech`, `administrativeStatus`, where `definition`, `context` and `subjectField` may sit) are checked by
    hand-written rules taken from the TBX-Basic Schematron, which lxml cannot run. A proper noun is exported as
    `noun`, because TBX-Basic has no `properNoun`. An export with no entries is not valid TBX (the schema needs at
    least one concept). `tbx2` (2008) has no schema in the repo: only its value lists are checked.
  - **Not checked:** import into a real CAT tool (Trados, memoQ, Phrase, OmegaT) has not been tried. Samples to try
    are in `docs/samples/` (`termbase-sample.tbx`, `termbase-sample-tbx2.tbx`); please test your tool and report.
  - Excel and CSV cells that start with `=`, `+`, `-` or `@` are neutralised (text, never formulas).

## Base corpora (general language per language)

A corpus built for one client is usually small, so its statistics need something to be compared with. Each
language can have **one base corpus**: a general-language reference kept apart from your own corpora (it is not
in the corpus selector, and it never mixes into their concordances, frequencies or n-grams). It is used for:

- **Keyness**: the default reference (pick another corpus in the list if you prefer).
- **Frequency and Collocations**: tick “compare with base corpus” to add *Base per M* (how common the item is in
  general language), which separates domain vocabulary from everyday words.

Create and fill it in the **Base corpora** screen. Sentence files (one sentence per line, or Leipzig Corpora
Collection `<id><TAB><sentence>` lines) are split into documents of 5000 sentences. The web upload takes files up
to 25 MB; bigger files go through the command line, which streams from disk:

```bash
uv run colloca-import-reference --lang es spa_news_2023_300K-sentences.txt --max-sentences 300000
# Docker: mount the folder with the file
docker compose run --rm -v "$PWD/corpora:/in" colloca colloca-import-reference --lang es /in/spa_news_2023_300K-sentences.txt
```

Colloca does not download anything for you: get a file yourself and check its licence (the Leipzig files are
CC BY). Notes: 300k sentences (about 7M words) take well over half an hour to annotate with the `sm` models, so
start with `--max-sentences 100000`. Pick a register close to your work (news vs. web) since keyness also picks up
register differences. Those corpora have shuffled sentences, so “Docs” columns mean nothing for the base corpus.

## Measures

| Analysis | Details |
|---|---|
| Frequency | by lemma or form, per million, number/percentage of documents containing it (dispersion), POS filter |
| Concordance | words or phrases (up to 6 words), match on lemma or exact form, sort by left/right context |
| Collocations | single node lemma, window L/R inside the sentence; logDice (sort key), MI, t-score, log-likelihood |
| N-grams | 2–6 words within a sentence; min frequency / min documents; stopword edges trimmed by default |
| Keyness | log-likelihood + log ratio against another corpus of the same language |

## Development

Tooling: [mise](https://mise.jdx.dev) (Python 3.14 + uv) and [uv](https://docs.astral.sh/uv/) for dependencies.

```bash
mise install                  # Python 3.14 and uv
mise run sync                 # uv sync: dependencies + the small (sm) spaCy models, for development and tests only
mise run test                 # uv run pytest
mise run lint                 # uv run ruff check . (CI runs lint + tests on every push and PR)
mise run dev                  # uvicorn with auto-reload on http://localhost:8000
```

The loader falls back to whichever installed model size is available (`SPACY_SIZE` sets the preferred one; without
it the order is `md`, `sm`, `lg`). So a local `uv sync` run uses `sm`, which is fine for tests but not for judging
lemma quality: install `md` or `lg` (`uv pip install` the wheel from the spacy-models releases, or `python -m spacy
download es_core_news_lg it_core_news_lg`) and set `SPACY_SIZE`. `GET /api/status` reports what is in use.
Add dependencies with `uv add <pkg>`; `uv.lock` is committed.

Layout (`src` layout): `src/colloca/ingest.py` (URL/DOCX/PDF → text), `nlp.py` (spaCy),
`analysis.py` (all statistics, SQL + Python), `main.py` (API, also serves the built UI from `static/`);
tests in `tests/`. The UI source is in `frontend/` (see below); its build output `src/colloca/static/` is git-ignored.

## Frontend development

The interface is a Svelte 5 + TypeScript single-page app built with Vite, in `frontend/`. mise pins Node (LTS).

```bash
mise run ui:build             # npm ci + vite build into src/colloca/static/ (git-ignored), served by `mise run dev`
mise run dev                  # API (and the built UI) on http://localhost:8000
mise run ui:dev               # Vite dev server with hot reload; proxies /api to the API on port 8000
mise run ui:test              # Vitest unit and component tests
mise run ui:lint              # eslint + svelte-check (type checking)
mise run ui:e2e               # builds the UI and runs the Playwright end-to-end tests against a real API
```

- **Build output**: Vite writes straight into `src/colloca/static/` and empties it first (the config refuses any
  other directory). A fresh checkout has no UI until `mise run ui:build`; until then `/` answers with a
  *UI not built* page (the API works). `docker compose up --build` builds the UI in a Node stage, so Docker users
  need neither Node nor a build. A wheel (`uv build`) includes the UI only if it was built first.
- **Layout**: a left rail with the corpus switcher (project filter, *…* to manage projects, corpus selector with
  its language, documents and words, *New corpus*, *Delete*), the screens grouped as **Corpus** (Sources, Base
  corpora), **Explore** (Concordance, Collocations, N-grams, Frequency list, Keyness, Word cloud, Equivalents),
  **Terms** (Termbase) and **Job**, and the theme switch (Auto, Light, Dark). The work area shows a toolbar with
  the options, the document filter, a result strip (counts and *Filter in results*), the sortable table and, for
  the selected row, a detail strip with its actions. Messages appear in the status line at the top. The screen
  and its options are kept in the address (`#/concordance?q=...`), so a reload or a bookmark restores a screen's
  search, and the rail brings each screen back with its last search; back/forward between two searches on the
  same screen changes the address but does not re-run the search. The Job report stays while you visit other
  screens (an analysis keeps running too) until you change the corpus.
- **Keyboard**: **Ctrl/Cmd+K** goes to the Concordance and focuses the query; **↑/↓** (and PageUp/PageDown,
  Home/End) move through the rows of a focused table, **Enter** opens the selected row (edit a document or a term);
  **Ctrl/Cmd+E** adds the selected concordance hit (or the selected text) as a term; **Esc** closes a dialog;
  **?** lists the shortcuts (Ctrl/Cmd+K does nothing while a dialog is open).
- Code: screens in `frontend/src/screens/`, reusable components in `frontend/src/lib/ui/`, API client, stores,
  routing and the interface strings (`i18n.ts`, English only for now) in `frontend/src/lib/`, colour and spacing
  tokens in `frontend/src/lib/styles/`. Tests in `frontend/tests/` (Vitest) and `frontend/e2e/` (Playwright).

## Safeguards

- **Language check**: every import is compared with the corpus language (Spanish/Italian stopword profile).
  A clear mismatch is rejected unless you tick “import even if the language looks wrong”; unclear or very
  short texts are imported with a warning badge. The result is stored per document (`lang_check`).
- **Limits** (environment variables): `MAX_UPLOAD_MB` (25 per file), `MAX_UPLOAD_FILES` (50 per request),
  `MAX_PDF_PAGES` (1000), `MAX_TEXT_MB` (10 per document), `MAX_DOWNLOAD_MB` (15 per URL).
- **CSV export** prefixes cells that start with `=`, `+`, `-`, `@` with `'`, so scraped text cannot run as a
  spreadsheet formula.
- **Background imports**: uploads, URL additions and pasted texts are queued and processed one at a time; the
  Sources screen shows progress and per-file errors (progress is followed whatever screen is open).
- **Database upgrades**: the schema is versioned (`PRAGMA user_version`, migrations in `db.py`). Before an
  existing database is migrated, a copy is written next to it (`corpus.db.bak-v<old version>`). A database from
  a newer Colloca is refused rather than corrupted.
- **Re-annotate**: after changing `SPACY_SIZE` or updating spaCy, documents annotated with another model are
  flagged “older model”; *Re-annotate with current model* (or `POST /api/corpora/{id}/reannotate`) redoes them
  from the stored text, so the whole corpus uses one pipeline.

## Known limitations

- No OCR: scanned PDFs are rejected. No JavaScript rendering for URLs (pages that need it fail to extract).
- Extraction is heuristic: always review the preview. URL fetching respects no robots.txt (you choose the URLs);
  it blocks private/internal addresses (`ALLOW_PRIVATE_URLS=1` to override). No authentication: bind to localhost only.
- Small spaCy models make lemma/POS errors; use `lg` (the Docker default) for better quality. A document in the
  wrong language is only caught when the check is confident (see Safeguards).
- No synonym/related-term module yet (planned: thesaurus + embeddings, labelled as "related terms").
- Jobs are kept in memory: a server restart forgets their status (documents already imported stay).
- The language check only separates Spanish from Italian reliably; other languages are flagged “unclear”.
