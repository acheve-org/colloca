# Colloca UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vanilla-JS interface with a Svelte 5 + TypeScript + Vite single-page app built on a small reusable component library, with the workbench layout (left rail, dense table, bottom detail strip), semantic colour tokens and CAT terminology.

**Architecture:** A `frontend/` Vite project builds into the static directory FastAPI already serves. Screens are thin compositions of components in `frontend/src/lib/ui/`; API calls and shared state live in `frontend/src/lib/`. The backend API is unchanged. The old UI stays untouched until the final cutover task, so the app keeps working on every commit.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite, Vitest + @testing-library/svelte (jsdom), Playwright, eslint + svelte-check, Node LTS pinned by mise, FastAPI/pytest for the backend fallback.

**Spec:** [`docs/superpowers/specs/2026-11-23-ui-redesign-design.md`](../specs/2026-11-23-ui-redesign-design.md). Also read [`docs/research/translator-ux.md`](../../research/translator-ux.md) section 3 (conventions) and [`docs/backlog.md`](../../backlog.md) T05, T09, T22, T28.

## Global Constraints

- Svelte 5 + TypeScript + Vite; **no UI kit, no CSS framework, no router library** (hash routing by hand).
- Source in `frontend/`; production output **git-ignored**; Docker gets a Node build stage; the runtime image has no Node.
- Backend API unchanged (additions only if a task states them; none are expected). Existing pytest suite must keep passing.
- Layout A: left rail grouped **Corpus / Explore / Terms / Job**, main table, bottom detail strip.
- Tokens: `--hit-query` (yellow, bold), `--hit-equiv` (green, dotted underline), `--hit-term` (blue, solid underline), `--hit-forbidden` (red, strikethrough), `--status-*` (label text). Colour is never the only cue. WCAG AA contrast in both themes.
- Compact density, row height about 28 px, 4 px spacing base. Desktop target >= 1100 px.
- Light/dark follows `prefers-color-scheme` with a manual override stored in `localStorage`.
- Terminology: Concordance, Collocations, N-grams, Keyness, Frequency list, Termbase, Term, Candidate, TB hit, Likely equivalent (marked "guess"), Aligned segment, Source / Target, Job. "Match" is reserved for segment match %; the lemma/form choice is labelled **Search by: lemma / exact form**.
- Interface strings come from an English catalogue (`frontend/src/lib/i18n.ts`, function `t(key)`) from the first screen on; no hard-coded visible strings in components.
- Current screen is a value in a store mirrored to the URL hash (`#/concordance?q=...`).
- All corpus text is rendered as text, never as HTML.
- Equivalents rail item only shows when the corpus has aligned texts (today's `tabEquiv` rule, via `/api/corpora/{id}/parallel`).
- No feature or export of the current UI may be missing at cutover (Task 13 holds the parity checklist).
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Failure modes the spec implies but no screen test would exercise by default; each is pinned by a test in the named task.

1. **Corpus text containing `<script>`, `<img onerror>` or `&amp;`** is displayed literally everywhere (Task 5, Task 7).
2. **Query with regex metacharacters or accents** (`c++`, `(a|b)`, `canción`, `Ñandú`) highlights the right span and never throws (Task 5).
3. **API error or zero hits** shows a message and keeps the previous toolbar state; it never blanks the screen (Task 3, Task 7).
4. **No corpus selected / switching corpus** shows an empty state instead of failing requests, and clears selection and stale results (Task 3, Task 7).
5. **Large result sets (2000 rows, the API maximum)** sort and filter without freezing, and keyboard navigation keeps the selected row in view (Task 4).

## File Structure

```
frontend/
  package.json, vite.config.ts, tsconfig.json, svelte.config.js, eslint.config.js, playwright.config.ts
  index.html
  src/
    main.ts                      mount App
    App.svelte                   AppShell + current screen
    lib/
      api.ts                     typed fetch client (get/post/patch/del, ApiError, qs)
      types.ts                   API response types
      i18n.ts                    t(key) catalogue (en)
      router.svelte.ts           hash route store
      corpus.svelte.ts           corpora list, current corpus, aligned flag, scope filter
      messages.svelte.ts         status line / toast store
      shortcuts.svelte.ts        shortcut registry
      theme.svelte.ts            light/dark/auto
      highlight.ts               range building and merging (pure)
      csv.ts                     csvUrl(path, params)
      ui/                        AppShell, Rail, CorpusSwitcher, Toolbar, Field, Select, Toggle, Button,
                                 Kbd, DataTable, Kwic, Highlight, DetailStrip, Badge, Dialog, StatusLine,
                                 ShortcutHelp, EmptyState
      styles/tokens.css, base.css
    screens/                     Concordance, Frequency, Collocations, Ngrams, Keyness, Equivalents,
                                 WordCloud, Termbase, Sources, BaseCorpora, Job (+ TermDialog, ScopeFilter)
  tests/                         vitest unit/component tests
  e2e/                           Playwright specs
tests/test_ui_fallback.py        backend fallback page test
```

---

### Task 1: Frontend scaffold, toolchain and backend fallback page

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/svelte.config.js`, `frontend/eslint.config.js`, `frontend/index.html`, `frontend/src/main.ts`, `frontend/src/App.svelte`, `frontend/tests/smoke.test.ts`
- Modify: `mise.toml`, `.gitignore`, `src/colloca/main.py:813` (static mount), `.github/workflows/ci.yml`
- Test: `tests/test_ui_fallback.py`, `frontend/tests/smoke.test.ts`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `test`, `lint`, `check`; mise tasks `ui:dev`, `ui:build`, `ui:test`, `ui:lint`; Vite dev server proxying `/api` to `http://127.0.0.1:8000`; build output to `frontend/dist` (switched to the static directory in Task 13); `main.py` helper `_static_app() -> StaticFiles | Callable` that serves the built UI when `static/index.html` exists, else a 503 page saying "UI not built, run `mise run ui:build`".

- [ ] **Step 1: Write the failing backend test** `tests/test_ui_fallback.py::test_root_explains_missing_ui` using monkeypatch to point `colloca.main.STATIC` at an empty tmp dir and asserting `GET /` returns 503 and the body contains `mise run ui:build`; and `test_root_serves_index_when_present` (index.html present returns 200).
- [ ] **Step 2: Run** `uv run pytest tests/test_ui_fallback.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the fallback in `main.py`: replace the unconditional `StaticFiles` mount with a route/mount that checks for `index.html` at request time (so tests can monkeypatch `STATIC`). API routes keep priority.
- [ ] **Step 4: Run** the new tests and the full suite `uv run pytest`. Expected: PASS.
- [ ] **Step 5: Scaffold the Vite project** (Svelte 5, TS, strict). `App.svelte` renders the text "Colloca". Add Vitest (jsdom, `@testing-library/svelte`), eslint (with `eslint-plugin-svelte`), `svelte-check`. Write `smoke.test.ts` asserting the app renders "Colloca"; run `npm test` and confirm it passes after being seen to fail first (before `App.svelte` has the text).
- [ ] **Step 6: Tooling wiring.** Add `node = "lts"` and the four `ui:*` tasks to `mise.toml`; add `frontend/node_modules/`, `frontend/dist/` to `.gitignore`; add a `frontend` job to CI (`npm ci`, `npm run lint`, `npm run check`, `npm test`, `npm run build`).
- [ ] **Step 7: Verify** `cd frontend && npm run lint && npm run check && npm test && npm run build`. Expected: all succeed.
- [ ] **Step 8: Commit** `feat(ui): scaffold Vite + Svelte frontend and UI-missing fallback`.

---

### Task 2: Design tokens, base styles and theme

**Files:**
- Create: `frontend/src/lib/styles/tokens.css`, `frontend/src/lib/styles/base.css`, `frontend/src/lib/theme.svelte.ts`, `frontend/tests/contrast.test.ts`, `frontend/tests/theme.test.ts`
- Modify: `frontend/src/main.ts` (import styles), `frontend/src/App.svelte`

**Interfaces:**
- Produces: CSS custom properties `--bg --surface --line --fg --muted --accent --danger`, spacing `--s-1..--s-6` (4 px steps), `--radius`, `--row-h: 28px`, font tokens, and the semantic tokens `--hit-query --hit-equiv --hit-term --hit-forbidden` (each with `-bg` and `-fg` variants) plus `--status-candidate --status-approved --status-forbidden`. Light is the default, `:root[data-theme="dark"]` the dark set, `@media (prefers-color-scheme: dark)` applies dark when `data-theme` is not set. Theme store: `theme.mode: "auto" | "light" | "dark"` (rune state), `setMode(mode)`, persisting to `localStorage["colloca.theme"]` and setting `document.documentElement.dataset.theme` (removed for auto).

- [ ] **Step 1: Write failing tests.** `theme.test.ts`: `setMode("dark")` sets `data-theme="dark"` and stores it; `setMode("auto")` removes the attribute; initial mode is read from storage. `contrast.test.ts`: parse `tokens.css`, and for every pair (`--hit-*-fg` on `--hit-*-bg`, `--fg` on `--bg`, `--muted` on `--surface`, `--accent` button text on accent) in both themes, assert contrast ratio >= 4.5 (write a small `contrast(hexA, hexB)` helper in the test).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** tokens, base styles (compact controls, focus ring, `Kbd` look, sticky table header basics) and the theme store. Choose colour values that satisfy the test; each hit token also defines its decoration (`--hit-query-deco: bold`, equiv dotted underline, term solid underline, forbidden line-through) as classes `.hit-query .hit-equiv .hit-term .hit-forbidden` in `base.css`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): design tokens, base styles and theme store`.

---

### Task 3: API client, stores, router, i18n

**Files:**
- Create: `frontend/src/lib/api.ts`, `types.ts`, `i18n.ts`, `router.svelte.ts`, `corpus.svelte.ts`, `messages.svelte.ts`, `csv.ts`, and tests `frontend/tests/api.test.ts`, `router.test.ts`, `corpus.test.ts`
- Modify: none

**Interfaces:**
- Produces:
  - `api.ts`: `class ApiError extends Error { status: number }`; `get<T>(path: string, params?: Record<string, unknown>): Promise<T>` (drops empty/null params, keeps `false`); `post<T>(path, body)`, `patch<T>`, `del(path)`; `upload(path, FormData)`. Error detail comes from `{detail}` (string, or JSON-stringified) falling back to `statusText`.
  - `csv.ts`: `csvUrl(path: string, params: Record<string, unknown>): string` adding `format=csv`.
  - `i18n.ts`: `t(key: string, vars?: Record<string, string | number>): string`; unknown keys return the key.
  - `router.svelte.ts`: `route` (rune state `{ screen: ScreenId; params: Record<string,string> }`), `go(screen, params?)`, parses/writes `location.hash` `#/screen?k=v`, reacts to `hashchange`. `ScreenId = "sources" | "base" | "concordance" | "collocations" | "ngrams" | "frequency" | "keyness" | "cloud" | "equivalents" | "termbase" | "job"`; unknown hash falls back to `sources`.
  - `corpus.svelte.ts`: `corpusStore` with `list`, `currentId: number | null`, `current`, `aligned: boolean`, `scope` (the document filter: `{tags, type, from, to, project}`), `reload()`, `select(id)`, `clearScope()`. `select` resets `scope`, reloads `aligned`, and emits a `corpus-changed` event screens use to clear results.
  - `messages.svelte.ts`: `messages.say(text, kind: "info" | "ok" | "err")`, `messages.clear()`, `messages.current`.

- [ ] **Step 1: Write failing tests**: `api.test.ts` (fetch mocked): params drop `""`/`null` but keep `false`; a 400 with `{detail:"x"}` rejects `ApiError("x", 400)`; a 422 with a list detail is JSON-stringified; 204 resolves `null`. `router.test.ts`: `#/concordance?q=a%20b` parses to screen `concordance`, params `{q:"a b"}`; `go()` updates the hash; bad hash falls back to `sources`. `corpus.test.ts`: selecting a corpus clears `scope`, sets `aligned` from the mocked `/parallel` response and fires `corpus-changed`; with no corpora `currentId` is `null`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules. Types in `types.ts` mirror what `app.js` reads from each endpoint (read `src/colloca/main.py` response shapes and `app.js` renderers; keep types minimal and only for fields used).
- [ ] **Step 4: Run** `npm test`, `npm run check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): API client, router, corpus and message stores, i18n catalogue`.

---

### Task 4: DataTable

**Files:**
- Create: `frontend/src/lib/ui/DataTable.svelte`, `frontend/tests/DataTable.test.ts`

**Interfaces:**
- Produces: `DataTable<Row>` props: `columns: Column<Row>[]`, `rows: Row[]`, `rowKey: (r: Row, i: number) => string | number`, `selected?: Row | null` (bindable), `filter?: string` (bindable), `sort?: { key: string; dir: "asc" | "desc" } | null` (bindable), `loading?: boolean`, `emptyText?: string`, `onactivate?: (r: Row) => void` (Enter / double-click), `onselect?: (r: Row | null) => void`, snippet slot `cell?: (row, col) => Snippet` for custom cells and `rowClass?: (row) => string`. `Column<Row> = { key: string; label: string; num?: boolean; width?: string; sortable?: boolean (default true); value?: (r: Row) => string | number; sortValue?: (r) => string | number }`.
  Behaviour: click header toggles asc, desc, none (numbers numerically, strings with `localeCompare` and `numeric: true`, accents folded); `filter` is a case- and accent-insensitive substring match over all column `value`s; Up/Down/Home/End/PageUp/PageDown move selection when the table has focus and scroll the row into view; Enter calls `onactivate`; `aria-sort` set on headers; `role="grid"`, selected row `aria-selected`.

- [ ] **Step 1: Write failing tests**: sorts numbers numerically (`[10,9,100]` asc -> 9,10,100); sorts strings accent-insensitively; third header click restores original order; filter `"canci"` matches "Canción"; ArrowDown/ArrowUp/Home/End change `selected` and call `onselect`; Enter calls `onactivate`; `aria-sort` toggles; empty rows renders `emptyText`; **2000 rows** with a filter and a sort render in under 500 ms (jsdom, generous bound) and keep working.
- [ ] **Step 2: Run** `npm test -- DataTable`. Expected: FAIL.
- [ ] **Step 3: Implement** `DataTable.svelte` with rune state, derived sorted+filtered rows, sticky header, `--row-h` rows, tabular numerals for `num` columns. Render all rows (virtualisation is T26, out of scope) but only derive once per change.
- [ ] **Step 4: Run** tests and `npm run check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): DataTable with sort, filter, selection and keyboard navigation`.

---

### Task 5: Highlight

**Files:**
- Create: `frontend/src/lib/highlight.ts`, `frontend/src/lib/ui/Highlight.svelte`, `frontend/tests/highlight.test.ts`, `frontend/tests/Highlight.test.ts`

**Interfaces:**
- Produces: `type HitKind = "query" | "equiv" | "term" | "forbidden"`; `type Range = { start: number; end: number; kind: HitKind }`; `findRanges(text: string, needles: string[], kind: HitKind, opts?: { caseSensitive?: boolean; accentInsensitive?: boolean }): Range[]` (literal match, not regex); `mergeRanges(ranges: Range[]): Range[]` (sorted, non-overlapping; on overlap the priority is forbidden > query > term > equiv); component `Highlight` props `{ text: string; ranges: Range[] }` rendering `<span class="hit-<kind>">` segments, text always as text nodes.

- [ ] **Step 1: Write failing tests**: `findRanges("El parque eólico", ["parque eólico"], "query")` -> `[{start:3,end:16,kind:"query"}]`; needles `["c++"]` and `["(a|b)"]` match literally and do not throw; `["cancion"]` with `accentInsensitive` matches "canción" with ranges indexed on the **original** string (also when the string contains combining characters); `["ñandú"]` case-insensitive matches "Ñandú"; empty needle yields no ranges; overlap priority per `mergeRanges`; component test: text `<img src=x onerror=alert(1)>` and `&amp;` appear literally (`textContent` equals input, no `img` element in the DOM) and ranges produce spans with the right class.
- [ ] **Step 2: Run** `npm test -- ighlight`. Expected: FAIL.
- [ ] **Step 3: Implement** both. For accent-insensitivity normalise with NFD while keeping an index map back to original offsets.
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): safe Highlight component with semantic hit ranges`.

---

### Task 6: Shell and shared UI components

**Files:**
- Create: `frontend/src/lib/ui/{AppShell,Rail,CorpusSwitcher,Toolbar,Field,Select,Toggle,Button,Kbd,DetailStrip,Badge,Dialog,StatusLine,ShortcutHelp,EmptyState}.svelte`, `frontend/src/lib/shortcuts.svelte.ts`, tests `frontend/tests/shortcuts.test.ts`, `Rail.test.ts`, `Dialog.test.ts`
- Modify: `frontend/src/App.svelte` (shell + screen outlet with placeholder screens)

**Interfaces:**
- Consumes: Task 3 `route`, `go`, `corpusStore`, `messages`, `t`; Task 2 theme store.
- Produces:
  - `shortcuts.svelte.ts`: `registerShortcut({ id: string; keys: string; label: string; scope?: "global" | "table"; when?: () => boolean; run: (e: KeyboardEvent) => void }): () => void` (returns unregister). `keys` syntax `"Mod+K"`, `"Mod+E"`, `"Escape"`, `"?"` where `Mod` is Ctrl on Windows/Linux and Cmd on macOS. Global shortcuts do not fire while typing in an input unless they use `Mod`, or are `Escape`. `listShortcuts()` for the help dialog. `formatKeys(keys): string` for `Kbd`.
  - `Rail` renders the groups in the spec (section 5.3) from a `NAV` constant `[{group, items:[{id: ScreenId, label key, visible?: () => boolean}]}]`; active item from `route`; Equivalents `visible` = `corpusStore.aligned`.
  - `CorpusSwitcher`: select + "New corpus" + "Delete" using `Dialog`; shows language and the active spaCy model name (Q1: read it from `/api/languages` response if present; otherwise show only language and note the gap in the commit message).
  - `Dialog` wraps native `<dialog>` with `open` bindable, `title`, `onclose`, footer snippet; Escape closes; focus returns to the opener.
  - `DetailStrip` slot container with `title` and `actions` snippets; `Badge` props `{ kind: "candidate" | "approved" | "forbidden" | "intb" | "neutral"; label }`; `StatusLine` shows `messages.current` (role="status"); `ShortcutHelp` opened by `?`; `EmptyState` props `{ title, hint? }`.
  - Global shortcuts registered by the shell: `Mod+K` -> `go("concordance")` and focus `#cc-query`; `?` -> help; `Escape` closes dialogs.

- [ ] **Step 1: Write failing tests**: shortcut registry (fires on `Mod+K`; suppressed when an `input` is focused for non-Mod keys; unregister works; `Escape` fires in an input); `Rail` marks the active route and hides Equivalents when `aligned` is false and shows it when true; `Dialog` opens, closes on Escape and restores focus.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the components and the shell grid per the spec diagram (rail 200 px, status line, content, detail strip area owned by each screen). Add the theme toggle (auto/light/dark) in the rail footer.
- [ ] **Step 4: Run** `npm test`, `npm run check`, `npm run lint`; start `npm run dev` with the API running (`mise run dev`) and check the shell renders with the corpus switcher loading real corpora. Expected: tests PASS, shell visible with no console errors.
- [ ] **Step 5: Commit** `feat(ui): app shell, rail, corpus switcher, dialog, shortcuts and shared controls`.

---

### Task 7: Concordance screen (showcase)

**Files:**
- Create: `frontend/src/screens/Concordance.svelte`, `frontend/src/lib/ui/Kwic.svelte`, `frontend/src/screens/TermDialog.svelte`, `frontend/src/screens/ScopeFilter.svelte`, `frontend/tests/Concordance.test.ts`, `Kwic.test.ts`
- Modify: `frontend/src/App.svelte` (route), `frontend/src/lib/i18n.ts`

**Interfaces:**
- Consumes: `get`/`csvUrl`, `corpusStore`, `route`, `DataTable`, `Highlight`, `DetailStrip`, `Badge`, `Dialog`, shortcuts.
- Produces:
  - `Kwic` props `{ lines: ConcLine[]; mode: "kwic" | "bilingual"; query: string; selected: ConcLine | null; onselect }`, built on `DataTable`. KWIC mode columns: `#`, Left (right-aligned), Node (`hit-query`), Right, Document. Bilingual mode (when "Source + target" is on) columns: `#`, Source segment (query highlighted), Target segment, Document. A `likelyEquiv?: string[]` prop highlights those strings in the target as `equiv` (labelled "guess"); Task 7 passes `[]` (T01 supplies data).
  - `ScopeFilter` (the document filter used by every analysis): tags, type, from, to, project; writes `corpusStore.scope`; used by all explore screens. It reproduces today's `#fTags/#fType/#fFrom/#fTo` plus project select and the scope summary line from `/api/corpora/{id}/scope`.
  - `TermDialog`: `openTerm({ source, pos?, origin?, target?, example? })` store function and dialog posting to `/api/terms` with today's fields (source, target, POS, status, domain, definition, notes, example, example source); success toast and closes.
  - `Concordance`: toolbar (query `#cc-query`, Search by lemma/exact form, Context width, Sort document/left/right, "Source + target" toggle shown only when `aligned`, Search button, "+ Term" button, CSV link), result strip (`N hits · M documents`, "Filter in results" input bound to `DataTable.filter`), table, detail strip showing for the selected row: document name (opens nothing yet; T06), full segment, aligned target, and actions `Add term` (**Mod+E**, uses the selected text or the node word) and CSV. Keyboard: Up/Down move through hits; Enter on a hit opens its detail; Mod+K focuses the query. Query and options persist in route params so reload restores them. Uses `/concordance` or `/bilingual` per mode (limit 300, as today).

- [ ] **Step 1: Write failing tests** (API mocked): searching calls `/api/corpora/1/concordance` with `q`, `unit`, `width`, `sort`, plus scope params; results render in order with the node highlighted; a hit containing `<script>alert(1)</script>` renders literal text and no `script` element; "Source + target" toggle is absent when not aligned and calls `/bilingual` when on; zero hits shows the empty state with the query; an API 400 shows the message in `StatusLine` and leaves the previous results and form values intact; no corpus selected shows `EmptyState` and makes no request; switching corpus clears results and selection; Mod+E on a selected row opens `TermDialog` prefilled with the node word and the segment as the example; Mod+K focuses the query input; query in route params is restored on mount.
- [ ] **Step 2: Run** `npm test -- Concordance Kwic`. Expected: FAIL.
- [ ] **Step 3: Implement** the files. Port field semantics from `index.html` `tab-concordance` and `app.js` concordance/term sections (`openTerm`, `findExamples`).
- [ ] **Step 4: Run** the full frontend tests, then run the real app: `mise run dev` plus `npm run dev`, upload a small text, search a word, select rows with arrows, press Ctrl/Cmd+E, check both themes. Expected: PASS; behaviour matches the old Concordance tab.
- [ ] **Step 5: Commit** `feat(ui): concordance screen with detail strip, highlighting and term capture`.
- [ ] **Step 6: Checkpoint with the user.** Show the screen (browser pane) and collect feedback before continuing; adjust tokens and density now, as every later screen inherits them.

---

### Task 8: Explore screens (Frequency, Collocations, N-grams, Keyness, Equivalents, Word cloud)

**Files:**
- Create: `frontend/src/screens/{Frequency,Collocations,Ngrams,Keyness,Equivalents,WordCloud}.svelte`, `frontend/src/lib/cloud.ts`, `frontend/tests/explore.test.ts`, `frontend/tests/cloud.test.ts`
- Modify: `frontend/src/App.svelte`, `frontend/src/lib/i18n.ts`

**Interfaces:**
- Consumes: `DataTable`, `Toolbar` controls, `ScopeFilter`, `csvUrl`, `go`, `openTerm`.
- Produces: one screen per old tab, each with its toolbar options exactly as in `index.html` (`tab-frequency`, `tab-collocations`, `tab-ngrams`, `tab-keyness`, `tab-equivalents`, `tab-cloud`), a `DataTable` with the same columns, a CSV link, and word cells that **go to Concordance** with the word as query (replacing the global `a.word` click handler): `go("concordance", { q, unit })`. Equivalents rows have a `+ Term` action opening `TermDialog` with the source, candidate target and an example. Keyness shows the reference-corpus select (from `/api/references`). `cloud.ts` exports `layoutCloud(items: {word: string; weight: number}[], w: number, h: number): Placed[]` (a pure port of `drawCloud`'s spiral layout from `app.js`) and `WordCloud` draws it on a canvas with "Save PNG".

- [ ] **Step 1: Write failing tests**: for each screen a table renders the mocked rows with correct request params (read each endpoint in `main.py`); clicking a word navigates to `#/concordance?q=<word>`; numeric columns sort numerically; `layoutCloud` returns placements inside the bounds with no overlaps for a 60-word input and the heaviest word is placed first.
- [ ] **Step 2: Run** `npm test -- explore cloud`. Expected: FAIL.
- [ ] **Step 3: Implement** the screens by composition (no per-screen table code beyond column definitions). Keep scope filter and Min freq/POS/stopword options identical to today.
- [ ] **Step 4: Run** tests, `npm run check`, and click through each screen against the running API. Expected: PASS and the same numbers as the old tabs for the same corpus.
- [ ] **Step 5: Commit** `feat(ui): frequency, collocations, n-grams, keyness, equivalents and word cloud screens`.

---

### Task 9: Termbase screen

**Files:**
- Create: `frontend/src/screens/Termbase.svelte`, `frontend/tests/Termbase.test.ts`
- Modify: `frontend/src/screens/TermDialog.svelte` (edit mode), `frontend/src/App.svelte`

**Interfaces:**
- Consumes: `/api/terms` GET/POST/PATCH/DELETE, `/api/terms/export`, `DataTable`, `Badge`, `TermDialog`, `Dialog`.
- Produces: `Termbase` with toolbar (status filter candidate/approved/forbidden/all, text search, project scope select as today in `syncTbScope`, Export menu for every format the old tab offers: TBX, TBX 2008, Excel, CSV, with the "approved only" choice), a sortable/filterable `DataTable` (columns source, target, POS, status `Badge`, domain, example, modified if present), a detail strip with the full entry and actions Edit / Approve / Mark forbidden / Delete (confirm). `TermDialog` gains `openTerm({ id, ...fields })` edit mode using PATCH.

- [ ] **Step 1: Write failing tests**: list loads with the status filter param; status badge shows the label text as well as colour; Approve calls PATCH with `{status:"approved"}` and updates the row; Delete asks for confirmation and calls DELETE; export links carry the chosen format and approved-only flag; table sorts by source accent-insensitively.
- [ ] **Step 2: Run** `npm test -- Termbase`. Expected: FAIL.
- [ ] **Step 3: Implement**, porting field names and export options from `index.html` `tab-terms` and `app.js` termbase section (read `export` params in `main.py:784`).
- [ ] **Step 4: Run** tests and check manually against the running API (add, edit, approve, delete, export TBX and open the download). Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): termbase screen on DataTable with edit, status actions and exports`.

---

### Task 10: Corpus screens: Sources, projects and Base corpora

**Files:**
- Create: `frontend/src/screens/Sources.svelte`, `frontend/src/screens/BaseCorpora.svelte`, `frontend/src/screens/ProjectsDialog.svelte`, `frontend/src/lib/jobs.svelte.ts`, `frontend/tests/Sources.test.ts`, `frontend/tests/jobs.test.ts`
- Modify: `frontend/src/App.svelte`, `frontend/src/lib/i18n.ts`

**Interfaces:**
- Consumes: `/api/preview-url`, `/api/corpora/{id}/documents` (GET/POST), `/upload`, `/upload-pairs`, `/api/documents/{id}` (GET/PATCH/DELETE), `/api/corpora/{id}/jobs`, `/api/jobs/{id}`, `/reannotate`, `/api/projects*`, `/api/references*`, `/api/corpora/{id}/facets`.
- Produces: `jobs.svelte.ts`: `watchJobs(corpusId: number, onDone: () => void): () => void` polling `/api/corpora/{id}/jobs` (stops on unmount or when none are running) and exposing `jobs.running` for a progress strip in `StatusLine`; `Sources` with three add-cards (URL fetch -> preview -> add; upload files, including aligned pairs via `upload-pairs` as today; paste text), the metadata applied to new documents (project, type, tags, date, as today's `#metadata` block), the documents `DataTable` (sortable/filterable, columns as today, row detail strip with edit metadata, delete with confirm, re-annotate), and a Projects dialog (list, create, rename, delete). `BaseCorpora`: list, add reference corpus (upload), progress via the same jobs watcher, delete.

- [ ] **Step 1: Write failing tests**: URL preview shows an editable title and text and "Add to corpus" posts them; uploading two files calls `/upload` once with both and then starts job polling; `watchJobs` stops polling when no jobs are running and calls `onDone` once when a job finishes; deleting a document asks for confirmation; editing metadata PATCHes only changed fields; document titles with HTML render as text; a failing upload shows the server's `detail` message.
- [ ] **Step 2: Run** `npm test -- Sources jobs`. Expected: FAIL.
- [ ] **Step 3: Implement**, porting behaviour from `index.html` `tab-sources`/`tab-base` and `app.js` sections "projects", "sources", "background jobs", "base (reference) corpora", "aligned texts".
- [ ] **Step 4: Run** tests and exercise the real flows (URL, DOCX upload, TMX pair upload, paste, re-annotate, reference corpus). Expected: PASS; imports finish and refresh the table.
- [ ] **Step 5: Commit** `feat(ui): sources, projects and base-corpora screens with job progress`.

---

### Task 11: Job screen

**Files:**
- Create: `frontend/src/screens/Job.svelte`, `frontend/tests/Job.test.ts`
- Modify: `frontend/src/App.svelte`

**Interfaces:**
- Consumes: `POST /api/corpora/{id}/analyse-job`, `GET /api/jobs/{id}`, `GET /api/jobs/{id}/result`, `DataTable`, `Highlight` (term hits as `term`, forbidden as `forbidden`), `Badge`.
- Produces: `Job` with the same inputs as today's Job tab (text or file, options) and a report built from `DataTable`s (coverage, gaps, key terms, termbase hits) following `renderJobReport` in `app.js` (read it first; keep every number and section, including `pct()` formatting), progress via polling, and a "Add as term" action on gap/key-term rows.

- [ ] **Step 1: Write failing tests**: submitting text posts to `analyse-job` and polls until done, then renders the report sections with the mocked numbers (`87%` style percentages); termbase hits in the shown text use `hit-term`, forbidden ones `hit-forbidden` with a line-through; a failed job shows the error and re-enables the button.
- [ ] **Step 2: Run** `npm test -- Job`. Expected: FAIL.
- [ ] **Step 3: Implement** the screen by porting `renderJobReport`.
- [ ] **Step 4: Run** tests and run a real job analysis. Expected: PASS, same figures as the old Job tab.
- [ ] **Step 5: Commit** `feat(ui): job analysis screen`.

---

### Task 12: Docker build stage and Playwright end-to-end tests

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/workflow.spec.ts`, `frontend/e2e/seed.txt`
- Modify: `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `mise.toml` (`ui:e2e`)

**Interfaces:**
- Produces: a Docker build stage `FROM node:lts-slim AS ui` that runs `npm ci && npm run build` in `frontend/` and a `COPY --from=ui` of the build output into `src/colloca/static/` in the Python image (the output path at this point is `frontend/dist`; Task 13 changes Vite's `outDir`). Playwright config starts `uv run uvicorn colloca.main:app` on a temp `COLLOCA_DATA_DIR` with `SPACY_SIZE=sm` and serves the built UI.

- [ ] **Step 1: Write the e2e spec** `workflow.spec.ts::translator workflow`: create a corpus (es), upload `seed.txt` (a short Spanish text containing "parque eólico" several times), wait for the document row, open Concordance via **Mod+K**, search `parque eólico`, assert hits with highlighted node, select the second hit with ArrowDown, press **Mod+E**, save the term, open Termbase and assert the term is listed, download the CSV from Concordance and assert the file has a header and rows. Second test: the page text contains no raw `<script>` from a document titled `<script>x</script>`.
- [ ] **Step 2: Run** `npx playwright test`. Expected: FAIL until the UI is served from `static/`; make the Playwright `webServer` copy `frontend/dist` into a temp static dir via the `COLLOCA_STATIC_DIR` environment variable, adding that override in `main.py` (default unchanged).
- [ ] **Step 3: Implement** the Dockerfile stage, `.dockerignore` entries (`frontend/node_modules`, `frontend/dist`), the CI e2e job (install browsers with `npx playwright install --with-deps chromium`), and the mise task.
- [ ] **Step 4: Verify** `npx playwright test` passes locally and `docker build .` succeeds, then `docker run` serves the new UI at `/`. Expected: PASS.
- [ ] **Step 5: Commit** `build(ui): Docker build stage and Playwright end-to-end tests`.

---

### Task 13: Cutover, parity check and documentation

**Files:**
- Delete: `src/colloca/static/index.html`, `app.js`, `style.css`
- Modify: `frontend/vite.config.ts` (`outDir: "../src/colloca/static"`, `emptyOutDir: true`), `.gitignore` (ignore `src/colloca/static/`), `Dockerfile` (copy path), `README.md`, `docs/backlog.md`, `docs/research/translator-ux.md` (status note), `.github/workflows/ci.yml`
- Create: `docs/superpowers/plans/parity-checklist.md` (kept as a record)

**Interfaces:** none new.

- [ ] **Step 1: Parity checklist.** Walk `git show main:src/colloca/static/index.html` section by section (every control and every link) and write one line each in `parity-checklist.md` with the new location. Any control without a new home is implemented in this task (add a failing test first) or listed as a deliberate removal approved by the user.
- [ ] **Step 2: Cut over.** Delete the three old files, switch `outDir`, update `.gitignore` and the Dockerfile copy path, run `npm run build` and confirm `src/colloca/static/index.html` exists and `git status` shows no built files.
- [ ] **Step 3: Verify everything** `uv run ruff check . && uv run pytest`, `cd frontend && npm run lint && npm run check && npm test && npx playwright test`. Expected: all PASS.
- [ ] **Step 4: Docs.** README: new "Frontend development" section (mise tasks, dev server, build), and screenshots-free description of the layout and shortcuts; backlog: mark T05 done, T28 partly done (browser tests, `app.js` split), T22 partly done (catalogue + colour tokens), update the M-groupings text if it names them; research doc: a short "Status" note under section 5.2 for gaps #12 and #13.
- [ ] **Step 5: Manual smoke** of both themes and a keyboard-only pass of Concordance (Mod+K, arrows, Mod+E, Escape, `?`). Expected: no console errors.
- [ ] **Step 6: Commit** `feat(ui): replace the legacy interface with the new frontend`.

---

## Self-review notes

- **Spec coverage:** shell and layout A (T6), tokens and contrast (T2), component library (T4-T6), concordance showcase (T7), remaining screens (T8-T11), toolchain/Docker/CI/fallback (T1, T12), cutover and docs (T13), tests per spec section 7 (T1-T13, e2e in T12), terminology (Global Constraints, applied in T6/T7 labels), hash routing (T3), manual theme override (T2), string catalogue (T3 and every screen).
- **Gaps recorded as calls:** the active spaCy model display (Q1) depends on whether `/api/languages` exposes it; T6 handles both outcomes without a backend change. The `COLLOCA_STATIC_DIR` override in T12 is the only backend addition besides the fallback page.
- **Type consistency:** `ScreenId`, `Range`/`HitKind`, `Column<Row>` and `openTerm` are defined once (T3, T5, T4, T7) and reused by name.
