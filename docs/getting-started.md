# Getting started

## Install and run

```bash
docker compose build     # builds the UI too
docker compose up
# open http://localhost:8000, then install the models in the Languages screen

```

| Topic | Detail |
|---|---|
| Models | Not in the image. Stored in `~/.spacy` on the host, mounted at `/models` (`COLLOCA_MODELS_DIR`). Installed per language in the Languages screen ([languages.md](languages.md)). |
| Model size | Default `SPACY_SIZE` (`sm`, `md`, `lg`) on the `colloca` service, compose default `lg` (recommended); each language can use another size. |
| Prefetch models | `docker compose run --rm colloca download-models [CODE...]` (default `es it`) |
| Active model | Shown in the status line; a warning appears when a language runs on `sm`. |
| Data | `colloca-data` volume. See [operations.md](operations.md) for backup and trash. |

## Workflow

1. **Project and corpus** (*Projects*): create a **project** for the client or job, then *New corpus* (name + language, e.g. es, it) inside it. Every working corpus belongs to a project. On first run the empty screens lead you through Languages → Projects → Sources.
2. **Add sources** (*Sources*):

   | Method | Behaviour |
   |---|---|
   | One URL | *Fetch & preview*, trim noise, *Add*. |
   | *Add several addresses* | One URL per line, no preview. Each is a background job. Limits: `MAX_URL_LIST` 50 per list, `MAX_URLS_PER_HOST` 20, `URL_DELAY_SECONDS` 1 s between requests to one site. API: `POST /api/corpora/{id}/urls`. |
   | *Import from an index page* | Index page or RSS/Atom feed. Lists its links (navigation, footer, account, search and tag links excluded). You filter and select. Imported in batches of at most 20, no preview. One page only: no crawling. API: `POST /api/discover-links`. |
   | Upload | Formats in [importing.md](importing.md). Exact duplicates are rejected. |

   Index imports flag in the job report: very short texts, cookie/JavaScript/paywall boilerplate, landing-page titles, repeated titles. Flagged documents are still added.
3. **Explore** with the left rail.
   - Click any word in a table to open its concordance.
   - Every table: sort by header, *Filter in results*, CSV export.
   - Tables over 400 rows render only visible rows; sorting, filtering and keyboard act on all rows.
4. **Keyness**: reference is the language's [base corpus](base-corpora.md) by default, or any other corpus of the same language. *Show* adds under-used words (negative LL), including words only in the reference.
5. **Dispersion plot**: one bar per document, one mark per hit. Same query options as the concordance; hit counts match. Click a mark to read the passage, then step through hits.

Screen details: [analysis.md](analysis.md).

## Projects, document details and filters

- **Project**: groups a client's corpora.
  - Every working corpus belongs to exactly one project (`POST /api/corpora` needs `project_id`). Move a corpus to another project from the *Move* menu on the *Projects* screen; it cannot be taken out of a project.
  - A project can be deleted only when it has no corpora, trashed ones included. *Projects* offers to move its live corpora elsewhere first; for corpora in the Trash, restore or empty them in *Backup and Trash*.
  - Base corpora have no project.
  - The first start of a version with mandatory projects creates a project named `General` for corpora that had none ([operations.md](operations.md#database-upgrades)).
- **Document details**:

  | Field | Format |
  |---|---|
  | Tags | free |
  | Text type | e.g. contract, manual |
  | Date | `2024`, `2024-05`, `2024-05-17` |
  | Author | free |

  Set before adding (*Details* box in *Sources*; applies to URL, upload, pasted text) or later with *Edit*.
- **Document filter** (*Only documents with…*): above every analysis screen and the Job screen.
  - Criteria: all given tags, a text type, a date range.
  - Everything is recomputed on the subset: sizes behind *per million*, *Docs %*, collocation statistics, keyness. The reference corpus stays whole.
  - CSV exports use the same filter.
  - A partial date counts as its first day. Undated documents never match a date filter.
  - API query parameters on every analysis endpoint: `tags=a,b&text_type=contract&date_from=2022&date_to=2024-06&docs=1,2`.
