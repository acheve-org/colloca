# Projects Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dedicated Projects page to create projects and corpora and pick the working corpus, with every working corpus in a project and the language › project › corpus context always visible.

**Architecture:** Backend: migration v15 creates a `General` project for project-less corpora and general-termbase rows; the API then requires a project on every working corpus and refuses to delete a non-empty project. Frontend: a new `projects` route and `Projects.svelte` screen replace `ProjectsDialog` and the rail's `CorpusSwitcher`; a `ContextBlock` in the rail and a `ContextBar` above the work area show the context; empty states walk a new user Languages → Projects → Sources.

**Tech Stack:** FastAPI + SQLite (`db.py` migrations), pytest; Svelte 5 + TypeScript, Vitest + Testing Library (`frontend/tests/`), Playwright (`frontend/e2e/`).

**Spec:** `docs/superpowers/specs/2026-11-24-projects-page-design.md`

## Global Constraints

- Base corpora (`is_reference=1`) have no project, ever; the API keeps refusing a project on them.
- Never edit a released migration; append `(15, _V15)` to `MIGRATIONS` in `src/colloca/db.py`.
- Interface strings: one key per string in `frontend/src/lib/locales/{en,es,it}.ts`, `{name}` placeholders, added to all three files.
- Copy style: sentence case, no terminal punctuation on labels, verb-first buttons.
- Project names are unique case-insensitively (existing 409 behaviour).
- Checks before each commit: `uv run ruff check .`, `uv run pytest`, and in `frontend/`: `npm run lint`, `npm run check`, `npm test`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- A database restored from an older backup (`backup.py:310`) or edited by hand can hold a working corpus with `project_id` NULL: the UI must still list it (under "No project") and let the user move it, not crash. Pinned in Task 5.
- A project whose only corpora are in the Trash: deleting it must still be refused (restoring would orphan them). Pinned in Task 2.
- `General` already exists as a name (any case) before the migration: reuse it, never fail on the unique name. Pinned in Task 1.
- Running the migration twice, or on a database with nothing to migrate, creates no `General`. Pinned in Task 1.
- Opening a corpus, then deleting its project's other corpora or the corpus itself: the working corpus falls back to another corpus or none, and the context shows the empty state. Pinned in Task 5.

---

### Task 1: Migration v15 — General project

**Files:**
- Modify: `src/colloca/db.py` (add `_V15`, append to `MIGRATIONS`)
- Test: `tests/test_migrations.py`

**Interfaces:**
- Produces: schema version 15. After migration no non-reference, non-trashed-or-trashed corpus, `terms` row or `term_rejections` row has `project_id NULL` (when any did, a project named `General` exists and owns them).

- [ ] **Step 1: Write the failing tests** in `tests/test_migrations.py`, using the existing `raw()` helper and migrating a v14 database (`db.migrate` stops at a given version? it does not: build the v14 state by running `MIGRATIONS` entries up to 14 manually via `conn.executescript`, then call `db.migrate`). Tests:
  - `test_v15_moves_projectless_corpora_and_general_termbase_into_general`: v14 db with one working corpus (project NULL), one reference corpus, one trashed working corpus (project NULL), one `terms` row and one `term_rejections` row with NULL project → after `migrate`: a project `General` exists; the three working/trashed/term rows point to it; the reference corpus still has NULL.
  - `test_v15_reuses_an_existing_general_project_case_insensitively`: v14 db with project `general` and a project-less corpus → exactly one project, the corpus belongs to it.
  - `test_v15_creates_nothing_when_nothing_is_unassigned`: v14 db whose only corpus already has a project, and a fresh database → `SELECT COUNT(*) FROM projects WHERE name='General'` is 0.
  - `test_v15_is_idempotent`: `migrate` twice leaves one `General`.
- [ ] **Step 2: Run** `uv run pytest tests/test_migrations.py -k v15 -v` → FAIL (version 14).
- [ ] **Step 3: Implement `_V15`** in `src/colloca/db.py`: a SQL script that inserts `General` into `projects` only if (a project-less non-reference corpus or a NULL-project `terms`/`term_rejections` row exists) and no project with that name (`COLLATE NOCASE`) exists, then `UPDATE`s `corpora` (where `is_reference=0 AND project_id IS NULL`), `terms` and `term_rejections` to the id of the project named `General` (`COLLATE NOCASE`). Update the stale comments on v5/v7 only by adding a v15 comment; do not edit released SQL.
- [ ] **Step 4: Run** `uv run pytest tests/test_migrations.py -v` → PASS.
- [ ] **Step 5: Commit** `git add src/colloca/db.py tests/test_migrations.py && git commit -m "feat: migration v15 assigns project-less data to a General project"`.

### Task 2: API — mandatory project and delete guard

**Files:**
- Modify: `src/colloca/main.py` (`CorpusIn`, `create_corpus`, `update_corpus`, `delete_project`, `list_projects`)
- Modify: `tests/test_api.py` (`make_corpus`), `tests/test_projects.py`, and every test that does `client.post("/api/corpora", ...)` without `project_id` (18 call sites; find with `grep -rn 'post("/api/corpora"' tests`)
- Test: `tests/test_projects.py`

**Interfaces:**
- Produces: `POST /api/corpora` body `project_id: int` (required): missing → 422, unknown → 404. `PATCH /api/corpora/{id}` with `project_id: null` → 400 `A corpus must belong to a project`. `DELETE /api/projects/{id}` → 409 `Project '<name>' still has <n> corpora. Move or delete them first.` while any corpus (trashed included) references it. `GET /api/projects` keeps `corpora` (count of non-reference, non-trashed) and gains `trashed` (count of trashed corpora).
- Produces (test helper): `tests/test_api.py::default_project(client) -> int` returns the id of a project named `Test project`, creating it on first use per run; `make_corpus(client, lang="es", name="t", project_id=None)` uses it when `project_id` is None.

- [ ] **Step 1: Write failing tests** in `tests/test_projects.py`: `test_corpus_requires_a_project` (422 without, 404 unknown, 201 with), `test_corpus_cannot_leave_its_project` (PATCH null → 400, message contains "project"), `test_reference_corpus_still_refuses_a_project`, `test_delete_project_refused_while_it_has_corpora` (409 with a live corpus; a corpus moved to the Trash by `DELETE /api/corpora/{id}` still blocks with 409 and the message names the count; 204 once the project has no corpus rows at all, e.g. after moving them to another project), `test_projects_list_reports_trashed_count`. Replace the existing test that expects deleting a project to keep its corpora.
- [ ] **Step 2: Run** `uv run pytest tests/test_projects.py -v` → FAIL.
- [ ] **Step 3: Implement** the API rules above in `main.py`: `CorpusIn.project_id: int` (required); in `update_corpus` reject `project_id is None` when it is in `model_fields_set`; in `delete_project` count `corpora` rows by `project_id` (no filters) and raise 409; extend the `list_projects` SQL with a trashed count. Keep the `_project()` 404 check.
- [ ] **Step 4: Update `make_corpus`/`default_project`** in `tests/test_api.py` and fix every other `POST /api/corpora` call site to send a project (use `default_project`). Raw SQL inserts that skip the API need no change.
- [ ] **Step 5: Run** `uv run pytest -q` → all PASS; `uv run ruff check .` clean.
- [ ] **Step 6: Commit** `feat: every working corpus belongs to a project; deleting a non-empty project is refused`.

### Task 3: Frontend foundation — route, nav, types, strings, working-context store

**Files:**
- Modify: `frontend/src/lib/router.svelte.ts` (add `'projects'` to `ScreenId` and `SCREENS`), `frontend/src/lib/ui/Rail.svelte` (`NAV`), `frontend/src/App.svelte` (`SCREEN_COMPONENTS`), `frontend/src/lib/types.ts` (`Project` gains `trashed: number`), `frontend/src/lib/projects.svelte.ts`, locales `en.ts`/`es.ts`/`it.ts`
- Create: `frontend/src/screens/Projects.svelte` (placeholder `<h1>` only, filled in Task 4)
- Test: `frontend/tests/router.test.ts`, `frontend/tests/Rail.test.ts`, `frontend/tests/projects.test.ts` (new)

**Interfaces:**
- Produces: `NAV` first group `nav.group.setup` ("Setup": Languages, Projects) followed by `nav.group.corpus` ("Corpus": Sources); link order in the rail is `Languages, Projects, Sources, Concordance, …`.
- Produces in `projects.svelte.ts`: remove `projectStore.filter` and `inProject`; `projectStore` is `$state<{ list: Project[] }>`; `reloadProjects(): Promise<void>` unchanged; `export function projectOf(c: Corpus | null): Project | null` (list lookup by `c.project_id`, null when none/unknown).
- Produces locale keys (en text in parentheses): `nav.projects` (Projects), `nav.group.setup` (Setup), `ctx.working` (Working in), `ctx.change` (Change), `ctx.noProject` (No project), `ctx.noCorpus` (No corpus selected), `ctx.label` (Working context), plus the `proj.*` keys Task 4 uses (defined there).

- [ ] **Step 1: Write failing tests**: `router.test.ts` — `#/projects` parses to screen `projects`; `Rail.test.ts` — update the link order expectation (Languages, Projects before Sources, and the rail no longer has Sources-group Languages); `projects.test.ts` — `projectOf` returns the matching project, null for `project_id: null` and for an unknown id.
- [ ] **Step 2: Run** `npm test -- router Rail projects` (in `frontend/`) → FAIL.
- [ ] **Step 3: Implement**: route, nav group, `SCREEN_COMPONENTS.projects`, `projectOf`, drop `filter`/`inProject` (also fix their two importers `Sources.svelte`, `Trash.svelte` — they only read `projectStore.list`, so only the imports of removed names change), `Project.trashed`, the locale keys in all three files (es/it translated).
- [ ] **Step 4: Run** `npm test && npm run check && npm run lint` → PASS (CorpusSwitcher still compiles only if you keep it until Task 5: temporarily keep `projectStore.filter` out of it by leaving the file untouched — it is deleted in Task 5; if `check` fails on it, stub the removed names locally and note it for Task 5).
- [ ] **Step 5: Commit** `feat(ui): projects route, Setup nav group and working-context helpers`.

### Task 4: Projects screen

**Files:**
- Modify: `frontend/src/screens/Projects.svelte`
- Create: `frontend/src/screens/NewCorpusDialog.svelte` (name, language select from `/api/languages`, project select, preselected to the selected project)
- Delete: `frontend/src/lib/ui/ProjectsDialog.svelte`, `frontend/tests/ProjectsDialog.test.ts`
- Test: `frontend/tests/Projects.test.ts` (new)

**Interfaces:**
- Consumes: `projectStore`, `reloadProjects`, `projectOf` (Task 3); `corpusStore.list|current|reload|select(id)` (existing); `get/post/patch/del` from `lib/api`; API from Task 2.
- Produces: screen with local state `selectedProjectId: number | null` (defaults to the working corpus's project, else the first project). Left pane: project list (name, corpus count, inline rename, Delete) and "New project" form. Right pane: table of the selected project's non-reference corpora — columns Corpus, Language, Documents, Words — with row actions `Open` (calls `corpusStore.select(id)`, row then shows a "Working" badge and no Open button), `Rename`, `Move` (select of other projects → `PATCH {project_id}`), `Delete` (existing confirm, `DELETE /api/corpora/{id}`). Header button `New corpus` opens `NewCorpusDialog`; after create the new corpus is opened. Deleting a project that has corpora or trashed corpora shows a dialog listing the count with a "Move corpora to…" select and a Delete button enabled once a target is chosen (moves each via PATCH, then deletes); the 409 message from the API is shown through `messages.say(..., 'err')` otherwise.
- Produces locale keys (add to all three files, replacing the obsolete `proj.intro`, `proj.confirmBody`, `corpus.project`, `corpus.allProjects`, `corpus.noProject`, `corpus.noProjectGroup`, `corpus.noneInProject`, `corpus.manageProjects`, `corpus.projectOfNew`): `proj.corporaOf` ("Corpora in {name}"), `proj.open` (Open), `proj.working` (Working), `proj.move` (Move), `proj.moveTo` (Move corpora to…), `proj.deleteHas` ("{name} still has {n} corpora. Choose where they go before deleting it."), `proj.colCorpus`, `proj.colLang`, `proj.colDocs`, `proj.colWords`. Reuse existing `corpus.new`, `corpus.name`, `corpus.language`, `corpus.create`, `corpus.confirmDelete`.

- [ ] **Step 1: Write failing tests** in `Projects.test.ts` (stub `fetch` like `CorpusSwitcher.test.ts` does): selecting a project shows only its corpora; `Open` calls `corpusStore.select` with that id and the row shows "Working"; `New corpus` posts `{name, lang, project_id}` with the selected project and opens the new corpus; `Move` sends `PATCH /api/corpora/{id}` with the new `project_id`; deleting a project with corpora requires picking a target, moves the corpora, then calls `DELETE /api/projects/{id}`; renaming a project posts `PATCH /api/projects/{id}`; a corpus with `project_id: null` is listed under a "No project" entry in the left list and offers `Move`.
- [ ] **Step 2: Run** `npm test -- Projects` → FAIL.
- [ ] **Step 3: Implement** the screen and `NewCorpusDialog` per the Interfaces block; follow `ProjectsDialog.svelte`/`CorpusSwitcher.svelte` for the rename, busy-guard and error-reporting idioms and for table styling use the existing `DataTable` only if it fits, otherwise a plain table with the project's tokens. Remove `ProjectsDialog` and its test.
- [ ] **Step 4: Run** `npm test && npm run check && npm run lint` → PASS.
- [ ] **Step 5: Commit** `feat(ui): Projects page for projects, corpora and the working corpus`.

### Task 5: Working context in the rail and above every screen

**Files:**
- Create: `frontend/src/lib/ui/ContextBlock.svelte` (rail), `frontend/src/lib/ui/ContextBar.svelte` (breadcrumb strip), `frontend/src/lib/context.svelte.ts`
- Modify: `frontend/src/lib/ui/Rail.svelte` (replace `<CorpusSwitcher />`), `frontend/src/lib/ui/AppShell.svelte` (render `<ContextBar />` above `<main>`)
- Delete: `frontend/src/lib/ui/CorpusSwitcher.svelte`, `frontend/tests/CorpusSwitcher.test.ts`
- Test: `frontend/tests/ContextBlock.test.ts`, `frontend/tests/ContextBar.test.ts`, `frontend/tests/context.test.ts` (new)

**Interfaces:**
- Produces in `context.svelte.ts`: `export interface WorkingContext { language: string; languageName: string; project: Project | null; corpus: Corpus }` and `export function workingContext(): WorkingContext | null` (reactive getter over `corpusStore.current`, `projectOf`, and a languages map loaded once from `/api/languages` into a `$state` `languageNames: Record<string,string>` exposed as `loadLanguageNames(): Promise<void>`; unknown language falls back to the code).
- `ContextBar`: `role="navigation"` labelled `ctx.label`; renders `ES › Project › Corpus` where the language and project parts are links to `#/languages` and `#/projects` and the corpus part is bold plain text; a corpus with no project shows "No project"; with no corpus shows `ctx.noCorpus`; hidden on the `projects` and `languages` screens (they are the places that change it).
- `ContextBlock` (rail): the corpus name, project name, a language badge, a `Change` link to `#/projects`, and a quick switch: a `<select aria-label="Corpus">` listing working corpora grouped by project (`<optgroup>` per project, plus "No project" group when any corpus lacks one); choosing one calls `corpusStore.select`. Reference corpora are never listed.

- [ ] **Step 1: Write failing tests**: `context.test.ts` — `workingContext()` null without a corpus, resolves language name and project, tolerates `project_id: null` and an unknown language code; `ContextBar.test.ts` — shows the three parts in order with links to `#/languages` and `#/projects`, shows "No project" for a project-less corpus, shows "No corpus selected", is absent on the `projects` and `languages` routes; `ContextBlock.test.ts` — quick switch lists corpora grouped by project and selecting one calls `corpusStore.select(id)`; after `corpusStore.select(null)` (the current corpus was deleted) the block shows the empty state.
- [ ] **Step 2: Run** `npm test -- context Context` → FAIL.
- [ ] **Step 3: Implement** the three files and the Rail/AppShell wiring; call `loadLanguageNames()` and `reloadProjects()` from `Rail.svelte`'s `onMount` (where `CorpusSwitcher` did). Delete `CorpusSwitcher` and its test; keep the `corpusStore.reload` fallback behaviour unchanged.
- [ ] **Step 4: Update `Rail.test.ts`** for the new rail contents (no project filter, no New/Delete buttons) and run `npm test && npm run check && npm run lint` → PASS.
- [ ] **Step 5: Commit** `feat(ui): language › project › corpus context in the rail and above every screen`.

### Task 6: First-run guidance

**Files:**
- Create: `frontend/src/lib/ui/SetupGate.svelte`
- Modify: `frontend/src/App.svelte` (wrap the screen outlet), `frontend/src/screens/Projects.svelte` (empty states), `frontend/src/lib/router.svelte.ts` only if needed for the initial redirect
- Test: `frontend/tests/SetupGate.test.ts` (new)

**Interfaces:**
- Produces: `SetupGate` renders, in place of the work screens (every screen except `languages`, `projects`, `trash`), an `EmptyState` when setup is unfinished, with the first unmet step: no languages (`GET /api/languages` empty) → "Add your first language" linking to `#/languages`; no project (`projectStore.list` empty after load) → "Start your first project" linking to `#/projects`; no working corpus → "Create a corpus" linking to `#/projects`. With a corpus selected it renders its children unchanged. While `projectStore` or `corpusStore` is still loading (`corpusStore.loaded` false, or projects not yet fetched) it renders nothing, to avoid flashing the empty state.
- `Projects.svelte` empty states: no projects → heading "Start your first project", one text field (placeholder "Contracts 2024") and a `Create project` button; selected project without corpora → "Create a corpus" with the `New corpus` button.
- Initial route: a fresh load on `#/` or no hash while setup is unfinished lands on `projects` (or `languages` when no language) instead of `sources`; deep links to other screens are not redirected, they show the gate.

- [ ] **Step 1: Write failing tests**: each of the three gate states shows its message and link; with a corpus, the child renders; nothing renders while loading; `languages`/`projects` routes are never gated.
- [ ] **Step 2: Run** `npm test -- SetupGate` → FAIL.
- [ ] **Step 3: Implement** the gate, the empty states, and the initial redirect (run once after the first load settles, only when the hash is empty).
- [ ] **Step 4: Run** `npm test && npm run check && npm run lint` → PASS.
- [ ] **Step 5: Commit** `feat(ui): first-run guidance from Languages to Projects to Sources`.

### Task 7: End-to-end specs

**Files:**
- Create: `frontend/e2e/helpers.ts` (`newCorpus(page, name, lang?)`: opens `#/projects`, creates a project if none is selected, creates the corpus via the dialog, waits for the Working badge), `frontend/e2e/projects.spec.ts`
- Modify: the eight specs that open the old rail dialog (`flows`, `virtual`, `reports`, `dispersion`, `keyboard`, `workflow`, `languages`, `language`) to use `newCorpus` from `helpers.ts`; `languages.spec.ts` also asserts the new-corpus language options on the Projects page and creates its corpus through `request.post('/api/corpora', { data: { ..., project_id } })` with a project from `request.post('/api/projects')`

**Interfaces:**
- Consumes: Projects page labels from Task 4 (`New corpus`, `New project`, `Open`, `Working`), context bar from Task 5 (`navigation` named "Working context").
- Produces: `projects.spec.ts` tests: *first run* (empty database state is not available per test, so assert via API-created fresh project): create a project and a corpus through the UI, the context bar on Sources reads the language, project and corpus names; *switching*: two corpora in two projects, `Open` the other one on the Projects page and the context bar changes; *quick switch* from the rail changes corpus; *delete guard*: deleting a project with a corpus offers "Move corpora to…".

- [ ] **Step 1: Write `helpers.ts` and `projects.spec.ts`**, then convert the eight specs.
- [ ] **Step 2: Run** `cd frontend && npm run e2e` → all PASS (chromium must be installed: `npx playwright install chromium`).
- [ ] **Step 3: Commit** `test(e2e): projects page, context bar and updated corpus creation`.

### Task 8: Documentation

**Files:**
- Modify: `docs/getting-started.md` (Workflow step 1 and the *Projects…* section: project is mandatory, deleting needs an empty project, base corpora have none), `docs/interface.md` (layout table: rail = context block and groups **Setup** (Languages, Projects) · **Corpus** (Sources) …; context bar), `docs/operations.md` (upgrade note: first start after this version creates a `General` project for corpora and general-termbase entries that had none), `docs/languages.md` (it says the Languages screen is under *Corpus*, if so), `README.md` only if it mentions the switcher

- [ ] **Step 1: Edit the docs**; grep `docs README.md` for "switcher", "project filter", "Languages screen" and fix stale mentions.
- [ ] **Step 2: Run** `uv run pytest -q`, `uv run ruff check .`, and in `frontend/` `npm test`, `npm run check`, `npm run lint` → clean.
- [ ] **Step 3: Commit** `docs: projects page, mandatory projects and the General project`.

## Self-review

- **Spec coverage:** migration (T1); mandatory project, delete guard, `trashed` count (T2); route, Setup group (T3); two-pane page with create/rename/move/delete/open and project-less tolerance (T4); context in rail, bar above screens, quick switch (T5); first-run guidance and initial route (T6); e2e (T7); docs (T1–T8 notes in T8). `ProjectsDialog` and `CorpusSwitcher` are removed (T4, T5); `projectStore.filter` removed (T3).
- **Open calls for the implementer** (spec "left to builder"): visual styling, es/it copy, whether the working corpus survives reloads (keep today's behaviour: `corpusStore.reload` picks the first corpus), narrow-width layout.
- **Known follow-up, not in scope:** `POST /api/terms` and `POST /api/terms/import` still accept a NULL project (the "general termbase"); the spec only migrates existing rows.
