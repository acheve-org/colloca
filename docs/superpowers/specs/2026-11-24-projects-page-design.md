# Projects page: selecting the project and corpus to work with

Status: draft for approval, 2026-11-24.

## Intent

A translator's first run has three steps: set up working languages and their base corpora (Languages page, exists), create a project and its corpora and choose the one to work in, then add sources and analyse. Today step two lives in a cramped rail widget (`CorpusSwitcher`: project filter, `…` dialog, corpus dropdown, New/Delete) and the working context is only a dropdown value like `Contracts [es]`. Give step two its own page, and make the working context unmistakable on every screen.

## Goals

- A **Projects** page: create, rename and delete projects; create, rename, move and delete corpora; pick the working corpus.
- Every working corpus belongs to a project (decided by the user). Context is always **language › project › corpus**.
- That context is visible on every screen, and its parts link to where they are changed.
- First run guides the translator Languages → Projects → Sources without a modal wizard.

## Non-goals

- No change to Languages, base corpora or analysis screens beyond the context display.
- No nested projects, no project sharing or permissions, no multi-corpus selection ("work with" stays one corpus).
- No redesign of the rail beyond the context block and the Setup group.

## Anti-goals

- Hiding or breaking the old way to switch corpus quickly: a switch must stay at most two clicks from any screen.
- Silent data loss or silent re-homing on project deletion.

## Constraints

- Svelte 5 frontend, hash router (`router.svelte.ts`), i18n in en/es/it (`locales/*`), e2e in `frontend/e2e`. FastAPI + SQLite backend (`db.py` migrations, `main.py`).
- Base corpora (`is_reference=1`) have no project and stay that way.
- Termbase (`terms`) and candidate stop list (`term_rejections`) use `project_id NULL` as "general"; `projects` already exist (v4).

## Approaches considered

1. **Dedicated page, two panes; rail shows read-only context** (chosen). Projects left, corpora of the selected project right, "Open" sets the working corpus. Rail context block shows `ES › Project › Corpus` with a Change link; a compact quick-switch menu stays on the block.
2. Full-screen first-run wizard plus the existing rail switcher. Rejected: wizards are awkward to revisit (adding a language or project later), and the context problem stays unsolved.
3. Keep the rail switcher, add a page only for managing. Rejected: two places to select a corpus, and the context stays a dropdown.

## Design

### Data and API (mandatory project)

- **Migration (new schema version):** if any working corpus has `project_id NULL`, or any `terms`/`term_rejections` row has `project_id NULL`, create a project named **General** (reuse an existing one of that name, case-insensitive), assign those corpora to it, and move the NULL-project terms and rejections to it. Fresh installs create nothing.
- `POST /api/corpora` requires `project_id` (422/400 otherwise); `PATCH` may move a corpus between projects but not clear it (`null` refused). Reference corpora are unchanged.
- `DELETE /api/projects/{id}` refuses (409, message names the count) while the project has corpora; trash-bin corpora count. The UI offers "move corpora to…" before delete rather than orphaning them.
- Translation-corpus creation already inherits the project; it keeps working.
- `GET /api/projects` already returns corpus counts; extend it with the languages present and document/word totals if cheap, else the page derives them from `/api/corpora`.

### Frontend

- New route `projects` (`ScreenId`, `SCREENS`, `SCREEN_COMPONENTS`, nav entry) and `screens/Projects.svelte`. `ProjectsDialog` is absorbed into it and removed.
- Nav: a **Setup** group (Languages, Projects) above the work groups; `languages` leaves the "Corpus" group.
- Page layout: left list of projects (with corpus count, inline rename, delete, `+ New project`); right table of the selected project's corpora (name, language, documents, words, `Open`, rename, move, delete, `+ New corpus` with language select limited to configured languages). The working corpus is marked.
- **Context block** replaces `CorpusSwitcher` in the rail: language, project, corpus name on separate lines, `Change` link to `#/projects`, and a small quick-switch (project then corpus) for fast moves. The block is also shown as a header strip on work screens so it is visible beside the content, not only in the rail (builder decides whether rail alone suffices at narrow widths).
- The project filter state (`projectStore.filter`) goes away; the project selection on the page is local view state, the working corpus is the shared state.
- **First run:** no languages configured → Sources/Projects show an empty state linking to Languages; languages but no project → Projects shows "Create your first project" with a suggested name; project but no corpus → "Create a corpus"; corpus with no sources → Sources empty state (exists). The app opens on the first unfinished step when nothing is selected.

### Docs and tests

- Update `docs/getting-started.md` (workflow), `docs/interface.md`, and mention the migration in `docs/operations.md`.
- Backend tests: migration (general termbase → General, idempotent, name clash), corpus create/patch validation, project delete guard. Frontend e2e: first-run path, switching corpus, context visible on a work screen; update existing specs that use the rail switcher.

## Left to the builder

Visual details, copy and translations (en/es/it), whether the quick-switch is a menu or popover, narrow-width behaviour, whether the working corpus is remembered across reloads (today: check `corpus.svelte.ts` and keep that behaviour), and the exact migration version number.

## Calls I made (check these)

1. Fresh installs have no default project; "default" means the migration's **General**, also preselected in New corpus when it is the only project.
2. NULL-project terms and rejections move into General, otherwise they would belong to no corpus.
3. Project deletion is refused while it has corpora, instead of re-homing them.
