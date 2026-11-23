# Parity checklist: legacy UI to new frontend

Date: 2026-11-23 (Task 13 of [`2026-11-23-ui-redesign.md`](2026-11-23-ui-redesign.md)). Kept as a record.

Source walked: `git show main:src/colloca/static/index.html` (section by section, every control and link) and
`main:src/colloca/static/app.js` (dynamic rows, per-row actions, export links, Enter handling, tooltips, messages).

**How verified**: *test* = a Vitest test in `frontend/tests/` (file and test name abbreviated), *e2e* =
`frontend/e2e/workflow.spec.ts`, *manual* = clicked through in the built app served by
`uv run uvicorn colloca.main:app` (temp `COLLOCA_DATA_DIR`, `SPACY_SIZE=sm`) on a seeded corpus: project "Acme Wind",
corpora "Eólica ES" (es, 4 docs, tagged), "Otro ES", "Eolica IT" (aligned partner from a TSV import), an es base corpus
and one approved term. Paths below are relative to `frontend/src/`.

## Header (corpus and project bar)

| Old control | New home | Verified |
|---|---|---|
| `h1` Colloca | Rail brand (`lib/ui/Rail.svelte`) | manual |
| Project select `#projSel` (All projects / each with count / No project) | Rail project filter (`lib/ui/CorpusSwitcher.svelte`) | test ProjectsDialog "narrows the corpora to the chosen project…"; manual (No project narrowed to "Otro ES") |
| *Projects…* button `#projBtn` | *…* button "Manage projects" next to the project filter | test ProjectsDialog "opens the projects dialog"; manual |
| Corpus select `#corpusSel` (grouped by project, "No project" group, `name [lang]`) | Rail corpus select, same grouping and labels | test ProjectsDialog "groups the corpora by project…", CorpusSwitcher "labels each corpus with its language code…" (**fixed in Task 13**: labels had lost `[lang]`); manual |
| *+ New* `#newCorpusBtn` | *New corpus* button | test CorpusSwitcher "creates with the trimmed name…"; manual (created "Prueba borrar") |
| *Delete* `#delCorpusBtn` with confirm | *Delete* + confirm dialog | test CorpusSwitcher; manual (deleted "Prueba borrar", fell back to the first corpus) |
| `#corpusInfo` "N docs · M words" / "No corpus yet" | Switcher meta line "Spanish · N docs · M words" / "No corpus yet" | test CorpusSwitcher "shows the language, document and word counts…" (**fixed in Task 13**: words were missing); manual |

## Dialogs

| Old control | New home | Verified |
|---|---|---|
| Projects dialog: list with name input, *Rename*, *Delete* (confirm), corpus count, new name + *Add*, *Close* | `lib/ui/ProjectsDialog.svelte` | tests ProjectsDialog (lists/creates/renames/deletes); manual |
| Document details dialog: Title, Tags (datalist), Text type (datalist), Date, Author, Cancel/Save | Sources "Document details" dialog (`screens/Sources.svelte`) | test Sources "editing metadata PATCHes only the changed fields"; manual (Enter on a selected row opens it) |
| Add term dialog: language line (+ "general termbase"), Source term, Translation, Status, POS, Domain (datalist), Definition, Notes, Example, source doc note, *Find examples*, clickable examples, Cancel/Save | `screens/TermDialog.svelte` + `lib/term.svelte.ts`; the example's document is an editable "Example source" field | tests Concordance "Mod+E … opens TermDialog prefilled", "saving the term posts…", Termbase "offers the distinct loaded domains…"; manual |
| Edit term (same dialog, *Find examples* usable) | Same dialog in edit mode; *Find examples* shown when the current corpus has the entry's source language | tests Termbase "Edit offers Find examples…", "Edit hides Find examples when…" (**fixed in Task 13**: it was hidden in edit mode); manual (picked an example, saved) |
| New corpus dialog: Name, Language, Project (defaults to filtered project) | CorpusSwitcher "New corpus" dialog | test ProjectsDialog "creates a corpus in the filtered project by default"; manual |

## Tabs and filter bar

| Old control | New home | Verified |
|---|---|---|
| Tab buttons (11) | Rail links grouped Corpus / Explore / Terms / Job (`lib/ui/Rail.svelte`), URL hash routing | test Rail "is a nav landmark with the spec groups in order"; manual |
| Equivalents tab hidden unless aligned | Rail item hidden unless aligned; a deep link leaves once loaded | tests Rail "hides Equivalents unless…", "Equivalents redirect"; manual (hidden on a non-aligned corpus) |
| Filter bar (tags + datalist, type select with counts, from, to, *Clear*, scope info "x of y documents · words"), hidden on Sources/Base/Termbase | `screens/ScopeFilter.svelte` on every Explore screen, Concordance and Job; not on Sources/Base/Termbase | test corpus "scopeParams maps to API names…"; manual (tag "energía": "2 of 4 documents · 54 of 112 words", concordance 6 → 3 hits, CSV link carries `tags=`) |
| `#msg` status line (ok/err) | `lib/ui/StatusLine.svelte` (`lib/messages.svelte.ts`) | tests (every screen's error tests); manual |

## Sources

| Old control | New home | Verified |
|---|---|---|
| Corpus name + Project + *Save* | Sources toolbar "Corpus settings" | test Sources "saves the corpus name and project" |
| Details for the next documents (Tags, Type, Date, Author, hint) | `<details>` with a summary of the set values | test Sources "imports aligned pairs … with the metadata"; manual |
| "import even if the language looks wrong" | Toggle, sent as `force_language` | test Sources (upload params) |
| Jobs list (last 8, progress, done/segments/warnings, errors) | Jobs list on Sources; jobs followed app-wide | tests Sources "a job keeps being followed after the screen unmounts…", jobs.test.ts; manual ("pairs.tsv done — 5 aligned segments", "Nota de prensa done") |
| Add from URL: input, *Fetch & preview*, Title, Text, word count, *Add to corpus*, *Discard*, hint | URL card (Enter submits) | test Sources "URL preview shows an editable title and text…" (not run live: needs network) |
| Import aligned texts: file, "Translations go to" (+ new corpus… with name), swap checkbox, *Import*, hint | Same card | tests Sources "imports aligned pairs…", "asks for a name when…" |
| Upload documents: files, *Upload*, accepted formats, rejected files message | Upload card | tests Sources "uploading two files…", "reports files the server rejected", "a failing upload…" |
| Paste text: title, text, *Add text* | Paste card | test Sources "pastes text with a default title"; manual |
| Documents table: Title (source tooltip, author), Type, Date, Tags badges, Words, Checks badges (wrong language / unclear / older model / aligned) | DataTable with the same columns + sort, filter, *Reload*, detail strip | test Sources "lists the documents with the old columns"; manual |
| Per-row *Edit* / *Remove* (confirm) | Detail strip *Edit details* / *Remove* (confirm dialog); Enter or double-click edits | tests Sources "deleting a document asks for confirmation", "cancelling…"; manual |
| Re-annotate box (count + button) | Strip "N documents annotated with an older NLP model" + *Re-annotate with current model* | test Sources "re-annotates outdated documents" |

## Explore screens

| Old control | New home | Verified |
|---|---|---|
| Frequency: Unit, POS, Min freq, hide stopwords, compare with base (tooltip), *Show*, CSV | `screens/Frequency.svelte` | tests explore "Frequency" (params, CSV, base column); manual (Base per M column) |
| Concordance: query (Enter), show translation (aligned only, tooltip), Match lemma/exact, Context, Sort, *Search*, *+ term* (tooltip), CSV, hits info "(showing n)" / "in aligned documents" | `screens/Concordance.svelte`, "Source + target" toggle, "Search by" | tests Concordance (search params, bilingual, empty, errors); e2e; manual (keyboard pass, Source + target) |
| Concordance results (left/node/right/doc with tooltip; aligned target line) | `lib/ui/Kwic.svelte` + detail strip (source/target segment, document) | test Concordance "renders results in order with the node highlighted…"; manual |
| Collocations: node (Enter), Left, Right, Min freq, POS, stopwords, base, *Find*, CSV, node info line | `screens/Collocations.svelte` (summary line) | tests explore "Collocations"; manual |
| N-grams: N, Unit, Min freq, Min docs, edge stopwords, *Show*, CSV | `screens/Ngrams.svelte` | tests explore "Ngrams"; manual |
| Keyness: Reference (base default, same-language corpora, "no base or other corpus"), Min freq, POS, *Compare*, CSV, help text | `screens/Keyness.svelte` (help as start hint and table note) | tests explore "Keyness"; manual |
| Word cloud: Source frequency/keyness, POS, Words, *Draw*, *Save PNG* | `screens/WordCloud.svelte` | tests explore "WordCloud", cloud.test.ts; manual (keyness cloud in dark theme) |
| Equivalents: query (Enter), Match, Min segments, POS, *Find*, CSV, info line, help | `screens/Equivalents.svelte` | tests explore "Equivalents"; manual |
| Word links in tables (click opens the concordance, unit of the table, phrases as exact form) | `lib/ui/WordLink.svelte` | tests explore "goes to the concordance when a word is clicked", "opens an n-gram … as an exact form"; manual (Frequency → "turbina" 6 hits) |
| *+ term* per row (Frequency, Collocations, N-grams, Keyness, Equivalents with source + target) | `+ Term` column in `screens/ExploreTable.svelte` | tests explore "opens the term dialog for a row", "+ Term opens the dialog with the source, the candidate target" |

## Job

| Old control | New home | Verified |
|---|---|---|
| Intro text, file, paste textarea, min times in text, well covered from (tooltips), force language, *Analyse*, progress | `screens/Job.svelte` | tests Job "posts the pasted text…", "sends a chosen file…", "shows queue and progress…"; manual |
| Stat tiles (words, different, covered, seen, gaps, termbase found) with tooltips; empty-corpus and uncertain-language notes | Same | tests Job "renders every stat tile…", "warns about an empty corpus…"; manual |
| Termbase terms table + CSV + glossary TBX/Excel/CSV | Same | test Job "renders the sections, their CSV links and the glossary links"; manual (all 7 links answer 200) |
| Gaps, Key terms (base columns when a reference exists), Repeated phrases, each with CSV, word links, *+ term* | Same (DataTables) | tests Job "omits glossary links…", "opens the Add term dialog from gap, key term and phrase rows…"; manual. **Fixed in Task 13**: a one-row known-terms table was hidden by its horizontal scrollbar |

## Termbase

| Old control | New home | Verified |
|---|---|---|
| Termbase of (all / No project / projects; follows the corpus until picked), Status, search (debounced) , count | `screens/Termbase.svelte` toolbar + count strip | tests Termbase "loads the list scoped to the corpus project…", "searches the text with q and keeps a pinned scope…", "follows the corpus project…" |
| Export: include candidates (tooltip), TBX (ISO 2019), TBX 2008 (tooltip), Excel, CSV | Export bar | test Termbase "export links carry the format, the project and the approved-only flag"; manual (all four answer 200 with the right type) |
| Help text | Empty-state hint | test Termbase "shows an empty state when there are no entries" |
| Table: Source (+ langs · project), Translation (— when empty), POS, Status badge, Domain, Example (source tooltip) | DataTable + Modified column, detail strip | tests Termbase "shows the status label next to the colour", "sorts by source…"; manual |
| Per-row *Edit* / *Delete* (confirm) | Detail strip *Edit* / *Approve* / *Mark forbidden* / *Delete* (confirm); Enter edits | tests Termbase "Edit opens the dialog prefilled…", "Delete asks for confirmation…", "Approve PATCHes…" |

## Base corpora

| Old control | New home | Verified |
|---|---|---|
| Intro, force language checkbox | `screens/BaseCorpora.svelte` | manual |
| Per language card: "No base corpus yet" + *Create … base corpus*; or name, parts · words, file input, *Upload sentence files*, *Delete* (confirm), job list | Same cards | tests BaseCorpora (create, upload + progress, delete after confirmation); manual |
| Leipzig link (new tab, noopener) and size note | Same | manual |

## Keyboard and behaviour

| Old behaviour | New home | Verified |
|---|---|---|
| Enter runs Concordance, Collocations, Equivalents | Every toolbar is a form: Enter runs every screen | tests; manual |
| "Create or select a corpus first." | Empty state on every corpus screen + status line | tests ("…without a corpus…") |
| Text always escaped | Svelte text bindings | tests Concordance "shows a hit containing a script tag literally", Sources "document titles with HTML…", Job "shows text containing markup literally"; e2e |
| (new) Ctrl/Cmd+K, ↑/↓, Ctrl/Cmd+E, Esc, `?` | `lib/shortcuts.svelte.ts`, `App.svelte`, DataTable | tests shortcuts, Concordance "Mod+K…", "Mod+E…"; manual keyboard pass (Mod+K from Sources, query, Enter, Tab to the grid, ↓↓, Mod+E opened "Add term" with "parque eólico", Esc closed it and focus returned to the grid, `?` opened the shortcut list) |

Themes: Sources, Concordance, Frequency, Termbase, Job and Base corpora were checked in Light; N-grams, Keyness,
Word cloud and the bilingual Concordance in Dark (the theme switch applies immediately, Auto follows the OS); the
contrast of every token pair is a unit test (contrast.test.ts). The console showed no errors or warnings during the
whole pass.

## Deviations for the user to rule on

- **Concordance hit limit: resolved.** The new screen first requested 300 hits (old UI: 500). Ruled by the user:
  500, as before, for the KWIC and the Source + target requests and for their CSV links (`LIMIT` in
  `screens/Concordance.svelte`); "(showing n)" still marks a total above it. Test: Concordance "requests 500 hits (as
  the old UI) and the CSV link carries the same limit, KWIC and bilingual".
- **Concordance settings after a word link.** Clicking a word in a table opens the Concordance with the query and
  unit only; context width, sort and "Source + target" go back to their defaults (old UI kept the last values of
  the Concordance tab). Minor.

## Deliberate removals / deferrals

- **Equivalents item cells are plain text** (old UI linked them to the concordance): the items are target-language
  lemmas and the link searched the source corpus, a latent bug (ruled in Task 8).
- **Active spaCy model name** is not shown (design Q1): the API does not expose it; deferred to backlog Q1.
- **Project select in the document filter**: not ported; in the old UI the project select only narrowed the corpus
  dropdown, which the rail's project filter does (ruled in Task 7).
- **Shortcut help lists Mod+K, `?` and Mod+E only**; arrows and Esc are documented in the README but not listed in the
  dialog (minor, noted in Task 6).
