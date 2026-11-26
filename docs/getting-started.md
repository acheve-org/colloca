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
| Active model | Shown on the Languages screen; a warning appears when a language runs on `sm`. |
| Data | `colloca-data` volume. See [operations.md](operations.md) for backup and trash. |

## Workflow

1. **Project and corpus** (*Projects*): create a **project** for the client or job, then *New corpus* (name + language, e.g. es, it) inside it. Every working corpus belongs to a project. On first run, every screen shows a three-step checklist (add a language, start a project, create a corpus) with a button for the current step, until all three exist.
2. **Add documents** (*Sources* > *+ Add documents*). *Sources* lists the corpus's documents; *+ Add documents* (also the four tiles on an empty corpus) opens the *Add documents* page. Choose a method in its tabs:

   | Method | Behaviour |
   |---|---|
   | *From the web* > *One page* | *Fetch & preview*, trim noise, *Add to corpus*. |
   | *From the web* > *Several addresses* | One URL per line, no preview; *Add all*. Each is a background job. Limits: `MAX_URL_LIST` 50 per list, `MAX_URLS_PER_HOST` 20, `URL_DELAY_SECONDS` 1 s between requests to one site. API: `POST /api/corpora/{id}/urls`. |
   | *From the web* > *From an index page* | Index page or RSS/Atom feed; *Find links* lists its links (navigation, footer, account, search and tag links excluded). You filter and select, then *Import N pages*. Imported in batches of at most 20, no preview. One page only: no crawling. API: `POST /api/discover-links`. |
   | *Upload files* | *Upload*. Formats in [importing.md](importing.md). Exact duplicates are rejected. |
   | *Paste text* | Title and text; *Add text*. |
   | *Aligned texts* | *Translation memory* (TMX, XLIFF, two columns; *Import*) or *Align two documents* (*Propose alignment*). See [aligned-texts.md](aligned-texts.md). |

   The *About these documents* card (Tags, Text type, Date, Author, *Import even if the language looks wrong*) applies to everything added in that step, including a translation-memory import. *Align two documents* is the exception: it has its own buttons and does not use these details or the bar below. For the other methods, the bar at the foot of the page shows what will be added and where, with *Cancel* and the action of the current method. *Cancel* returns to the document list and discards the form. After a successful add the app also returns to the list, where the job log shows progress, and the *About* values are kept for the next add; they are cleared on *Cancel* and when the corpus changes.

   Index imports flag in the job report: very short texts, cookie/JavaScript/paywall boilerplate, landing-page titles, repeated titles. Flagged documents are still added.
3. **Explore**: pick Explore in the rail, then a tab.
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

  Set before adding (*About these documents* on the *Add documents* page; applies to URL, upload, pasted text and translation-memory imports, not to *Align two documents*) or later with *Edit details* on *Sources*.
- **Document filter**: the *All documents* pill at the right of the context header on every analysis screen, *Segment lookup* (aligned corpora) and the Job screen. It reads *N of M documents* when active; each active part also shows as a chip with a remove button. The pill opens a panel with *Tags*, *Type*, *From*, *To*, the summary, *Clear* (when a filter is active) and *Done* (*Esc* or a click outside closes it).
  - It persists when you move between screens and resets when you switch corpus. Changing it does not re-run a search: search again.
  - Criteria: all given tags, a text type, a date range.
  - Everything is recomputed on the subset: sizes behind *per million*, *Docs %*, collocation statistics, keyness. The reference corpus stays whole.
  - CSV exports use the same filter.
  - A partial date counts as its first day. Undated documents never match a date filter.
  - API query parameters on every analysis endpoint: `tags=a,b&text_type=contract&date_from=2022&date_to=2024-06&docs=1,2`.
