# Language Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A *Languages* screen where the user adds, edits and removes the languages they work with, and manages each language's spaCy model, Tesseract OCR data and base corpus.

**Architecture:** A `languages` table (migration v14, seeded with es and it) is the single source of the supported languages. A static catalog of spaCy's official pipelines limits what can be added and is the only source of package names and download URLs. Model and OCR-data installs run in background threads with in-memory state polled by the UI. `nlp.SUPPORTED` stays as a live read-only mapping over the registry, so most call sites do not change.

**Tech Stack:** Python 3.14, FastAPI, SQLite, spaCy 3.8, uv; Svelte 5 + Vite, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-language-management-design.md`

## Global Constraints

- Migrations are append-only: add v14, never edit v1–v13 (`db.py`).
- spaCy is pinned `>=3.7,<3.9`; the model version constant is `3.8.0`; sizes are `sm`, `md`, `lg` only (no `trf`).
- Package names, wheel URLs and `.traineddata` names are built only from catalog entries, never from request text. Language codes are validated against the catalog before use in any path or command.
- The Docker image runs as non-root user `colloca`; the app never calls `apt`. Models and OCR data go to `COLLOCA_MODELS_DIR` (Docker: `/models`) or, if unset, the active Python environment (models) / `<COLLOCA_DATA_DIR>/tessdata` (OCR data).
- Offline sources: `SPACY_WHEELS` (directory of wheels, existing) and `TESSDATA_FILES` (directory of `.traineddata`, new).
- A failed install must never leave a package or `.traineddata` that looks installed (install to a temp location, move on success).
- UI strings exist in `en.ts`, `es.ts`, `it.ts`; follow `docs/accessibility.md` (labelled controls, live-region announcements through `messages.say`).
- Checks: `uv run pytest`, `uv run ruff check .`, in `frontend/`: `npm test`, `npm run lint`, `npm run check`.
- `/api/languages` keeps returning `{code: name}`.

## Review Focus

- A language whose only corpora are in the Trash can not be removed (the corpora would be orphaned on restore).
- A model install that fails or is interrupted (no network, bad wheel) ends as `failed` with a message and no usable half-installed package; a second install click while one runs is refused.
- Uninstalling a model while corpora exist: the next import of that language fails with a clear message pointing to the Languages screen, and the in-memory model cache does not keep serving the removed model.
- A backup containing a corpus in an unregistered language rejects only that corpus, naming the language; the rest imports.
- The language check never rejects text because of an unconfigured language (`uncertain`, not `mismatch`), and with a single configured language it never rejects at all.
- Two languages with overlapping stop words (e.g. es/ca, es/pt) produce no mismatch for correct text.

---

### Task 1: Registry table and `languages` module

**Files:**
- Modify: `src/colloca/db.py` (append `_V14`, extend `MIGRATIONS`)
- Create: `src/colloca/languages.py`
- Modify: `src/colloca/nlp.py` (replace the `SUPPORTED` dict)
- Modify: `tests/test_migrations.py` only if it hard-codes the version number
- Test: `tests/test_languages.py`

**Interfaces:**
- Produces (`languages.py`):
  - `@dataclass(frozen=True) class Language: code: str; name: str; model_size: str | None; tesseract: str`
  - `class LanguageInUse(Exception)` with attribute `count: int`
  - `all_languages() -> list[Language]` (ordered by `added`, then code)
  - `get(code: str) -> Language | None`
  - `add(code: str, name: str, model_size: str | None, tesseract: str) -> Language` (raises `ValueError` if the code exists)
  - `update(code: str, *, name: str | None = None, model_size: str | None | type(UNSET) = UNSET, tesseract: str | None = None) -> Language` (module-level sentinel `UNSET`; `KeyError` if unknown)
  - `remove(code: str) -> None` (raises `LanguageInUse` when any row of `corpora` with that `lang` exists, **including rows with `deleted_at` set**; `KeyError` if unknown)
  - `corpus_count(code: str) -> int`
  - `class _Registry(Mapping[str, str])` and `REGISTRY: _Registry`; reads `{code: name}` from the database on every access.
- Produces (`nlp.py`): `SUPPORTED = languages.REGISTRY` (same name, so `nlp.SUPPORTED[code]`, `in`, iteration keep working).

- [ ] **Step 1: Write failing tests** in `tests/test_languages.py` (use `db.session()` and the `client` fixture from `conftest.py`): `test_seed_has_es_and_it` (`languages.get("es")` is `Language("es","Spanish",None,"spa")`, `it` → `"ita"`); `test_add_get_update_remove_roundtrip`; `test_remove_refused_with_live_corpus`; `test_remove_refused_when_only_trashed_corpus_exists` (insert a corpus with `deleted_at=CURRENT_TIMESTAMP`, assert `LanguageInUse` and `count == 1`); `test_registry_mapping_is_live` (`"xx" not in nlp.SUPPORTED`, add `xx`, then `nlp.SUPPORTED["xx"] == "Name"`; remove it again in a `finally`); `test_migration_v14_seeds_on_existing_database` (apply migrations up to 13 on an in-memory DB with a corpus row, then `db.migrate`, then rows exist).
- [ ] **Step 2: Run** `uv run pytest tests/test_languages.py -v`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `_V14`: `CREATE TABLE languages (code TEXT PRIMARY KEY, name TEXT NOT NULL, model_size TEXT, tesseract TEXT NOT NULL DEFAULT '', added TEXT DEFAULT CURRENT_TIMESTAMP);` plus two `INSERT`s for es/it (explicit `added` values so ordering is es, it). `model_size` NULL means "follow `SPACY_SIZE`". Write `languages.py` per the interface using `db.session()`.
- [ ] **Step 4: Run** `uv run pytest tests/test_languages.py tests/test_migrations.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: language registry (migration v14)`.

### Task 2: Catalog

**Files:**
- Create: `src/colloca/langcatalog.py`
- Test: `tests/test_langcatalog.py`

**Interfaces:**
- Produces:
  - `MODEL_VERSION = "3.8.0"`
  - `@dataclass(frozen=True) class Entry: code: str; name: str; stem: str; sizes: tuple[str, ...]; tesseract: str`
  - `CATALOG: dict[str, Entry]`
  - `package(code: str, size: str) -> str` → `"es_core_news_md"` (`ValueError` for unknown code or a size the entry lacks)
  - `wheel_url(code: str, size: str) -> str` → `https://github.com/explosion/spacy-models/releases/download/{pkg}-{MODEL_VERSION}/{pkg}-{MODEL_VERSION}-py3-none-any.whl`
  - `tessdata_url(tesseract: str) -> str` → `https://github.com/tesseract-ocr/tessdata_fast/raw/main/{tesseract}.traineddata`

Catalog content (name, stem, tesseract), all with sizes `("sm","md","lg")`: ca Catalan `ca_core_news` cat; da Danish `da_core_news` dan; de German `de_core_news` deu; el Greek `el_core_news` ell; en English `en_core_web` eng; es Spanish `es_core_news` spa; fi Finnish `fi_core_news` fin; fr French `fr_core_news` fra; hr Croatian `hr_core_news` hrv; it Italian `it_core_news` ita; lt Lithuanian `lt_core_news` lit; mk Macedonian `mk_core_news` mkd; nb Norwegian Bokmål `nb_core_news` nor; nl Dutch `nl_core_news` nld; pl Polish `pl_core_news` pol; pt Portuguese `pt_core_news` por; ro Romanian `ro_core_news` ron; sl Slovenian `sl_core_news` slv; sv Swedish `sv_core_news` swe. Deliberately left out: ja, ko, zh (not space-delimited), xx, and ru/uk (their lemmatizers need the extra package `pymorphy3`; revisit when extra dependencies are supported). Verify each package/size exists in spaCy 3.8's compatibility table (https://raw.githubusercontent.com/explosion/spacy-models/master/compatibility.json) when writing the table; drop any that do not.

- [ ] **Step 1: Failing tests**: `test_every_entry_has_stop_words` (`importlib.import_module(f"spacy.lang.{code}.stop_words")` works for each code; this is what the language check relies on); `test_package_and_urls` (es/md → `es_core_news_md`; exact wheel URL string; `tessdata_url("spa")`); `test_unknown_code_or_size_rejected`; `test_seed_languages_are_in_catalog`; `test_no_unsupported_scripts` (`ja`, `ko`, `zh`, `xx` not in `CATALOG`).
- [ ] **Step 2: Run** `uv run pytest tests/test_langcatalog.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the module with the table above.
- [ ] **Step 4: Run** the same tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: catalog of official spaCy pipelines`.

### Task 3: Generic language check

**Files:**
- Modify: `src/colloca/langcheck.py`
- Test: `tests/test_langcheck.py` (keep existing cases; add below)

**Interfaces:**
- Consumes: `languages.all_languages()`.
- Produces: `check(text: str, lang: str) -> dict` with the unchanged shape (`verdict`, `detected`, `scores` keyed by language code). Constants and thresholds unchanged.

- [ ] **Step 1: Add failing tests**: `test_single_configured_language_never_rejects` (monkeypatch `languages.all_languages` to return only es; Italian text → verdict `ok`, `detected is None`); `test_third_language_detected` (register `fr` via `languages.add`, French sentence against `es` → `mismatch`, `detected == "fr"`; remove `fr` in `finally`); `test_unconfigured_language_is_uncertain` (existing `EN_TEXT` vs es with es+it configured stays `uncertain`); `test_overlapping_stop_words_do_not_reject_correct_text` (register `pt` and `ca`; `ES_TEXT` vs `es` is `ok`).
- [ ] **Step 2: Run** `uv run pytest tests/test_langcheck.py -v`. Expected: new tests FAIL, old PASS.
- [ ] **Step 3: Implement**: stop sets come from `importlib.import_module(f"spacy.lang.{code}.stop_words").STOP_WORDS`; distinctive words of a language = its stop words minus the union of the *other configured* languages' stop words; cache keyed by the tuple of configured codes (`lru_cache` on a function taking that tuple). `other` = best-scoring other configured language. Language not configured or fewer than two configured → `{"verdict": "ok", "detected": None, "scores": {}}`.
- [ ] **Step 4: Run** `uv run pytest tests/test_langcheck.py tests/test_api.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: language check over the configured languages`.

### Task 4: Model manager and registry-driven `nlp`

**Files:**
- Create: `src/colloca/models.py`
- Modify: `src/colloca/nlp.py` (`load_model`, `status`, new `evict`)
- Test: `tests/test_models.py`

**Interfaces:**
- Consumes: `languages.get`, `langcatalog.package/wheel_url`.
- Produces (`models.py`):
  - `MODELS_DIR: Path | None` (from `COLLOCA_MODELS_DIR`, evaluated through `models_dir() -> Path | None` so tests can monkeypatch the env)
  - `install(code: str, size: str) -> None`: validates code/size against the catalog, raises `ValueError` for unknown, `models.Busy` if that language is already installing; otherwise starts a daemon thread and returns at once.
  - `state(code: str) -> dict` → `{"state": "idle" | "installing" | "failed", "message": str}`
  - `uninstall(code: str) -> None` (removes every installed size of that language's package, then `nlp.evict(code)`)
  - `installed(code: str) -> dict | None` → `{"name", "version", "size", "small"}` of the model `load_model` would use, else `None`
  - `_run_installer(argv: list[str]) -> None`: the one place a subprocess is started; tests monkeypatch it.
- Produces (`nlp.py`): `evict(lang: str) -> None`; `load_model` tries the registry size first (when not None), then `SPACY_SIZE`, `md`, `sm`, `lg`; its error message ends with "Install it in the Languages screen."; `status()` iterates `languages.all_languages()` and returns the same per-language dict as today.

- [ ] **Step 1: Failing tests** (monkeypatch `models._run_installer` to a fake, and `models.models_dir` to `tmp_path`): `test_install_runs_installer_then_reports_idle` (join the thread via a `models._threads[code]` handle, state `idle`); `test_failed_install_reports_message_and_leaves_nothing` (fake raises `RuntimeError("no network")`; state `failed` with the message; `tmp_path` is empty of package dirs); `test_second_install_while_running_is_busy` (fake blocks on a `threading.Event`); `test_unknown_code_or_size_is_rejected_without_running_installer`; `test_wheels_dir_uses_no_index` (with `SPACY_WHEELS` set to a tmp directory the argv contains `--no-index` and `--find-links`, and no URL); `test_install_argv_uses_catalog_url_only` (argv contains `langcatalog.wheel_url("es","sm")`); `test_uninstall_removes_package_and_evicts_cache` (create fake `es_core_news_sm` + `.dist-info` directories under `tmp_path`, seed `nlp._models["es"]`, call `uninstall`, assert dirs gone and `"es" not in nlp._models`); `test_load_model_prefers_registry_size` (monkeypatch `spacy.load` to record names; registry size `lg` → first attempted name `es_core_news_lg`).
- [ ] **Step 2: Run** `uv run pytest tests/test_models.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Install flow in the thread: create a temp directory inside `models_dir()` (or the system temp dir when unset), run `uv pip install --no-deps --target <tmp> <url>` (or `python -m pip install --no-deps --target <tmp>` when `uv` is not on PATH; wheels variant per the test); on success move the package directory and its `.dist-info` into `models_dir()`, replacing older ones; when `models_dir()` is `None`, skip `--target` and use `--python sys.executable` so it installs into the environment. Afterwards `sys.path` must contain `models_dir()` (insert if missing), `importlib.invalidate_caches()`, and `nlp.evict(code)`. Any exception sets state `failed` with `str(exc)`. State dict guarded by a lock.
- [ ] **Step 4: Run** `uv run pytest tests/test_models.py tests/test_offline_models.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: install and uninstall spaCy models from the app`.

### Task 5: OCR data manager and registry-driven OCR

**Files:**
- Create: `src/colloca/ocrdata.py`
- Modify: `src/colloca/ocr.py` (remove `TESSERACT_LANGS`; `_languages`, `ocr_pdf`, `HINT`)
- Test: `tests/test_ocrdata.py`; extend any existing OCR test file only if it references `TESSERACT_LANGS` (grep first)

**Interfaces:**
- Consumes: `languages`, `langcatalog.tessdata_url`, `models.models_dir`.
- Produces (`ocrdata.py`):
  - `data_dir() -> Path` → `models_dir()/"tessdata"` if set, else `COLLOCA_DATA_DIR/"tessdata"`
  - `install(code: str) -> None`, `state(code: str) -> dict`, `uninstall(code: str) -> None`: same semantics as `models` (catalog-validated, thread, `Busy`, temp file renamed on success, `TESSDATA_FILES` offline copy). `code` is the *language* code; the traineddata name comes from the language's registry `tesseract` value.
  - `engine_present() -> bool` (`shutil.which("tesseract")`)
  - `available(tesseract: str) -> bool` (data in `data_dir()` or listed by `tesseract --list-langs`)
  - `tessdata_args(codes: list[str]) -> list[str]`: `["--tessdata-dir", str(data_dir())]` only when every code has a file in `data_dir()`, else `[]`.
- `ocr._languages(exe, lang)` wanted codes come from `languages.get(lang).tesseract` (or all configured non-empty codes when `lang` is None/unknown/empty); availability uses `ocrdata`; the `tesseract` call appends `ocrdata.tessdata_args(wanted)`; the `--list-langs` call also passes it. `HINT` no longer lists `spa`/`ita` apt packages (it says to install the language data from the Languages screen).

- [ ] **Step 1: Failing tests**: `test_install_downloads_catalog_url_to_temp_then_renames` (monkeypatch the download function `ocrdata._fetch(url, dest)`; assert URL equals `tessdata_url("spa")` and final file `spa.traineddata` exists, no `*.part` left); `test_failed_download_leaves_no_file`; `test_tessdata_files_offline_copies_without_fetch`; `test_tessdata_args_only_when_all_codes_in_app_dir`; `test_ocr_uses_registry_code` (monkeypatch `subprocess.run` and `shutil.which`; for lang `it` the `-l` argument is `ita`; for a registered `fr` row with tesseract `fra` and the file in `data_dir()` the command contains `--tessdata-dir`); `test_missing_data_message_names_code_and_screen`.
- [ ] **Step 2: Run** `uv run pytest tests/test_ocrdata.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** per interfaces. `_fetch` uses `urllib.request.urlretrieve` on the fixed URL (same `noqa: S310` as `scripts/fetch_model_wheels.py`).
- [ ] **Step 4: Run** `uv run pytest tests/test_ocrdata.py tests/test_formats.py tests/test_pdftext.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: manage Tesseract language data from the app`.

### Task 6: API, validation call sites, CLI

**Files:**
- Modify: `src/colloca/main.py` (languages section near `@app.get("/api/languages")`, `/api/status`, corpus and reference validation), `src/colloca/backup.py` (lines ~282 and ~422), `src/colloca/cli.py`
- Test: `tests/test_language_api.py`, additions to `tests/test_backup.py`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces (all JSON; errors use `HTTPException`):
  - `GET /api/language-catalog` → `[{code, name, sizes, tesseract, added}]`
  - `GET /api/language-settings` → `[{code, name, model_size, tesseract, corpus_count, model: {name, version, size, small, state, message}, ocr: {engine, tesseract, available, state, message}}]` (`model.name` null when not installed)
  - `POST /api/languages` body `{code, size?: "sm"|"md"|"lg", name?: str, install_model?: bool = true, install_ocr?: bool = false}` → 201 `{code}`; 400 unknown code or size; 409 already added. `size` defaults to `SPACY_SIZE` or `md`.
  - `PATCH /api/languages/{code}` body `{name?, model_size?, tesseract?}` → `{ok: true}`; a changed `model_size` starts `models.install` with the new size (409 if busy); 404 unknown.
  - `DELETE /api/languages/{code}?uninstall_model=false` → 204; 409 with `"N corpora use this language"` when `LanguageInUse`; 404 unknown.
  - `POST /api/languages/{code}/model` body `{size?}` → 202; `DELETE /api/languages/{code}/model` → 204; same pair on `/ocr` (`POST` 202 / `DELETE` 204). Busy → 409.
- Existing: `GET /api/languages` unchanged; `POST /api/corpora` and `/api/references` already validate through `nlp.SUPPORTED`; error text stays. `GET /api/status` unchanged shape.
- `backup.py`: the unknown-language rejection message becomes `corpus “{name}”: language “{lang}” is not set up; add it in the Languages screen first`; only that corpus is rejected (the existing `rep.rejected += 1` flow).
- `cli.py`: call `db.init_db()` before building the parser so `choices=sorted(nlp.SUPPORTED)` reads the registry.

- [ ] **Step 1: Failing tests** (monkeypatch `models.install`/`ocrdata.install` to record calls; `client` fixture): `test_catalog_marks_added_languages`; `test_add_language_starts_model_install` (POST `fr`, size `sm` → 201, recorded call `("fr","sm")`, appears in `/api/languages`; cleanup removes it); `test_add_duplicate_is_409`; `test_add_unknown_code_is_400`; `test_patch_size_reinstalls`; `test_delete_with_corpus_is_409_and_with_none_is_204`; `test_delete_with_trashed_corpus_is_409`; `test_language_settings_lists_state_and_corpus_count`; `test_model_and_ocr_endpoints_busy_is_409`; `test_corpus_in_unregistered_language_is_400`; in `tests/test_backup.py`: `test_import_rejects_only_the_corpus_in_an_unregistered_language` (message contains `“xx”` and `Languages screen`).
- [ ] **Step 2: Run** `uv run pytest tests/test_language_api.py tests/test_backup.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the endpoints and call-site changes. Group the new routes in one clearly marked section of `main.py`.
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: all PASS (fix any test that assumed the language dict was static).
- [ ] **Step 5: Commit** `feat: language management API`.

### Task 7: Docker, entrypoint, docs

**Files:**
- Modify: `docker/entrypoint.sh`, `Dockerfile`, `docker-compose.yml`, `README.md`, `scripts/fetch_model_wheels.py`, `tests/test_offline_models.py`
- Test: existing `tests/test_offline_models.py` (adapt) plus `sh -n docker/entrypoint.sh`

**Interfaces:** `download-models [CODE...]` (default `es it`) is the only entrypoint command that downloads; the automatic download before `exec "$@"` is removed. `Dockerfile` sets `COLLOCA_MODELS_DIR=/models` (it already sets `PYTHONPATH=/models`). `scripts/fetch_model_wheels.py` gains `--langs es it ...` (default `es it`; validated against `langcatalog.CATALOG`) and keeps `wheel_urls(size, version, langs)` working as is.

- [ ] **Step 1: Adapt tests**: keep the two existing tests green; add `test_langs_option_limits_urls` (`--dry-run --langs fr` prints only `fr_core_news_…`).
- [ ] **Step 2: Run** `uv run pytest tests/test_offline_models.py -v`. Expected: new test FAIL.
- [ ] **Step 3: Implement** the script option and the entrypoint change; `sh -n docker/entrypoint.sh` must exit 0.
- [ ] **Step 4: README**: replace the "first start downloads the spaCy models" text with: models are installed from the Languages screen (es and it appear as "not installed" on a fresh volume); offline route (`SPACY_WHEELS`, `TESSDATA_FILES`); `COLLOCA_MODELS_DIR`; OCR data is managed per language and still needs `WITH_OCR=1` for the program; `download-models fr de` to prefetch. Update the language list statements ("Spanish and Italian") to "the languages you set up".
- [ ] **Step 5: Run** `uv run pytest -q && uv run ruff check .`. Expected: PASS. **Commit** `docs: language management in Docker and README`.

### Task 8: Frontend plumbing and base-corpus component

**Files:**
- Modify: `frontend/src/lib/router.svelte.ts`, `frontend/src/App.svelte`, `frontend/src/lib/ui/Rail.svelte`, `frontend/src/lib/types.ts`, `frontend/src/lib/locales/{types,en,es,it}.ts`
- Create: `frontend/src/lib/ui/BaseCorpusCard.svelte` (extracted from `frontend/src/screens/BaseCorpora.svelte`)
- Delete: `frontend/src/screens/BaseCorpora.svelte` (after the Languages screen replaces it in Task 9; until then keep it and only extract)
- Modify: `frontend/tests/BaseCorpora.test.ts` → `frontend/tests/BaseCorpusCard.test.ts`, `frontend/tests/router.test.ts`, `frontend/tests/Rail.test.ts`

**Interfaces:**
- Produces: route id `'languages'` (added to `ScreenId`/`SCREENS`; `'base'` removed, and `parse` maps the hash `#/base` to `languages`); rail item `{ id: 'languages', label: 'nav.languages' }` replacing `base` in group `nav.group.corpus`.
- Produces: `BaseCorpusCard.svelte` props `{ lang: string; name: string; reference: Corpus | null; force: boolean; onchange: () => void }`; it holds the create / upload / delete / job-progress behaviour that `BaseCorpora.svelte` has per card (copy that logic; the props replace the per-language `cards` derivation). `onchange` fires after create or delete so the parent reloads.
- Produces types in `types.ts`: `CatalogEntry {code,name,sizes,tesseract,added}`, `LanguageSetting` (mirrors `GET /api/language-settings`), `InstallState = 'idle'|'installing'|'failed'`.
- Produces locale keys (en/es/it): `nav.languages`, `lang.*` (title, intro, add, edit, remove, install, uninstall, changeSize, model, ocr, notInstalled, installing, failed, engineMissing, dataMissing, dataReady, removeBlocked, removeConfirm, addTitle, pickLanguage, size, alsoOcr, saved, removed), reusing the existing `base.*` keys inside the card.

- [ ] **Step 1: Failing tests**: router test `#/base` parses to `languages`; Rail test lists `Languages` and not `Base corpora`; `BaseCorpusCard.test.ts` is `BaseCorpora.test.ts` adapted to render the card for one language (same assertions: create button when `reference` is null; upload posts to `/api/corpora/{id}/upload`; delete asks for confirmation and calls `DELETE /api/corpora/{id}`).
- [ ] **Step 2: Run** `cd frontend && npm test -- router Rail BaseCorpusCard`. Expected: FAIL.
- [ ] **Step 3: Implement** the extraction and routing changes; temporarily render the card from a minimal `Languages.svelte` stub that lists `/api/languages` with one card each, so the app works between tasks.
- [ ] **Step 4: Run** `cd frontend && npm test && npm run lint && npm run check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): Languages route and base corpus card`.

### Task 9: Languages screen

**Files:**
- Modify: `frontend/src/screens/Languages.svelte` (replace the stub)
- Create: `frontend/src/screens/AddLanguageDialog.svelte`, `frontend/src/screens/EditLanguageDialog.svelte`
- Delete: `frontend/src/screens/BaseCorpora.svelte`, `frontend/tests/BaseCorpora.test.ts` if still present
- Modify: `frontend/src/lib/ui/CorpusSwitcher.svelte`, `frontend/src/lib/term.svelte.ts`, `frontend/src/screens/TermImport.svelte` (they fetch `/api/languages` once and cache it; they must refetch after a language change: export `languagesChanged()` from a small store in `frontend/src/lib/languages.svelte.ts` that bumps a counter they watch, or refetch on mount; pick the smaller diff)
- Test: `frontend/tests/Languages.test.ts`

**Interfaces:** Consumes `GET /api/language-settings`, `GET /api/language-catalog`, `/api/references` and the endpoints of Task 6. One card per language: heading with name and code; **Model** line (`name version (size)` or "not installed", state `installing`/`failed` with message) with buttons Install (when missing), Change size (select + apply), Uninstall; **OCR** line (engine present?, data available?, state) with Install data / Remove data, and a note "needs a build with WITH_OCR=1" when the engine is missing; Edit and Remove buttons; then `<BaseCorpusCard>`. While any `model.state` or `ocr.state` is `installing` the screen reloads settings every 2 s and stops when none is; changes are announced with `messages.say`. Remove: if `corpus_count > 0` the button is disabled with the count shown as its description; otherwise a confirm dialog with a checkbox "also uninstall the model". Add dialog: searchable list of catalog entries not yet added, size select (default `md`), checkbox "install the model" (ticked) and "install OCR data" (ticked, per the spec), a note on download size and on needing internet or `SPACY_WHEELS`/`TESSDATA_FILES`.

- [ ] **Step 1: Failing tests** in `Languages.test.ts` (stub `fetch` as `BaseCorpora.test.ts` does): `test_renders_one_card_per_language_with_model_state` (installed, missing, failed with message); `test_install_button_posts_model_and_starts_polling` (fake timers; second GET returns `idle`, polling stops); `test_remove_disabled_with_corpora_shows_count`; `test_remove_confirm_calls_delete_with_uninstall_flag`; `test_add_dialog_lists_only_catalog_entries_not_added_and_posts` (body `{code:"fr", size:"md", install_model:true, install_ocr:true}`); `test_edit_dialog_patches_name_size_ocr_code` (code field is read-only); `test_ocr_line_says_engine_missing`; `test_failed_install_is_announced` (`messages` contains the error).
- [ ] **Step 2: Run** `cd frontend && npm test -- Languages`. Expected: FAIL.
- [ ] **Step 3: Implement** the screen and dialogs; use `Dialog`, `Button`, `Select`, `Field`, `Toggle`, `Badge` from `lib/ui`; every control labelled; the installing state uses `<progress>` without a value (indeterminate) inside an `aria-live="polite"` region.
- [ ] **Step 4: Run** `cd frontend && npm test && npm run lint && npm run check`. Expected: PASS. Also `uv run pytest -q`.
- [ ] **Step 5: Commit** `feat(ui): Languages screen`.

### Task 10: End-to-end and final checks

**Files:**
- Create: `frontend/e2e/languages.spec.ts`
- Modify: `frontend/e2e/flows.spec.ts`, `frontend/e2e/language.spec.ts` if they navigate to `#/base`; `docs/backlog.md` if it lists this feature

- [ ] **Step 1: Write the e2e** (Playwright, same seed/teardown conventions as the other specs; the model install endpoint is stubbed with `page.route` so no download happens): the Languages screen lists Spanish and Italian; add French from the catalog and see it with state "installing" then "not installed"/"installed" per the stubbed responses; remove French (no corpora) and see it gone; remove Spanish is disabled when a Spanish corpus exists.
- [ ] **Step 2: Run** `cd frontend && npm run e2e`. Expected: PASS (fix any other spec that used the old Base corpora screen).
- [ ] **Step 3: Full verification**: `uv run pytest -q`, `uv run ruff check .`, `cd frontend && npm test && npm run lint && npm run check`, `sh -n docker/entrypoint.sh`. All must pass.
- [ ] **Step 4: Manual smoke** (`mise run dev` + `mise run ui:dev`): open Languages, add a language with the model install checked, watch the state change, import a short text in it, uninstall the model and see the import fail with the message that points to the Languages screen.
- [ ] **Step 5: Commit** `test: Languages end-to-end`.

---

## Self-review notes

- Spec coverage: registry and seed (T1), catalog and exclusions (T2), generic check (T3), model lifecycle and size fallback (T4), OCR data and OCR language (T5), API, backup, CLI (T6), Docker/entrypoint/README/offline (T7), Languages screen, base corpus block, route redirect, pickers refetch (T8–T9), tests across (T1–T10).
- Deviation from the spec, to confirm with the user: Russian and Ukrainian are left out of the catalog because their pipelines need the extra `pymorphy3` package.
- `nlp.SUPPORTED` stays a name (live mapping) instead of the spec's `nlp.languages()`, to avoid touching every call site; behaviour is the same.
