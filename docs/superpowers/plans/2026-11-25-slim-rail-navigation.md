# Slim Rail Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 200px grouped left rail with a 56px icon rail (one entry per area), a page header holding the corpus picker, and a tab strip for the screens of each area.

**Architecture:** A pure navigation model (`nav.ts`) maps the 18 existing screens to 5 areas and decides which tabs fit. The router remembers the last screen per area. New Svelte components (`Rail`, `RailMenu`, `CorpusPicker`, `PageHeader`, `TabStrip`) replace `Rail`'s old body and `ContextBlock`; `AppShell` lays them out. Routes, screens and shortcuts are untouched.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite, Vitest + Testing Library (`frontend/tests`), Playwright (`frontend/e2e`).

**Spec:** `docs/superpowers/specs/2026-11-25-slim-rail-navigation-design.md` (read it first; the interactive prototype it was approved from is in `.superpowers/brainstorm/22867-1795590664/content/navigation-b-interactive.html`, git-ignored, for reference only).

## Global Constraints

- All paths below are relative to `frontend/` unless they start with `docs/`. Run commands from `frontend/`.
- Rail is about 56px wide: each entry is an icon with a short text label under it, a tooltip, and an accessible name. No icon-only entries.
- Rail foot has ONE entry (label "Menu") opening a popover with Theme (Auto, Light, Dark), interface language (EN, ES, IT) and Log out only when `session.required`.
- Areas and tabs, in this order: Corpus [sources]; Explore [concordance, collocations, ngrams, frequency, dispersion, keyness, cloud, related, equivalents*, lookup*]; Terms [termbase, candidates, check]; Job [job]; Settings, at the bottom of the rail [languages, projects, trash]. (*only when `corpusStore.aligned`.) Settings tab order is Languages, Projects, Backup and Trash.
- Single-screen areas (Corpus, Job) show the page title and no tab strip.
- Clicking an area opens the screen last used in it, with its last search params (reuse `lastParams` behaviour of `screenHref`). Default per area is its first tab.
- Corpus picker: a button showing corpus name, language badge (and an "aligned" badge when `corpusStore.aligned`), project name beside it. Menu lists non-reference corpora grouped by project (corpora without a project under `t('ctx.noProject')`), the current one marked, and a "Manage projects…" entry going to `#/projects`. Selecting calls `corpusStore.select(id)`. The picker is hidden on `languages` and `projects`.
- Tabs that do not fit fold into a "More" menu at every width; the active tab is always shown.
- Routes, `ScreenId`, the `base` alias, keyboard shortcuts and the status line are unchanged. The rule that leaves a hidden Equivalents/Segment lookup screen for `concordance` stays.
- No visual refresh beyond Task 7 (softer light and dark themes): use existing tokens in `src/lib/styles/tokens.css`; add no colors. The contrast test (`tests/contrast.test.ts`) must still pass.
- Keep a `nav` landmark named `t('nav.label')` for the rail; the tab strip is `role="group"` named `t('nav.tabs')`. Keep the picker wrapped in `role="group"` named `t('ctx.working')` (e2e relies on it).
- Every new user-visible string goes into `src/lib/locales/en.ts`, `es.ts` and `it.ts`.

## Review Focus

- Working corpus gone, or no corpus yet (first run): the picker shows `No corpus selected`, the rail and tabs still work. (Task 3)
- Very long corpus or project names: the header does not overflow; the full name is in a `title`. (Task 3)
- Switching the interface language to ES/IT lengthens labels: tab overflow is recomputed and the active tab stays visible. (Tasks 2, 5)
- A deep link or reload on a screen that would fall in "More" (e.g. `#/lookup`, `#/cloud` on a narrow window): that tab is shown. (Task 2)
- Keyboard-only use: Esc closes the picker, More and Menu popovers and returns focus to their button; clicking outside closes them; every rail entry has an accessible name. (Tasks 2, 3, 4)

---

### Task 1: Navigation model and per-area memory in the router

**Files:**
- Create: `src/lib/nav.ts`
- Modify: `src/lib/router.svelte.ts` (add `lastScreen`, `areaHref`)
- Test: `tests/nav.test.ts` (new), `tests/router.test.ts` (extend)

**Interfaces:**
- Produces (`src/lib/nav.ts`):
  - `type AreaId = 'corpus' | 'explore' | 'terms' | 'job' | 'settings'`
  - `interface Area { id: AreaId; label: string /* i18n key, e.g. 'nav.group.explore' */; tabs: ScreenId[]; bottom?: boolean }`
  - `const AREAS: readonly Area[]` (order and tabs as in Global Constraints; the `bottom` flag on settings)
  - `const ALIGNED_ONLY: readonly ScreenId[]` = `['equivalents', 'lookup']`
  - `const NO_CORPUS_SCREENS: readonly ScreenId[]` = `['languages', 'projects']`
  - `areaOf(screen: ScreenId): AreaId`
  - `visibleTabs(area: AreaId, aligned: boolean): ScreenId[]`
  - `fitTabs(widths: number[], available: number, active: number, moreWidth: number): number[]` (added to this file in Task 2, not in this task)
- Produces (`router.svelte.ts`): `areaHref(area: AreaId): string` = `screenHref` of the area's last screen; the last screen of an area is updated on every route change and starts as the area's first tab (the initial route's area starts at the initial screen).
- `nav.ts` imports `ScreenId` as a type only (no runtime cycle with the router).

- [ ] **Step 1: Write failing tests in `tests/nav.test.ts`**
  - `every screen belongs to exactly one area`: flatten `AREAS.map(a => a.tabs)` equals `SCREENS` as a set with no duplicates (import `SCREENS` from the router).
  - `areaOf maps screens`: `areaOf('keyness') === 'explore'`, `areaOf('trash') === 'settings'`, `areaOf('sources') === 'corpus'`, `areaOf('job') === 'job'`.
  - `settings tabs are Languages, Projects, Backup and Trash`: `visibleTabs('settings', false)` equals `['languages', 'projects', 'trash']`.
  - `visibleTabs hides aligned-only tabs`: explore without alignment has 8 tabs and no `equivalents`/`lookup`; with `aligned = true` it has 10, ending with `equivalents`, `lookup`.
  - `settings is the bottom area`: only `AREAS.find(a => a.id === 'settings')?.bottom` is truthy.
- [ ] **Step 2: Extend `tests/router.test.ts`** with a `describe('areaHref')`: after `go('keyness')` then `go('termbase')`, `areaHref('explore')` is `'#/keyness'`; after `go('concordance', { q: 'x' })`, `areaHref('explore')` is `'#/concordance?q=x'`; `areaHref('settings')` is `'#/languages'` before any settings screen was visited; `areaHref('job')` is `'#/job'`.
- [ ] **Step 3: Run `npx vitest run tests/nav.test.ts tests/router.test.ts`.** Expected: FAIL (module/exports missing).
- [ ] **Step 4: Implement `src/lib/nav.ts` (all exports above except `fitTabs`) and `areaHref` in `router.svelte.ts`.** Track the area's last screen in a `$state` record updated inside `sync()`; reset-safe for tests (the router test file already re-imports the module per test).
- [ ] **Step 5: Run the same command.** Expected: PASS.
- [ ] **Step 6: Commit** `git add src/lib/nav.ts src/lib/router.svelte.ts tests/nav.test.ts tests/router.test.ts && git commit -m "Navigation model: areas, tabs and per-area last screen"`

### Task 2: Tab fitting and the TabStrip component

**Files:**
- Modify: `src/lib/nav.ts` (add `fitTabs`)
- Create: `src/lib/ui/TabStrip.svelte`
- Test: `tests/nav.test.ts` (extend), `tests/TabStrip.test.ts` (new)
- Modify: `src/lib/locales/{en,es,it}.ts` (`nav.tabs`, `nav.more`)

**Interfaces:**
- Consumes: `visibleTabs`, `AREAS`, `AreaId` (Task 1); `route`, `screenHref` from the router.
- Produces: `fitTabs(widths, available, active, moreWidth): number[]` returns the indices shown, ascending. If all widths fit in `available`, all indices. Otherwise reserve `moreWidth`, add tabs in order while they fit, and make sure `active` is shown (replace the last shown tab with it if it did not fit).
- Produces: `TabStrip.svelte` with props `{ area: AreaId }`. Renders nothing when the area has fewer than two visible tabs. Otherwise `<div role="group" aria-label={t('nav.tabs')}>` of links `<a href={screenHref(tab)} aria-current="page">` named `t('nav.' + tab)` plus, when something folds, a `More` button (`aria-expanded`, label from `nav.more`) opening a popover of links to the folded tabs. Widths are measured from a hidden, absolutely positioned copy of the tabs and re-measured on container resize (`ResizeObserver`) and when `locale.code` changes.
- i18n: `nav.tabs` = "Section screens" / "Pantallas de la sección" / "Schermate della sezione"; `nav.more` = "More" / "Más" / "Altro".

- [ ] **Step 1: Failing tests for `fitTabs` in `tests/nav.test.ts`**: `fitTabs([50,50,50], 200, 0, 40)` is `[0,1,2]`; `fitTabs([100,100,100,100], 250, 0, 50)` is `[0,1]`; with `active = 3` it is `[0,3]` (active kept visible, last shown replaced); `fitTabs([100,100,100], 50, 2, 40)` is `[2]` (nothing fits, still shows the active one); `active` already shown is not duplicated.
- [ ] **Step 2: Failing tests in `tests/TabStrip.test.ts`** (stub `ResizeObserver` and element widths in the test setup, or inject widths via `Object.defineProperty(HTMLElement.prototype, 'offsetWidth', …)`): renders the group named "Section screens" with the Explore tabs for `route.screen = 'concordance'`; renders nothing for `area="corpus"`; marks only the active tab with `aria-current="page"`; with a narrow container the folded tabs are not in the strip but are in the `More` popover, and the active tab (`go('cloud')`) is in the strip; `Escape` closes the popover and focus returns to the `More` button; a click outside closes it; changing the language (`setLang('es')`) re-measures (assert the resize handler ran, or that overflow is recomputed with longer fake widths).
- [ ] **Step 3: Run `npx vitest run tests/nav.test.ts tests/TabStrip.test.ts`.** Expected: FAIL.
- [ ] **Step 4: Implement `fitTabs` and `TabStrip.svelte`**; add the popover dismiss behaviour as a small shared Svelte action `dismiss(node, { close, trigger })` in `src/lib/ui/dismiss.ts` (outside click and Esc call `close`; Esc also focuses `trigger`). Tabs use the same visual language as the Toolbar links today (existing tokens only); the active tab gets a 2px bottom border in `--accent`.
- [ ] **Step 5: Run the same command.** Expected: PASS.
- [ ] **Step 6: Commit** `git commit -am "Tab strip with overflow into a More menu"` (add the new files first).

### Task 3: CorpusPicker (replaces ContextBlock)

**Files:**
- Create: `src/lib/ui/CorpusPicker.svelte`
- Delete: `src/lib/ui/ContextBlock.svelte`, `tests/ContextBlock.test.ts` (their cases move to the new test)
- Test: `tests/CorpusPicker.test.ts` (new; start from the fixtures in the old `ContextBlock.test.ts`)
- Modify: `src/lib/locales/{en,es,it}.ts` (`ctx.manage`; keep `ctx.working`, `ctx.noProject`, `ctx.noCorpus`; remove `ctx.change` once unused)

**Interfaces:**
- Consumes: `workingContext()` from `context.svelte.ts`; `corpusStore` (`list`, `currentId`, `aligned`, `select`); `projectStore.list`; `go`/`screenHref`.
- Produces: `CorpusPicker.svelte`, no props. Markup: `<div role="group" aria-label={t('ctx.working')}>` containing the trigger button (`aria-haspopup="true"`, `aria-expanded`), the project name beside it, and the popover. When there is no working corpus the trigger reads `t('ctx.noCorpus')` and the menu still offers "Manage projects…". i18n: `ctx.manage` = "Manage projects…" / "Gestionar proyectos…" / "Gestisci progetti…".

- [ ] **Step 1: Write failing tests in `tests/CorpusPicker.test.ts`** (fixtures: projects Acme/Bolt, corpora A1, A2, B1, Loose with no project, RefCorpus with `is_reference = 1`, `currentId = 1`):
  - `shows the corpus name, language code and its project`: trigger contains `A1` and `ES`; `Acme` is shown beside it.
  - `lists corpora grouped by project, without base corpora`: opening the menu shows group headings `Acme`, `Bolt`, `No project`; items `A1`, `A2`, `B1`, `Loose`; no `RefCorpus`; `A1` is marked current (`aria-current="true"`).
  - `choosing a corpus selects it and closes the menu`: click `B1` → `corpusStore.currentId === 3`, menu closed.
  - `Manage projects goes to Projects`: the entry is a link with `href="#/projects"`.
  - `shows an aligned badge only when the current corpus is aligned`: `corpusStore.aligned = true` → badge `aligned` visible on the trigger, absent in menu items.
  - `shows the empty state once the working corpus is gone` (Review Focus): `await corpusStore.select(null)` → text `No corpus selected`; menu still has `Manage projects…`.
  - `long names do not grow the header` (Review Focus): a 120-character corpus name → the trigger's name element has `title` equal to the full name and the class that truncates it (assert on the `title` and on `getComputedStyle(...).textOverflow === 'ellipsis'` if jsdom supports it, otherwise on the class).
  - `Escape closes the menu and focuses the trigger`; `a click outside closes it`.
- [ ] **Step 2: Run `npx vitest run tests/CorpusPicker.test.ts`.** Expected: FAIL (component missing).
- [ ] **Step 3: Implement `CorpusPicker.svelte`** using `dismiss` from Task 2. Truncate long names with CSS ellipsis and `title`. Then delete `ContextBlock.svelte` and `tests/ContextBlock.test.ts` (nothing else imports it after Task 4; delete it in Task 4's commit if `Rail.svelte` still imports it here).
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `git add -A src tests && git commit -m "Corpus picker: switch corpus from any screen"`

### Task 4: Slim Rail and RailMenu

**Files:**
- Rewrite: `src/lib/ui/Rail.svelte` (drop the exported `NAV`/`NavGroup`/`NavItem`; nothing else may import them, check with grep)
- Create: `src/lib/ui/RailMenu.svelte`, `src/lib/ui/NavIcon.svelte`
- Rewrite: `tests/Rail.test.ts`; Modify: `tests/auth.test.ts`, `tests/i18n.test.ts` (their Rail cases)
- Modify: `src/lib/locales/{en,es,it}.ts` (`nav.menu`, `nav.group.settings`; remove `nav.group.setup`, `nav.group.data` if unused; keep `nav.group.corpus|explore|terms|job` as the area labels)

**Interfaces:**
- Consumes: `AREAS`, `areaOf`, `NO_CORPUS_SCREENS` (Task 1); `areaHref`, `route`, `go`; `theme`/`setMode`; `LANGS`/`LANG_NAMES`/`setLang`/`locale`; `session`/`logout`; `dismiss` (Task 2).
- Produces:
  - `NavIcon.svelte` props `{ name: AreaId | 'menu' }`: inline SVG, `aria-hidden="true"`, `currentColor`, 20px, no dependency.
  - `RailMenu.svelte`: no props. Trigger button with visible label `t('nav.menu')`; popover with the Theme group (`role="group"` named `t('theme.label')`, three `aria-pressed` buttons), Language group (named `t('lang.label')`, buttons `EN`/`ES`/`IT` with `lang`, `title`, `aria-label` = language name, `aria-pressed`) and `Log out` only when `session.required`.
  - `Rail.svelte`: `<aside class="rail">` (56px) with the brand mark, `<nav aria-label={t('nav.label')}>` of area links (`<a href={areaHref(id)}>` containing `NavIcon`, the visible label `t(area.label)` and a tooltip via `title`; `aria-current="page"` on the active area), Settings pushed to the bottom (`margin-top: auto`), then `RailMenu`. It keeps the old mount effects: `loadSession()`, `reloadProjects()`, `loadLanguageNames()`, `ensureLanguageName()` effect, and the redirect that sends a hidden screen to `concordance` once `corpusStore.loaded`.
- Link names for tests: `Corpus`, `Explore`, `Terms`, `Job`, `Settings`.

- [ ] **Step 1: Rewrite `tests/Rail.test.ts`** with these cases (keep the old language-name reload, hidden-Equivalents redirect and `Equivalents redirect` cases, adapted):
  - `is a nav landmark with the five areas in order`: links are `Corpus, Explore, Terms, Job, Settings`, plus a `Menu` button; `Settings` is last link.
  - `marks only the active area with aria-current`: `route.screen = 'keyness'` → only `Explore`.
  - `an area links to its last used screen with its last search`: `go('concordance', { q: 'x' })`, `go('termbase')` → `Explore` href `#/concordance?q=x`, `Terms` href `#/termbase`; `Settings` href `#/languages` initially.
  - `every rail entry has an accessible name and a visible label` (Review Focus): each link and the Menu button has non-empty text content equal to its accessible name.
  - `redirects away from Equivalents` cases unchanged in behaviour (deep link kept while loading; redirect when loaded and not aligned; redirect after switching to a non-aligned corpus).
  - `does not keep reloading language names for a code the API lacks` (keep as is).
- [ ] **Step 2: Add `tests/RailMenu.test.ts`**: Menu is closed at first; opening shows Theme and Language groups; clicking `Dark` sets `document.documentElement.dataset.theme === 'dark'` and `aria-pressed`; no `Log out` unless `session.required`; `Escape` closes and focuses the Menu button; outside click closes. Update `tests/auth.test.ts` (open the Menu before looking for `Log out`) and the Rail cases in `tests/i18n.test.ts` (rail link names become the translated area labels; the EN/ES/IT switch is inside the opened Menu; the labels `Corpus`/`Explore`/… of `nav.group.*` are what change language).
- [ ] **Step 3: Run `npx vitest run tests/Rail.test.ts tests/RailMenu.test.ts tests/auth.test.ts tests/i18n.test.ts`.** Expected: FAIL.
- [ ] **Step 4: Implement `Rail.svelte`, `RailMenu.svelte`, `NavIcon.svelte`** (five area icons and a menu icon; stroke-style, as in the prototype). Keep focus outlines using `--rail-accent`. Delete `ContextBlock.svelte` and its test here if Task 3 did not.
- [ ] **Step 5: Re-run the command; also run `npx vitest run tests/i18n.test.ts` for the "no English left behind" check** (add `nav.menu` to its `SAME` list for Italian only if the value equals English). Expected: PASS.
- [ ] **Step 6: Commit** `git add -A src tests && git commit -m "Slim icon rail with a menu for theme, language and log out"`

### Task 5: PageHeader and AppShell layout

**Files:**
- Create: `src/lib/ui/PageHeader.svelte`
- Modify: `src/lib/ui/AppShell.svelte` (grid `56px minmax(0, 1fr)`; header between `StatusLine` and `main`)
- Test: `tests/PageHeader.test.ts` (new), `tests/smoke.test.ts` (check it still passes)

**Interfaces:**
- Consumes: `route`, `areaOf`, `NO_CORPUS_SCREENS`, `AREAS` (Task 1); `TabStrip` (Task 2); `CorpusPicker` (Task 3).
- Produces: `PageHeader.svelte`, no props. Top row: `CorpusPicker`, hidden when `route.screen` is in `NO_CORPUS_SCREENS`. Under it, a small area label (`t(area.label)`), the page title `<h1>` = `t('nav.' + route.screen)`, then `TabStrip` for the current area. There must be exactly one `h1` in the header; if a screen already renders an `h1`, downgrade that one to `h2` (grep `src/screens` for `<h1`).

- [ ] **Step 1: Write failing tests in `tests/PageHeader.test.ts`:** shows picker and `h1` `Concordance` with tabs on `#/concordance`; on `#/projects` and `#/languages` no picker, `h1` is `Projects`/`Languages` and the Settings tabs are shown in the order Languages, Projects, Backup and Trash; on `#/sources` (Corpus) and `#/job` there is an `h1` and no tab strip; with `corpusStore.aligned = true` the Explore tabs include `Equivalents` and `Segment lookup`; `h1` text follows `setLang('es')`.
- [ ] **Step 2: Run `npx vitest run tests/PageHeader.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement `PageHeader.svelte` and update `AppShell.svelte`.** Header has a bottom border in `--line` and `--bg` background; the content area keeps its current scroll behaviour (`main` still `overflow: auto`).
- [ ] **Step 4: Run `npx vitest run` (whole unit suite), then `npm run lint` and `npm run check`.** Expected: all PASS; fix any screen test that depended on the old rail or on a screen-level `h1`.
- [ ] **Step 5: Look at it:** run `uv run uvicorn colloca.main:app --port 8765` with `COLLOCA_DATA_DIR` set to a scratch directory and `npm run build` in `frontend/`, open `http://localhost:8765/#/concordance`, and check at 1280px, 800px and 390px wide that nothing clips, the active tab is visible, and `More` appears when tabs do not fit.
- [ ] **Step 6: Commit** `git add -A src tests && git commit -m "Page header with title, corpus picker and tabs"`

### Task 6: Migrate the Playwright tests

**Files:**
- Modify: `e2e/helpers.ts` (add helpers), and every spec that uses `getByRole('navigation')`: `e2e/{dispersion,flows,keyboard,language,languages,projects,reports,virtual,workflow}.spec.ts`; `e2e/helpers.ts` `newCorpus` (it clicks the `Sources` rail link)

**Interfaces:**
- Produces in `e2e/helpers.ts`:
  - `openScreen(page: Page, name: string): Promise<void>`: finds the area of the screen from a local table (display name → area label: Sources→Corpus; Concordance, Collocations, N-grams, Frequency list, Dispersion plot, Keyness, Word cloud, Related terms, Equivalents, Segment lookup→Explore; Termbase, Candidates, Check text→Terms; Job→Job; Languages, Projects, Backup and Trash→Settings), clicks that rail link, then, when the area has a tab strip, clicks the tab link `name` inside the group named `Section screens` (using the `More` button and its popover when the tab is folded).
  - `setInterfaceLanguage(page: Page, code: 'EN' | 'ES' | 'IT'): Promise<void>`: opens the rail `Menu` and clicks the language button.
- Specs that used `getByRole('navigation').getByRole('link', { name: X })` now call `openScreen(page, X)`; specs that pressed the EN/ES/IT or theme buttons or looked for `Change` now use the Menu / the corpus picker (`getByRole('group', { name: 'Working in' })` still names the picker).

- [ ] **Step 1: Add the helpers and migrate one spec (`e2e/dispersion.spec.ts`)**; run `npx playwright test e2e/dispersion.spec.ts` (needs `npm run build` first; `npx playwright install chromium` once). Expected: PASS.
- [ ] **Step 2: Migrate the other specs** (`grep -rn "getByRole('navigation')\|name: 'ES'\|name: 'Dark'\|'Change'" e2e`); update `e2e/projects.spec.ts` for the picker (the `Change` link is gone: "Manage projects…" in the picker menu replaces it).
- [ ] **Step 3: Add one e2e spec `e2e/navigation.spec.ts`:** at 1280px, clicking `Explore` then the `Keyness` tab, then `Terms`, then `Explore` returns to Keyness; the corpus picker switches corpus and the header shows the new name; at 390px wide the page has no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`) and the active tab is visible; `Settings` shows tabs in the order Languages, Projects, Backup and Trash.
- [ ] **Step 4: Run `npm run e2e`.** Expected: all PASS.
- [ ] **Step 5: Commit** `git add -A e2e && git commit -m "Playwright: navigate through the rail areas and tabs"`

### Task 7: Softer light and dark themes

The user finds the dark theme too black (page `#14171c`, panels `#1b1f26`) and the light theme too white (page `#ffffff`). This lightens the dark values to a slate and darkens the light background a little; every text pair below was checked at 4.5:1 or better (the tightest is 4.8:1, status colors on panels in the light theme).

**Files:**
- Modify: `src/lib/styles/tokens.css` (the light `:root` block, and BOTH the `:root[data-theme="dark"]` block and the `@media (prefers-color-scheme: dark) :root:not([data-theme])` block; `tests/contrast.test.ts` requires them to be identical)
- Test: `tests/contrast.test.ts` (existing, unchanged; it covers all pairs)

**Light theme values (only these three change; text, accent, danger, status and highlight colors stay):** `--bg #f0f2f5`, `--surface #e5e8ee`, `--line #c3c9d4`.

**Dark theme values (the rail tokens, which are the same in every theme, are not changed):**
`--bg #262d3b`, `--surface #2f374a`, `--line #434c5e`, `--fg #e8ebf0`, `--muted #aab4c6`, `--accent #7fb2ff`, `--accent-fg #0b1220`, `--danger #ff9a90`, `--hit-query-bg #5a4a12`, `--hit-query-fg #fbe38b`, `--hit-equiv-bg #1f4a2b`, `--hit-equiv-fg #a9e6b8`, `--hit-term-bg #1f3d63`, `--hit-term-fg #b9d6ff`, `--hit-forbidden-bg #5c2a25`, `--hit-forbidden-fg #ffc4bc`, `--status-candidate #f3c25c`, `--status-approved #7fd99a`, `--status-forbidden #ff9a90`.

- [ ] **Step 1: Update the light block and both dark blocks with the values above.**
- [ ] **Step 2: Run `npx vitest run tests/contrast.test.ts`.** Expected: PASS, including `prefers-color-scheme block mirrors the dark theme`.
- [ ] **Step 3: Look at it:** with the dev build, set Theme to Light and then Dark in the rail Menu and check that borders and the rail/page edge stay visible, then check Concordance (query highlight), Termbase (status colors) and the Candidates screen for readable text and visible borders.
- [ ] **Step 4: Commit** `git add src/lib/styles/tokens.css && git commit -m "Themes: softer light background, lighter slate dark theme"`

### Task 8: Documentation and final check

**Files:**
- Modify: `docs/interface.md` (Layout table and the first-run text), `docs/accessibility.md` (only if it names the old rail), `README.md` if it describes the rail

- [ ] **Step 1: Update `docs/interface.md`:** replace the "Left rail"/"Rail groups"/"Rail foot"/"Context bar" rows with: Icon rail (five areas, Settings at the bottom, Menu with theme, language, log out); Page header (corpus picker, title, tabs, More menu); keep the Work area, Status line, keyboard and language sections; state that an area opens the screen last used in it. Remove the claim about a corpus quick switch living in the rail (it is now the picker).
- [ ] **Step 2: Run the whole check:** `npm test`, `npm run lint`, `npm run check` (all in `frontend/`), then from the repo root `uv run pytest -q` and `uv run ruff check .`. Expected: all PASS.
- [ ] **Step 3: Commit** `git add -A docs README.md && git commit -m "Docs: describe the icon rail, page header and tabs"`
