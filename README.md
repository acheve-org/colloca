# Colloca

Self-hosted tool for translators: build **monolingual reference corpora** (in the languages you set up) from chosen URLs and client documents, then explore them.

- Local only: one SQLite file in a Docker volume.
- No external services, except fetching the URLs you ask for.

## Features

- **Corpora** from URLs (single, lists, or an index page), uploads (DOCX, PDF with OCR, XLSX/CSV, XLIFF, SRT…) and pasted text; projects, tags, text types and dates to group and filter.
- **Analyses**: frequency, concordance (KWIC, wildcards, an advanced token query language), collocations, n-grams, keyness, dispersion plot, word cloud, related terms.
- **Aligned texts**: import TMX/XLIFF or align two documents, search source and target side by side, find equivalents, look up segments by match percentage, export TMX.
- **Termbase**: build terminology from any result, concepts with synonyms, TBX/Excel/CSV import and export, term checks in concordances.
- **Job analysis**: coverage, gaps, key terms and known terms of a text you are about to translate, with a leverage estimate.
- **Languages** you choose: add, edit or remove them, with a spaCy model, OCR data and a base corpus for each.
- Interface in English, Spanish and Italian; optional password and encrypted backups.

## Quick start

```bash
docker compose build            # builds the UI too
docker compose up
# open http://localhost:8000, then install the models in the Languages screen
# (Spanish and Italian are set up from the start; models are downloaded into `~/.spacy` when you ask)
```

Docker uses the `lg` spaCy models by default; data lives in the `colloca-data` volume.
Configuration: [Getting started](docs/getting-started.md). Backups: [Operations](docs/operations.md).

## Documentation

| Page | Contents |
|---|---|
| [Getting started](docs/getting-started.md) | Install and run, the basic workflow, projects, document details and filters |
| [Importing documents](docs/importing.md) | Supported formats, PDF layout and quality, OCR, language check, near-duplicates, limits |
| [Analyses](docs/analysis.md) | Frequency, concordance, collocations, n-grams, keyness, **advanced query language**, related terms |
| [Aligned texts](docs/aligned-texts.md) | Translation memories (TMX, XLIFF), aligning documents, equivalents, segment lookup, TMX export |
| [Termbase](docs/termbase.md) | Adding, reviewing, importing and exporting terminology (TBX, Excel, CSV) |
| [Job analysis](docs/job-analysis.md) | Analysing a text before translating it; saved reports |
| [Languages](docs/languages.md) | Setting up languages, their models, OCR data and base corpora |
| [Base corpora](docs/base-corpora.md) | General-language reference corpora and how to build a reliable one |
| [The interface](docs/interface.md) | Layout, keyboard shortcuts, interface language |
| [Accessibility](docs/accessibility.md) | Colour contrast (checked by the test suite), non-colour cues, keyboard and screen readers |
| [Password and encryption](docs/security.md) | Login, reverse proxy, encrypted backups, what is and is not protected |
| [Operations](docs/operations.md) | Backup and trash, upgrades, logging, offline model installs, performance, known limitations |

Sample TBX files to try in a CAT tool are in [`docs/samples/`](docs/samples/).

## Development

Tooling: [mise](https://mise.jdx.dev) (Python 3.14 + uv), [uv](https://docs.astral.sh/uv/) for dependencies.

```bash
mise install     # Python 3.14 and uv
mise run sync    # dependencies + small (sm) spaCy models, for development and tests only
mise run test    # pytest
mise run lint    # ruff (CI runs lint + tests on every push and PR)
mise run dev     # uvicorn with auto-reload on http://localhost:8000
```

- Python ≥ 3.12. CI tests 3.12, 3.13, 3.14; Docker and `mise.toml` use 3.14.
- Types: `uv run mypy` (basic, in CI). Coverage: `uv run pytest --cov` (printed in CI).
- Add dependencies with `uv add <pkg>`; `uv.lock` is committed.
- **Models**: the loader uses the installed size nearest to `SPACY_SIZE` (default order `md`, `sm`, `lg`). `uv sync` installs `sm`: fine for tests, not for judging lemma quality. For that, install `md` or `lg` (`python -m spacy download es_core_news_lg it_core_news_lg`) and set `SPACY_SIZE`. `GET /api/status` shows what is in use.
- **Logging, offline models, benchmarks**: [docs/operations.md](docs/operations.md).

### Layout

| Path | Role |
|---|---|
| `src/colloca/ingest.py` | URL/DOCX/PDF → text |
| `src/colloca/nlp.py` | spaCy |
| `src/colloca/analysis.py` | All statistics (SQL + Python) |
| `src/colloca/main.py` | API; serves the built UI from `static/` |
| `tests/` | Python tests |
| `frontend/` | UI source. Build output `src/colloca/static/` is git-ignored. |
| `docs/` | User documentation, one page per topic |

### Frontend

Svelte 5 + TypeScript + Vite, in `frontend/`. mise pins Node (LTS).

```bash
mise run ui:build   # npm ci + vite build into src/colloca/static/, served by `mise run dev`
mise run dev        # API (and built UI) on http://localhost:8000
mise run ui:dev     # Vite dev server with hot reload; proxies /api to port 8000
mise run ui:test    # Vitest
mise run ui:lint    # eslint + svelte-check
mise run ui:e2e     # builds the UI, runs Playwright against a real API
```

- **Build output**: Vite empties and writes `src/colloca/static/` (refuses any other directory).
  - Fresh checkout: no UI until `mise run ui:build`; `/` shows a *UI not built* page, the API works.
  - `docker compose up --build` builds the UI in a Node stage: Docker users need neither Node nor a build.
  - A wheel (`uv build`) includes the UI only if built first.
- **Code**: screens `frontend/src/screens/`; components `frontend/src/lib/ui/`; API client, stores, routing `frontend/src/lib/`; tokens `frontend/src/lib/styles/`. Tests: `frontend/tests/` (Vitest), `frontend/e2e/` (Playwright).
- **Interface strings**: `frontend/src/lib/locales/{en,es,it}.ts`, one key per string, `{name}` placeholders.
  - English is the source. A unit test fails if `es.ts` or `it.ts` lacks a key, has an extra, changes a placeholder, or leaves English text.
  - New language: copy `en.ts`, translate, register in `frontend/src/lib/locale.svelte.ts` and `frontend/src/lib/i18n.ts`.
- **Colours**: edit `frontend/src/lib/styles/tokens.css`. The contrast test fails below WCAG AA and regenerates the table in [docs/accessibility.md](docs/accessibility.md).
- **Docs**: keep the README to overview and development; user documentation goes in `docs/`.
