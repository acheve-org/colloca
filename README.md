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
`colloca-data` volume; back it up from the *Backup and Trash* screen (a zip with a consistent copy of the database; single projects can be exported and imported too), or with `docker run --rm -v colloca-data:/d -v $PWD:/b alpine tar czf /b/colloca-backup.tgz -C /d .`. Deleted corpora, documents and terms stay in the Trash for 30 days (adjustable) before they are removed.

## Workflow

1. **New corpus** (name + language), e.g. "Client X – wind energy [es]". Group the corpora of a client under a
   **project** (the *…* button next to the project selector at the top of the left rail opens *Manage projects*);
   the project selector narrows the corpus list.
2. **Sources**: paste a URL → *Fetch & preview* → trim noise in the text box → *Add*. For many pages, *Add several
   addresses* takes a list (one per line, no preview): each becomes a background job with its own result, with a pause
   between requests to the same site (`URL_DELAY_SECONDS`, 1 s), at most `MAX_URL_LIST` (50) addresses per list and
   `MAX_URLS_PER_HOST` (20) per site. API: `POST /api/corpora/{id}/urls`.
   Or upload files (formats below). Exact duplicates are rejected.
3. Explore with the screens of the left rail. Click any word in a table to jump to its concordance. Every table
   sorts by a click on its header, has a *Filter in results* box, and a CSV export. Long tables (over 400 rows) render only the rows
   on screen, so a 2,000-line concordance or a 3,000-row n-gram list stays fast; sorting, filtering and the keyboard
   still act on all rows.
4. **Keyness**: compares your corpus with the language's **base corpus** (below) by default, or with any other
   corpus of the same language you pick. The *Show* choice adds **under-used** words (negative LL), including
   words that occur only in the reference corpus.
5. **Dispersion plot**: where a word or phrase occurs in each document of the corpus (the same query options as the
   concordance). One bar per document from start to end, a mark per hit; click a mark to read that passage, then
   step through the hits. The hit counts match the concordance.

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

## Input formats

Upload (*Sources*) and *Analyse a job* accept:

| Format | What is imported |
| --- | --- |
| `.docx`, `.odt`, `.rtf` | Body text and tables (ODT: footnotes and comments are left out). |
| `.pdf` | The text layer; a PDF without one is read with **OCR** (below). |
| `.xlsx`, `.csv`, `.tsv` | The text columns, one cell per line (all sheets of an XLSX). They are detected (columns of words, not numbers, codes or dates); the *Spreadsheet columns* field overrides it with numbers or header names, e.g. `2,4` or `Texto`. A header row is skipped. |
| `.xlf`, `.xliff` (1.2 and 2.x) | Plain text of the side written in the corpus language (target if it is the corpus language, else source), inline codes removed. For translation pairs use *Import aligned texts*. |
| `.srt`, `.vtt` | Cue text, one line per cue; numbers, timings, tags, VTT notes and styles are dropped. |
| `.txt`, `.md`, `.html` | As before. |

XML formats are parsed with `defusedxml` (no external entities). The size and page limits below apply to all of them.

### OCR for scanned PDFs (optional)

PDFs with no text layer are OCRed when the optional extra and Tesseract are installed; otherwise the upload fails
with a message that says what to install (no stack trace). Pages are rendered with `pypdfium2` and read with the
`tesseract` program in the corpus language (`spa` or `ita`).

```bash
uv sync --extra ocr                                              # pypdfium2 + Pillow
brew install tesseract tesseract-lang                            # macOS
sudo apt install tesseract-ocr tesseract-ocr-spa tesseract-ocr-ita   # Debian/Ubuntu
docker build --build-arg WITH_OCR=1 -t colloca .                 # Docker image with OCR (about 100 MB larger)
```

The job result reports the pages read and the mean word confidence, and warns when it is under 70 % (`OCR_MIN_CONFIDENCE`)
— check such text before trusting lemmas. Limits: `MAX_OCR_PAGES` (100), `OCR_PAGE_TIMEOUT` (120 s per page).
`OCR_ENABLED=0` switches OCR off. OCR is slow (seconds per page) and runs as a background job like any import.

## Aligned texts (translation memories)

Previous translations are the best evidence of how a client wants things said. Import them as **aligned texts**
and search them side by side:

- **Import** (*Sources* → *Import aligned texts*): a **TMX** or **XLIFF** (1.2 or 2.x, `.xlf`/`.xliff`) file, or two columns (source | target) as `.tsv`,
  `.csv` (comma, semicolon or tab) or a table in a `.docx`. The corpus you are in receives the first language, the
  other-language texts go to a corpus you pick (or create). TMX and XLIFF are matched by their language codes (XLIFF: `source-language`/`target-language`, or `srcLang`/`trgLang`; units without a target are skipped) (`es`, `es-ES`,
  `it_IT`…), inline markup is dropped, units missing one language are skipped. Two-column files use column order;
  tick *this corpus is the second column* if yours is the other way round. Files over 5000 units are stored in parts.
- **Each side is a normal corpus** in its own language (so frequency, keyness, collocations, the termbase… all work
  on it, and the target-language side is a ready corpus of the client's Italian). They are linked segment by
  segment: segment N of one is the translation of segment N of the other. Re-annotating keeps the alignment.
  Removing one side's document unlinks the other.
- **Align two documents** (*Sources* → *Align two documents*): no TMX? Upload the original and its translation (DOCX, PDF
  with text layer, TXT, HTML). Both are split into sentences and matched by length (Gale and Church), with numbers,
  names written the same on both sides and closing punctuation as anchors; paragraph breaks are used first. Link
  types are 1:1, 1:2, 2:1, 1:0 and 0:1. The result is only a **proposal**: the review table marks links to check
  (with the word "Check", not only a colour), and you can merge, split, delete, then confirm. Nothing is stored
  before that. Merged sentences are stored as one segment, joined by a space; units with an empty side (1:0, 0:1)
  cannot be a pair and are not stored. Length-only alignment is weak on very short or reordered text: always look
  at the marked links.
- **Concordance → *Source + target*** (appears when the corpus has aligned texts) shows each hit as its source
  segment next to the aligned target segment; run it on the target-language corpus to search by the translation
  instead. The query is marked in the source segment, and the **likely equivalent** in the target: an **approved**
  termbase translation of the query (solid underline) wins; otherwise the best candidate of *Equivalents* is marked
  with a dotted underline and the label *guess*. A guess is statistical: check it before adopting it (in a small
  memory several words can tie, and the one that looks most like the query is chosen). Words are matched by lemma,
  so *contratti* is marked for *contrato*. The CSV export is unchanged.
- **Termbase hits in concordance lines** (KWIC and *Source + target*): words that belong to a termbase entry of the
  corpus's project (or the general termbase) are underlined, with the approved translation on hover; inflected forms
  and multi-word terms match (by word form or lemma). A **forbidden** translation found in a target segment is struck
  through and marked ⚠ (not colour alone), with the approved alternative on hover. The **Check text** screen (Terms
  group) does the same for a pasted source segment or draft translation. Matching runs on the server
  (`POST /api/corpora/{id}/check-text`; `source_terms` / `target_terms` and `left_terms` / `node_terms` /
  `right_terms` offsets in the concordance responses); CSV exports are unchanged.
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
- **Review candidates**: every candidate table (*Frequency*, *Collocations*, *N-grams*, *Keyness*, and the Job gaps, key
  terms and phrases) shows an **In termbase** badge (single words match by lemma, phrases by their word forms; any
  status counts) and has *Only not in termbase* and *Show dropped* switches. **Drop** puts a term on the project's
  stop list (per project and language, case-insensitive), hiding it from those tables in that project only; **Restore**
  takes it off, here or in the stop list at the foot of the *Candidates* screen. **→ Candidates** keeps a term in the
  *Candidates* screen (stored in this browser, per project and language), where **Accept** saves it as `approved` when
  a translation is typed, and otherwise opens the pre-filled add-term dialog.
- **Entries** are (source term, translation) pairs with part of speech, status, domain, definition, notes and an
  example sentence. *Status*: `candidate` (to be reviewed; the translation may be empty), `approved` (the preferred term),
  `admitted` (an acceptable alternative), `superseded` (obsolete) or `forbidden` (a translation that must **not** be
  used; it is exported as a deprecated term). Every status but `candidate` needs a translation. Target language is the other supported language.
- **Scope**: entries belong to the project of the corpus they were added from (corpora without a project share a
  general termbase). The *Termbase* screen lists entries, sorts by any column, searches, filters by status, domain,
  part of speech and modification date, edits status and translation in the table, and applies a status or domain to,
  or deletes, the selected rows.
- **Export** (same screen, or `GET /api/terms/export?format=...&project=...&status=...`): `tbx`, `tbx2`, `xlsx`, `csv`.
  By default *approved* and *admitted* entries are exported; tick *include candidates* to add the candidates.
  - **TBX** (TermBase eXchange, ISO 30042) with TBX-Basic data categories only. `tbx` uses the 2019 structure
    (`conceptEntry / langSec / termSec`), `tbx2` the 2008 one (`termEntry / langSet / tig`) that most CAT tools read.
    Rows with the same source term form one concept; approved translations are `preferredTerm`, admitted ones
    `admittedTerm`, superseded ones `supersededTerm` and forbidden ones `deprecatedTerm`; candidates carry no
    `administrativeStatus` (TBX-Basic has no "proposed" value). Excel and CSV write the status word as it is.
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

### Recipe: a reliable base corpus per language

The base corpus answers one question: is this word domain vocabulary or just ordinary language? It should therefore
be **general, large, clean and varied**.

**Which files** (Leipzig Corpora Collection, <https://wortschatz.uni-leipzig.de>, CC BY; check the current list of
files before choosing, it changes by year):

- Spanish: `spa_news_<year>_*`, `spa_web_<year>_*` and `spa_wikipedia_<year>_*`.
- Italian: `ita_news_<year>_*`, `ita_web_<year>_*` and `ita_wikipedia_<year>_*`.

**Size and mix**: about 250k sentences per language (roughly 5M words), for example 100k news + 100k web +
50k Wikipedia. Import each file with `--max-sentences` to cap it. More than 300k sentences adds little for
rare-word statistics and makes annotation very slow.

**Rules that keep it reliable**:

- **Match the register to your work.** News alone flags “formal” words as key terms in legal, technical or commercial
  texts; mix news with web and Wikipedia.
- **One year or period per source.** Vocabulary drifts, so do not mix very old and very new files.
- **One file per source and type.** The 300K file contains the 100K file; importing both counts those sentences
  twice and distorts frequencies.
- **Never add your own documents** to the base corpus: that shrinks the contrast keyness is meant to show.
- **Use the language variety of your target** (European Spanish for work in Spain). Otherwise regional words come
  out as key terms.
- **Credit the source** (CC BY) and use the `lg` models (the Docker default), so lemmatisation is the same in the
  base and in your corpora.

**Sanity check**: run Keyness of a small neutral text (a general article) against the base. It should show few or no
key terms; many key terms mean the base is too narrow or its register is off.

## Interface language

The interface is available in **English, Spanish and Italian**. The first visit follows the browser's language; the
**EN / ES / IT** switch at the bottom of the left rail changes it at once (no reload, no data is fetched again) and the
choice is remembered in the browser. Tables sort and numbers are written by the rules of the chosen language. Text that
comes from the server (error messages, the wording of language checks and job progress) and your own data stay as they are.

The catalogues are `frontend/src/lib/locales/{en,es,it}.ts`, one key per string with `{name}` placeholders. English is the
source: a unit test fails if `es.ts` or `it.ts` lacks a key, has an extra one, changes a placeholder, or leaves English text
in place. To add a language, copy `en.ts`, translate it, and register it in `frontend/src/lib/locale.svelte.ts` and
`frontend/src/lib/i18n.ts`. Colours and contrast (with the measured ratios) are documented in
[`docs/accessibility.md`](docs/accessibility.md).

## Measures

| Analysis | Details |
|---|---|
| Frequency | by lemma or form, per million, number/percentage of documents containing it (dispersion), POS filter |
| Concordance | words or phrases (up to 6 words), match on lemma or exact form; options below |
| Collocations | single node lemma, window L/R inside the sentence; logDice (sort key), MI, t-score, log-likelihood |
| N-grams | 2–6 words within a sentence; min frequency / min documents; stopword edges trimmed by default |
| Keyness | log-likelihood + log ratio against another corpus of the same language |

Concordance options (also available as API parameters):

- **Case sensitive** (`case_sensitive=true`): matches the written form, so *Contrato* does not find *contrato*.
- **Wildcard `*`** at the start and/or end of a word: `contrat*` finds *contrato*, *contratos*, *contratación*;
  `*miento` finds *cumplimiento*. At least three letters besides `*` are required, and `*` in the middle of a word is
  refused. `?` and `[` are ordinary characters.
- **Any order** (`any_order=true`): all the words of the query in the same sentence, in any order; the node spans from
  the first to the last of them.
- **Advanced query** (`advanced=true`): token syntax with regex, lemma and part of speech, `|`, and gaps, for example
  `[lemma="tomar"] []{0,3} [pos="NOUN"]` or `tomar +3 NOUN`; the query is echoed back in words and mistakes point at
  the character. Full grammar, examples and limits in [docs/query-language.md](docs/query-language.md).
- **Ignore accents** (`accent_insensitive=true`): `cafe` finds *café* (ñ stays distinct from n); works with both
  syntaxes.
- **Hits** (100, 500 or 2000) and **Random sample** (`sample=<seed>`): a random selection of that many hits, the same
  for the same seed; **New sample** draws another one. The hit count always shows the total found.
- **Sort**: document, whole left or right context, or the 1st or 2nd word to the left or right (`l1 l2 r1 r2`).
- **Filter boxes** above the table narrow the lines already loaded (left/right context, or source/target in aligned
  mode) without a new search; the CSV export carries the search options, not these client-side filters.

Selecting a hit shows the document's metadata (source, author, date, text type, tags) and the whole sentence under
the table. **Open document** reads the text around the hit with the match marked (aligned documents show the
translation of each segment beside it), with *Previous / Next hit* and *Show more before / after*. The browser asks
`GET /api/documents/{id}/context?pos=&span=&radius=` for just the sentences or segments around the hit, never the whole
text.

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

Python 3.12 or newer (CI runs the tests on 3.12, 3.13 and 3.14; Docker and `mise.toml` use 3.14). Type checking is
`uv run mypy` (basic level, in CI) and coverage `uv run pytest --cov` (printed in CI).

Logging: `COLLOCA_LOG_LEVEL` (`INFO` by default), `COLLOCA_LOG_FORMAT=json` for one JSON object per line, and
`COLLOCA_SLOW_MS` (default 1000, `0` = off): requests and concordance queries slower than that are logged as warnings;
import and analysis jobs log when they are queued, started, done or rejected, and 5xx responses and job crashes
are logged with their stack trace.

Offline or locked-down installs of the spaCy models (no GitHub at build time): on a machine with internet run
`uv run python scripts/fetch_model_wheels.py wheels --size lg` (es and it; `--dry-run` lists the URLs), copy the
`wheels/` directory over and run `uv pip install --no-index --find-links wheels es_core_news_lg it_core_news_lg`.
In Docker, mount the directory and set `SPACY_WHEELS=/wheels`: the entrypoint then installs from it instead of downloading.

Sample data and benchmarks: `uv run python scripts/make_sample_corpus.py --lang es --words 1m --db /tmp/s.db` builds
a synthetic annotated corpus (`100k`, `1m`, `5m` or any number; seeded, so reproducible; 1M words take under 10
seconds), and `uv run python scripts/bench_analyses.py --words 1m` times every analysis on one and prints a table.
It only measures; it changes no data outside its own temporary database.

Timings (`bench_analyses.py`, synthetic Spanish corpus, one run, Apple-silicon laptop, SQLite, no precomputed counts;
before → after the T17 changes, in milliseconds):

| Analysis | 1M words | 5M words |
|---|---:|---:|
| frequency (lemma) | 653 → 546 | 3,620 → 2,998 |
| frequency (form) | 989 → 881 | 5,422 → 4,619 |
| concordance, frequent / mid / rare word | 13 / 8 / 1 (unchanged) | 32 / 15 / 6 (unchanged) |
| concordance, wildcard | 69 → 64 | 354 → 343 |
| collocations, frequent word | 429 → 432 | 2,291 → 2,244 |
| collocations, mid word | 398 → 302 | 2,134 → 2,130 |
| n-grams (3, form) | 2,048 → 1,655 | 10,330 → 9,213 |
| keyness vs reference | 912 → 878 | 4,660 → 4,686 |
| coverage / job analysis | 606 → 542 | 1,829 → 1,811 |

No analysis takes over 5 s on a 1M-word corpus. At 5M words n-grams (about 9 s) and the unit-`form` frequency
(4.6 s) are the slow ones; the cost is a scan over the `tokens` table, so a precomputed per-corpus count table
(backlog T17) would be the next step if corpora of that size matter. Concordance stays in milliseconds because it
uses the lemma/form indexes. Results are identical before and after (checked by comparing both versions on a
generated corpus, and the statistics tests are unchanged).

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
  corpora), **Explore** (Concordance, Collocations, N-grams, Frequency list, Dispersion plot, Keyness, Word cloud, Equivalents),
  **Terms** (Termbase) and **Job**, and the theme and language switches (Auto, Light, Dark; EN, ES, IT). The work area shows a toolbar with
  the options, the document filter, a result strip (counts and *Filter in results*), the sortable table and, for
  the selected row, a detail strip with its actions. Messages appear in the status line at the top. The screen
  and its options are kept in the address (`#/concordance?q=...`), so a reload or a bookmark restores a screen's
  search, and the rail brings each screen back with its last search; back/forward between two searches on the
  same screen changes the address but does not re-run the search. The Job report stays while you visit other
  screens (an analysis keeps running too) until you change the corpus.
- **Keyboard**: **/** or **Ctrl/Cmd+K** goes to the Concordance and focuses the query (filled with the selected text,
  if there is a short selection); **↑/↓** (and PageUp/PageDown, Home/End) move through the rows of a focused table,
  **Enter** opens the selected row (edit a document or a term); **Ctrl/Cmd+E** adds the selected concordance hit
  (or the selected text) as a term; on the Candidates screen **A** accepts and **D** drops (or restores) the
  selected row; in the term dialog **1** to **9** use the matching example sentence; **Esc** closes a dialog;
  **?** lists the shortcuts. Plain-key shortcuts are off while you type in a field, and `/`, Ctrl/Cmd+K are off
  while a dialog is open. In the **?** overlay, select a key to change it (press the new keys, Esc cancels);
  the choice is kept in the browser (`localStorage`, key `colloca.keys`) and *Restore default keys* undoes it.
  Buttons show their key in the tooltip.
- Code: screens in `frontend/src/screens/`, reusable components in `frontend/src/lib/ui/`, API client, stores,
  routing and the interface strings (`i18n.ts`, English only for now) in `frontend/src/lib/`, colour and spacing
  tokens in `frontend/src/lib/styles/`. Tests in `frontend/tests/` (Vitest) and `frontend/e2e/` (Playwright).

## Safeguards

- **Glossary import**: Termbase → Import glossary reads `.xlsx`, `.csv`/`.tsv` (map the columns, header row or not) and `.tbx` (2008 and 2019 structures; XML entities are refused). A check run lists what would be added, skipped as duplicates and rejected, with the reason per row; nothing is stored until you confirm. Status defaults to `candidate` unless the file carries one. Tested with files made from Colloca's own export and `docs/samples`; real CAT-tool exports have not been tried.
- **Language check**: every import is compared with the corpus language (Spanish/Italian stopword profile).
  A clear mismatch is rejected unless you tick “import even if the language looks wrong”; unclear or very
  short texts are imported with a warning badge. The result is stored per document (`lang_check`).
- **Near-duplicates**: besides byte-identical texts, an import is compared with the corpus by a MinHash sketch of
  its 5-word shingles (case, punctuation and whitespace ignored; stored in `documents.fingerprint`, schema v9). At
  85% or more (`NEAR_DUP_THRESHOLD`, 0.5 to 1) the import stops and the Sources page shows the older document, how
  many paragraphs they share and a few new or changed ones, with *Import anyway*, *Replace* (the most similar older
  document) and *Skip*; the held file stays in server memory until decided (up to 20, lost on restart). *Find
  near-duplicates* lists the pairs already in a corpus (`GET /api/corpora/{id}/near-duplicates?threshold=`);
  documents older than v9 are fingerprinted on first use. Sentence files and aligned texts are not compared. The
  similarity is an estimate (about ±5 points for long texts) and measures shared wording, so a short text inside a
  long one is not flagged. `scripts/bench_dedup.py` times it.
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

- OCR is optional (see *Input formats*) and its accuracy depends on the scan. No JavaScript rendering for URLs (pages that need it fail to extract).
- Extraction is heuristic: always review the preview. URL fetching respects no robots.txt (you choose the URLs);
  it blocks private/internal addresses (`ALLOW_PRIVATE_URLS=1` to override); the name is resolved once per request
  and the connection goes to that checked address (certificates are still verified against the host name), so a DNS
  answer that changes between the check and the connection cannot reach an internal address. No authentication: bind to localhost only.
- Small spaCy models make lemma/POS errors; use `lg` (the Docker default) for better quality. A document in the
  wrong language is only caught when the check is confident (see Safeguards).
- No synonym/related-term module yet (planned: thesaurus + embeddings, labelled as "related terms").
- Jobs are kept in memory: a server restart forgets their status (documents already imported stay).
- The language check only separates Spanish from Italian reliably; other languages are flagged “unclear”.
