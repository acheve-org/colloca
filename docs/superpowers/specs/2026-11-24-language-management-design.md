# Language management: design

## Intent

Colloca is a generic tool for translators. Each translator works with their own languages, so the list of supported
languages cannot be fixed in code (today `nlp.SUPPORTED = {es, it}`). The user needs a *Languages* section where they
add, edit and remove the languages they work with and, for each one, manage its spaCy model and its base corpus.

## Goals

- A Languages screen: list, add (from a catalog), edit, remove.
- Per language: install, change size of, and uninstall the spaCy model from the UI, with visible progress.
- Per language: install and remove the Tesseract OCR data, and see whether OCR is ready.
- Per language: see and manage the base corpus (create, fill, delete) on the same screen.
- Everything that is hard-coded to es/it becomes registry-driven: model loading, language validation, language check,
  OCR language, CLI, backup import, the language pickers of the UI.
- Existing installations keep working untouched: es and it are the seed rows, models already installed are detected.

## Non-goals

- Custom or third-party model packages (catalog only, for now).
- Languages without an official spaCy trained pipeline (a blank tokenizer-only model gives no lemmas or POS, so
  collocations and keyness would be poor).
- Japanese, Korean and Chinese in the first catalog: they are not space-delimited, and the language check and the
  word regex used for queries assume space-delimited text.
- Installing the Tesseract program itself from the UI (it is a system package, installed at image build with
  `WITH_OCR=1`). Only its per-language data is managed by the app.
- Translating language names per UI locale (the catalog carries English names; the user can edit the display name).
- Renaming a language code.

## Anti-goals

- Removing a language or model silently breaking existing corpora or imports.
- A half-downloaded model that looks installed.
- Installing arbitrary packages: the UI must never be able to name a package that is not in the catalog.

## Approaches

1. **Registry in the database plus a built-in catalog of spaCy's official pipelines** (chosen). Fits "each translator
   decides"; the app is the only place to configure.
2. A `languages.toml` edited by hand. Rejected: not a section of the app; translators would edit config.
3. A larger fixed list with on/off toggles. Rejected: the list is still decided in code.

## Design

### Data

Migration v14 adds `languages(code TEXT PRIMARY KEY, name TEXT NOT NULL, model_size TEXT, tesseract TEXT, added TEXT)`
and seeds `es` ("Spanish", tesseract `spa`) and `it` ("Italian", `ita`). `model_size` NULL means "follow the default":
`SPACY_SIZE` if set, else today's behaviour. `corpora.lang` keeps being a plain code; no foreign key (trashed and
imported rows must not break).

### Catalog (code, `colloca/langcatalog.py`)

A static table of spaCy 3.8 official pipelines: code, English name, package stem (`es_core_news`, `en_core_web`, …),
available sizes (sm|md|lg; `trf` excluded) and a suggested Tesseract code. Package names are only ever built from
catalog entries. The model version is a constant tied to the spaCy range pinned in `pyproject.toml` (3.8.0 today, as
in `docker/entrypoint.sh`). Excludes ja, ko, zh and `xx`.

### Model lifecycle (`nlp.py` + new `models.py`)

- `nlp.SUPPORTED` becomes a function of the registry (`nlp.languages()` → `{code: name}`); all users of `SUPPORTED`
  (main, backup, cli, importer, jobanalysis, align, candidates) read it from there.
- `load_model` picks the registry size first, then falls back to the other installed sizes (current behaviour).
  The in-memory model cache is evicted when a language's size changes or its model is uninstalled.
- **Install** runs in a background thread and reports state `installing | installed | failed(message)`; state lives in
  memory and is polled by the UI (the existing jobs machinery is per corpus and does not fit). It installs with `uv pip
  install --no-deps` when `uv` is on PATH, else `python -m pip install --no-deps`, from the fixed spacy-models release
  URL, or from `SPACY_WHEELS` offline with `--no-index --find-links`, exactly as the entrypoint does today. Target is
  `COLLOCA_MODELS_DIR` (Docker sets `/models`) or the active environment. The install goes to a temporary directory
  and is moved into place only on success, then `importlib.invalidate_caches()` makes it importable without restart.
- **Uninstall** removes the package directory and its `.dist-info`, and evicts the cache. Allowed always; if the
  language still has corpora the UI warns first, imports for that language then fail with the existing "no model"
  error, which now points to the Languages screen.
- `nlp.status()` is driven by the registry (and keeps feeding the status line).

### Language rules

- **Add**: pick from the catalog (languages already added are marked) and a size; the row is created and the install
  starts. A language can also be added without installing (model "not installed").
- **Edit**: display name, model size (reinstalls), OCR code. Code is read-only.
- **Remove**: refused while any corpus of that language exists, trashed ones included, naming how many. Otherwise
  deletes the row; the model stays installed unless the user uninstalls it (offered in the remove dialog).
- A language's base corpus is created, filled with the existing upload endpoints, and deleted from its row. The unique
  "one base corpus per language" index stays.

### Generic language check (`langcheck.py`)

Replaces the es/it word lists. For each configured language the stop-word list comes from
`spacy.lang.<code>.stop_words` (importable without the model). The distinctive words of a language are its stop words
minus those of the other configured languages. Thresholds and verdicts are unchanged, so es/it behave as before; the
"detected" language is the best-scoring *other* language. With a single configured language the check returns `ok`.

### OCR

`ocr.TESSERACT_LANGS` is replaced by the `tesseract` column of the registry (suggested from the catalog). Tesseract
language data is one `<code>.traineddata` file, readable from any folder via `--tessdata-dir`, so the app manages it
without root:

- **Install** downloads `<code>.traineddata` from the official `tessdata_fast` set (only codes that come from catalog
  entries) into `<models dir>/tessdata`, to a temporary file first and renamed on success. Offline: a folder of
  `.traineddata` files named by `TESSDATA_FILES`, like `SPACY_WHEELS`. **Remove** deletes that file.
- **Use**: when the language's data is in the app's folder, OCR passes `--tessdata-dir` with it; otherwise Tesseract's
  default folder is used, so the `spa` and `ita` data installed by `apt` keeps working. The "try every configured
  code" fallback (language unknown) only combines codes that live in the same folder.
- **Status** per language: Tesseract program present or not (found on PATH), and data present (app folder or default
  folder, from `tesseract --list-langs`). Without the program the OCR line says it needs a build with `WITH_OCR=1`.
- Adding a language offers "also install OCR data", ticked by default.

### API

- `GET /api/languages` keeps its shape (`{code: name}` of registered languages) so the pickers keep working.
- New: a management listing (per language: name, code, size, model name/version/state, corpus count, base corpus
  summary), `GET /api/language-catalog`, `POST /api/languages`, `PATCH /api/languages/{code}`,
  `DELETE /api/languages/{code}`, `POST /api/languages/{code}/model` (install / change size),
  `DELETE /api/languages/{code}/model`, and the same pair for `/ocr`. Exact names are the builder's call.
- `POST /api/corpora` and `/api/references` validate against the registry.
- Backup import with a language not in the registry fails with a message naming the language and saying to add it.

### Frontend

- New rail entry and screen *Languages*. One card per language: name and code, model line (name, version, size,
  state), an OCR line (engine, data), actions Install / Change size / Uninstall for each, Edit, Remove, and the base corpus block (what *Base corpora* has
  today). The base-corpora screen becomes a section of this one; its route redirects here.
- Add dialog: searchable catalog list and a size choice, with a note on disk size and on needing internet or
  `SPACY_WHEELS`.
- Install progress is polled and announced through the existing message/live region. Follow `docs/accessibility.md`.
  Strings in en/es/it locales.
- `ModelStatus` (status line) keeps working from the registry.

### Docker and docs

`docker/entrypoint.sh` stops hard-coding `es it`: `download-models` takes language codes as arguments (default: the
seeded es and it), the automatic download at start is removed because the app now installs from the UI. README
documents the screen, the offline route and `COLLOCA_MODELS_DIR`. The Dockerfile's apt Tesseract data stays spa/ita; other
languages come from the screen.

### Tests

pytest: registry CRUD and its rules (remove refused with corpora), catalog integrity, install state machine (spaCy and OCR data) with the
installer faked, `--tessdata-dir` selection, size fallback, generic language check including the unchanged es/it cases, backup with unknown
language. Vitest: Languages screen states (installing, failed, missing, remove refused). Playwright: add a language,
remove an empty one.

## Left to the builder

Exact route and function names; how the installer subprocess is mocked; the catalog's per-language size availability
(verify against spaCy's compatibility table when writing it); layout details of the cards.
