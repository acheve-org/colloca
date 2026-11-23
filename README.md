# Colloca (MVP)

Self-hosted web tool for translators to build **monolingual reference corpora** (Spanish, Italian)
from hand-picked URLs and client documents, and explore them: frequency, concordance (KWIC),
collocations, n-grams / phraseology, keyness and word clouds.

Everything stays on your machine: one SQLite file in a Docker volume, no external services
(except fetching the URLs you ask for).

## Run

```bash
docker compose up --build        # first build downloads the spaCy models
# open http://localhost:8000
```

Use faster/smaller models with `SPACY_SIZE=sm` (edit `docker-compose.yml`). Data lives in the
`colloca-data` volume; back it up with `docker run --rm -v colloca-data:/d -v $PWD:/b alpine tar czf /b/colloca-backup.tgz -C /d .`.

## Workflow

1. **New corpus** (name + language), e.g. "Client X – wind energy [es]".
2. **Sources**: paste a URL → *Fetch & preview* → trim noise in the text box → *Add*.
   Or upload DOCX / PDF (text layer) / TXT / HTML. Exact duplicates are rejected.
3. Explore with the tabs. Click any word in a table to jump to its concordance. Every table has a CSV export.
4. **Keyness**: compares your corpus with the language's **base corpus** (below) by default, or with any other
   corpus of the same language you pick.

## Base corpora (general language per language)

A corpus built for one client is usually small, so its statistics need something to be compared with. Each
language can have **one base corpus**: a general-language reference kept apart from your own corpora (it is not
in the corpus selector, and it never mixes into their concordances, frequencies or n-grams). It is used for:

- **Keyness**: the default reference (pick another corpus in the list if you prefer).
- **Frequency and Collocations**: tick “compare with base corpus” to add *Base per M* (how common the item is in
  general language), which separates domain vocabulary from everyday words.

Create and fill it in the **Base corpora** tab. Sentence files (one sentence per line, or Leipzig Corpora
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
mise run sync                 # uv sync: dependencies + spaCy models (sm)
mise run test                 # uv run pytest
mise run lint                 # uv run ruff check . (CI runs lint + tests on every push and PR)
mise run dev                  # uvicorn with auto-reload on http://localhost:8000
```

The loader falls back to whichever installed model size is available (`SPACY_SIZE` sets the preferred one).
Add dependencies with `uv add <pkg>`; `uv.lock` is committed.

Layout (`src` layout): `src/colloca/ingest.py` (URL/DOCX/PDF → text), `nlp.py` (spaCy),
`analysis.py` (all statistics, SQL + Python), `main.py` (API), `static/` (UI, no build step);
tests in `tests/`.

## Safeguards

- **Language check**: every import is compared with the corpus language (Spanish/Italian stopword profile).
  A clear mismatch is rejected unless you tick “import even if the language looks wrong”; unclear or very
  short texts are imported with a warning badge. The result is stored per document (`lang_check`).
- **Limits** (environment variables): `MAX_UPLOAD_MB` (25 per file), `MAX_UPLOAD_FILES` (50 per request),
  `MAX_PDF_PAGES` (1000), `MAX_TEXT_MB` (10 per document), `MAX_DOWNLOAD_MB` (15 per URL).
- **CSV export** prefixes cells that start with `=`, `+`, `-`, `@` with `'`, so scraped text cannot run as a
  spreadsheet formula.
- **Background imports**: uploads, URL additions and pasted texts are queued and processed one at a time; the
  Sources tab shows progress and per-file errors.
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
- Small spaCy models make lemma/POS errors; use `md`/`lg` for better quality. A document in the
  wrong language is only caught when the check is confident (see Safeguards).
- No synonym/related-term module yet (planned: thesaurus + embeddings, labelled as "related terms").
- Jobs are kept in memory: a server restart forgets their status (documents already imported stay).
- The language check only separates Spanish from Italian reliably; other languages are flagged “unclear”.
