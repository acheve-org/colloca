# Colloca UI redesign: design

Date: 2026-11-23. Status: draft for approval.
Inputs: [`docs/research/translator-ux.md`](../../research/translator-ux.md), [`docs/backlog.md`](../../backlog.md).

## 1. Intent and why

Colloca's interface is 595 lines of vanilla JavaScript that builds HTML from strings, one 65-line stylesheet, and a
top row of 11 tabs. It works, but the next backlog tasks (T01 to T06, T09, T10, T22) all need things it cannot carry
cheaply: one sortable, filterable table used everywhere, a master-detail concordance, a keyboard layer, semantic
colours and interface strings in three languages.

The goal is a clean, dense, translator-grade interface that uses the vocabulary and conventions of the CAT tools users
already know (memoQ, Phrase, OmegaT, Trados), built on reusable components so the backlog tasks become small additions
instead of rewrites.

## 2. Goals, non-goals, anti-goals

**Goals**
- A workbench shell with workflow-grouped navigation (layout A, chosen after mockups).
- A small component library and design tokens that every screen uses.
- The Concordance screen rebuilt as the showcase: source/target rows, query and likely-equivalent highlighting,
  detail strip, keyboard navigation.
- Every existing screen ported with no loss of function.
- CAT terminology throughout (Concordance, Termbase, TB hit, Candidates, match %).
- A foundation that makes T05, T09, T22 and T28 straightforward.

**Non-goals (this design)**
- New backend features. The API stays as it is; only additions the new screens strictly need are allowed, and each is
  listed in the plan.
- Implementing T01 (equivalent highlighting logic), T02 (candidate review) etc. as complete features. The components
  and slots for them are built; the features follow as backlog work.
- Interface translation to es/it (T22). The string catalogue is set up with English only; extraction comes with each
  screen so nothing is written twice.
- Mobile layouts. Desktop and laptop widths (>= 1100 px) are the target; narrower must remain usable but not polished.

**Anti-goals** (would make this a failure even if it works)
- Needing Node or a build at *runtime* or for users who only `docker compose up`.
- Losing a feature or an export that exists today.
- Colour as the only carrier of meaning.
- A look that is trendy rather than calm and dense.

## 3. Constraints

- Self-hosted, single FastAPI process serving static files; Docker image and `uv` + `mise` developer workflow.
- Python 3.14 project; the maintainer is Python-first, so tooling should be minimal and conventional.
- Existing tests (`tests/test_api.py`) must keep passing; CI (`.github/workflows/ci.yml`) is extended, not replaced.
- Data volumes: tables of up to a few thousand rows today (virtual scrolling is T26, deferred).

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | Vanilla web components, no build | No new tooling, but hand-written reactivity is exactly what hurts for tables and keyboard handling |
| B | Preact + htm, vendored, no build | Real components without Node; no types, little ecosystem, weak test story |
| **C** | **Vite + a component framework** | Best ecosystem, typed, testable; adds Node to build and a build step to the Docker image |

**Chosen: C** (by the user). Layout **A** (left rail + bottom detail strip) was chosen from mockups over a top-tabs +
right-inspector layout.

## 5. Decisions

### 5.1 Stack

Decisions made by the user: Vite-based SPA (C); layout A.

My calls (change if you disagree):
- **Svelte 5 + TypeScript + Vite.** Reason: components are close to plain HTML/CSS/JS, so a Python-first maintainer reads
  them easily; small bundle; compiled reactivity is a good fit for large tables. React would offer more ready-made
  widgets, but this app needs few (table, dialog, tabs, menu) and we build those ourselves to match CAT conventions.
- **No UI kit and no CSS framework.** Hand-written CSS custom properties (design tokens) and small components. Reason:
  full control of density and semantic colours; a kit would be fighting us on both.
- **No router library.** Screen = a value in a store, mirrored to the URL hash (`#/concordance?q=...`) so reload and
  back/forward work.
- **Vitest** for component/unit tests, **Playwright** for a few end-to-end flows against a real server (this delivers
  the "browser tests" part of T28).
- **Types for the API** hand-written in `frontend/src/lib/api.ts`; generating from FastAPI's OpenAPI schema is a later
  option, not part of this work.

### 5.2 Repository and build

- Source in `frontend/` (Vite project). Build output goes to `src/colloca/static/` (replacing today's three files) and is
  **git-ignored**.
- `mise` gains `node` (LTS) and tasks: `ui:dev` (Vite dev server proxying `/api` to uvicorn), `ui:build`, `ui:test`,
  `ui:e2e`. `mise run dev` keeps starting the API.
- Dockerfile gains a Node build stage that produces the static bundle and copies it into the Python image. The runtime
  image has no Node.
- Wheel/`uv` installs: the built bundle must be present in the package. CI builds the frontend before packaging;
  `main.py` serves a clear "UI not built, run `mise run ui:build`" page if `static/index.html` is missing, instead of a
  404.
- CI: add frontend lint (eslint + svelte-check), unit tests and the build; e2e job runs Playwright against the API.
- `.superpowers/` is added to `.gitignore` (mockup scratch).

### 5.3 Shell and navigation (layout A)

```
+-----------+--------------------------------------------------+
| Colloca   | [Corpus ▾]   status line / messages             |
| Corpus    +--------------------------------------------------+
|  Sources  | toolbar: query, options, actions                 |
|  Base c.  | result strip: counts, in-results filter, sort    |
| Explore   | main table (sortable, filterable, keyboardable)  |
|  Concord. |                                                  |
|  Colloc.  +--------------------------------------------------+
|  N-grams  | detail strip: selected row, metadata, actions    |
|  Freq.    +--------------------------------------------------+
|  Keyness  |
| Terms     |
|  Candid.  |  <- Candidates appears with T02; until then the
|  Termbase |     rail lists only existing screens
| Job       |
+-----------+
```

Mapping of today's tabs: Sources, Base corpora -> Corpus; Frequency, Concordance, Collocations, Equivalents, N-grams,
Keyness, Word cloud -> Explore; Termbase -> Terms; Job -> Job. Equivalents keeps its "only when the corpus has aligned
texts" visibility rule. The corpus selector, create and delete move into a corpus switcher at the top of the rail;
the active spaCy model is shown there too (Q1).

### 5.4 Design tokens

CSS custom properties, light and dark (existing `prefers-color-scheme` behaviour kept, plus a manual override stored in
`localStorage`).
- Neutrals, one accent, spacing scale (4 px base), radii, type scale, density (compact by default; row height ~28 px).
- **Semantic tokens**, each with a non-colour cue:

| Token | Meaning | Colour role | Non-colour cue |
|---|---|---|---|
| `--hit-query` | the searched word | yellow | bold |
| `--hit-equiv` | likely equivalent (statistical guess) | green | dotted underline |
| `--hit-term` | termbase hit | blue | solid underline |
| `--hit-forbidden` | forbidden term | red | strikethrough |
| `--status-*` | candidate / approved / forbidden | neutral / green / red | label text |

Contrast of text on every token background is checked against WCAG AA in both themes and documented in the tokens file.

### 5.5 Component library (`frontend/src/lib/ui/`)

| Component | Purpose / notes |
|---|---|
| `AppShell`, `Rail`, `CorpusSwitcher` | layout and navigation |
| `Toolbar`, `Field`, `Select`, `Toggle`, `Button`, `Kbd` | form controls with consistent density; `Kbd` shows shortcuts |
| `DataTable` | generic: typed columns, client-side sort, quick filter, row selection, keyboard row navigation (up/down, Home/End), numeric alignment, sticky header, CSV export hook, empty and loading states. The single table used by every screen (T05) |
| `Kwic` | concordance row renderer on top of `DataTable`: source/target modes, left/node/right alignment |
| `Highlight` | renders text with query, equivalent, term and forbidden spans from a list of ranges; the only place that knows the tokens |
| `DetailStrip` | the bottom pane for the selected row |
| `Badge` | status and "in termbase" chips |
| `Dialog` | modal on the native `<dialog>` |
| `Toast` / `StatusLine` | replaces the `#msg` line |
| `Shortcuts` | one registry: shortcut -> action, shown in tooltips and a help dialog; context-aware (table focus vs. input focus) |

Screens are thin compositions of these. Business logic (API calls, stores) lives in `frontend/src/lib/` and is not
inside components.

### 5.6 Screens and the migration order

1. Foundation: tokens, shell, `DataTable`, `Highlight`, `Toast`, `Dialog`, `Shortcuts`, API client, hash routing,
   corpus store, string catalogue (en).
2. Concordance (showcase): search options present in the API today, source+target view, query highlighting, detail
   strip, row navigation, "add term" from the selected row (existing "+ term" behaviour), CSV export. Slots and props
   for the likely-equivalent highlight are built; filling them with real data is T01.
3. Remaining Explore screens: Frequency, Collocations, N-grams, Keyness, Word cloud, Equivalents (all via `DataTable`).
4. Terms: Termbase on `DataTable` with the existing status filter, edit dialog, exports.
5. Corpus: Sources (URL fetch/preview, upload, paste, documents), Base corpora, projects and metadata.
6. Job screen.
7. Remove the old `index.html`/`app.js`/`style.css`; update the README and the research/backlog docs (T05, T28 and
   part of T22 marked as done).

Each step is shippable on its own **only once the whole old UI is replaced** (the two UIs are not mixed). The work
lands on one branch and is merged when step 7 is complete.

## 6. Terminology

The UI uses these labels (singular/plural as needed): Concordance, Collocations, N-grams, Keyness, Frequency list,
Termbase, Term, Candidate, TB hit, Likely equivalent (marked "guess"), Aligned segment, Source / Target, Job. "Match"
is reserved for the segment match percentage (T18); the concordance lemma/form choice is labelled "Search by: lemma /
exact form".

## 7. Testing and acceptance

- Existing pytest suite passes untouched.
- Vitest: `DataTable` (sort, filter, selection, keyboard), `Highlight` (range merging, escaping), shortcut registry.
- Playwright e2e on a seeded corpus: create corpus, upload a text, run concordance, select a row, add a term, export
  CSV. Runs in CI.
- No feature in the current UI is missing in the new one (checked screen by screen against the current `index.html`).
- Text content is always escaped (no HTML injection from corpus text), covered by a test.
- Both themes verified by eye and by the contrast check; keyboard-only operation of Concordance verified.

## 8. Risks

- **Toolchain creep**: Node enters the project. Mitigated by keeping it confined to `frontend/` and the Docker build
  stage, and by `mise` pinning the Node version.
- **Big-bang replacement**: all screens must be ported before merge. Mitigated by the migration order, where the
  showcase screen is built first and validated with the user.
- **Svelte 5 is newer than React**; fewer answers online. Accepted.

## 9. Left to the builder

Exact colour values and spacing numbers (within the token rules above), file layout inside `frontend/src/`,
Playwright browser choice, lint rule set, details of the Vite proxy config, the exact keyboard shortcut map beyond
those named in the research (Ctrl+K concordance, Ctrl+E add term, arrows, Esc), and the order of screens inside steps 3
and 5.
