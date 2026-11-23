# Colloca: remaining work, triaged by value

Written 2026-11-23, after PRs #2 to #7 were merged. This file lists every task that is still open, ordered by how much
it adds to the tool for a professional translator, with enough detail to start one without re-reading the history.

Sources of the tasks:

- **Roadmap**: the phased plan from the first audit (Phase 1 to 3). Items 1 to 4 of Phase 1 and items 6 to 9 of Phase 2 are done.
- **Research**: the gap analysis in [`research/translator-ux.md`](research/translator-ux.md) (section 5.2; its rank numbers
  are quoted as "research #n"). Its evidence labels matter: most Trados claims there are search summaries, not read pages.
- **Audit**: findings of the first code audit that never got a phase.
- **New**: tasks that came up while building and are not in any of the above.

## 1. How the tasks are ranked

**Value** is the effect on a translator's daily work, not technical interest:

| Value | Meaning |
|---|---|
| **High** | Used in almost every session, or removes a step that currently has to be done in another tool, or protects trust in the output. |
| **Medium** | Used on some jobs, or makes an existing feature clearly better. |
| **Low** | Nice to have, rare, or only matters in a setting we do not know yet (large corpora, shared server). |

**Effort**: **S** about a day or less, **M** two to four days, **L** one to two weeks. Estimates include tests and README.

**Order** is value first, then lower effort and fewer dependencies first. Priorities: **P1** do next, **P2** after P1,
**P3** when there is a reason. Section 3 lists the quick wins that can be slotted in at any time.

## 2. Triage table (in priority order)

The T-numbers are stable labels used for cross-references; the **row order is the rank**.

| # | Task | Value | Effort | Prio | Source |
|---|---|---|---|---|---|
| T01 | Highlight the query and the likely equivalent in aligned concordance lines | High | M | P1 | Research #1 |
| T02 | Candidate review: accept / drop, "already in termbase" badge, stop list | High | M | P1 | Research #3 |
| T03 | Glossary import (TBX, CSV, Excel) with column mapping and a duplicate report | High | M | P1 | Research #10 |
| T04 | Concordance search options: case, wildcard, any order, limit, filter inside results, random sample | High | M | P1 | Roadmap 10, Research #7 |
| T05 | Sortable analysis tables with a quick filter box (**done**, UI redesign) | High | S | P1 | Research #13 |
| T06 | Hit detail panel and "open the document at this hit" | High | M | P1 | Roadmap 10, Research #8 |
| T07 | Validate the TBX export against the official schema and a real CAT tool | High | S | P1 | Research #10, README caveat |
| T08 | Align two documents automatically when no TMX exists | High | L | P1 | New |
| T09 | Keyboard-first layer | High | M | P1 | Research #2 |
| T10 | Termbase table: sort, filter, inline edit, `admitted` and `superseded` statuses | Medium | M | P2 | Research #4, #5 |
| T11 | Job report: save and reopen, whole report as one Excel file | Medium | M | P2 | New |
| T12 | Input formats: OCR for scanned PDFs, XLIFF, ODT, RTF, XLSX, SRT | Medium | L | P2 | Roadmap 12 |
| T13 | Advanced query language: regex, lemma + part of speech, distance patterns, accent-insensitive | Medium | L | P2 | Roadmap 11 |
| T14 | Project backup and restore, undo for deletes | Medium | M | P2 | Audit, New |
| T15 | Termbase hits and forbidden terms marked inside concordance lines, "check text" box | Medium | M | P2 | Research #6 |
| T16 | Near-duplicate document detection | Medium | M | P2 | Roadmap 13 |
| T17 | Query performance for large corpora | Medium | M | P2 | Roadmap 16 |
| T18 | Segment lookup with match percentages (fuzzy matching against aligned texts) | Medium | L | P2 | Research #9 |
| T28 | Engineering health: browser tests, split `app.js`, logging, type checking (**partly done**: browser tests, UI split) | Medium | M | P2 | Audit |
| T19 | Term entry model: several terms per language, term-level notes, gender and number | Medium | L | P3 | Research #11 |
| T20 | TMX export of aligned corpora, keep TMX inline markup | Low | M | P3 | Research #10 |
| T21 | Related-term suggestions from word embeddings | Low | L | P3 | Roadmap 14 |
| T22 | Interface language (Spanish, Italian) and a semantic colour system (**partly done**: catalogue, colour tokens) | Low | M | P3 | Audit, Research #12 |
| T23 | Optional authentication and encryption at rest | Low | M | P3 | Roadmap 15 |
| T24 | PDF extraction robustness | Low | M | P3 | Audit |
| T25 | URL fetching: DNS-rebinding hardening, import a list of URLs | Low | S | P3 | Audit |
| T26 | Virtual scrolling for very large tables | Low | M | P3 | Audit |
| T27 | Dispersion plot for a word across documents | Low | S | P3 | Research #14 |
| Q1 | Show the active spaCy model in the interface, fix the documented default | Medium | S | Quick | Roadmap Phase 1 item 5 |
| Q2 | Keyness: also list words that are key only in the reference corpus | Medium | S | Quick | Audit |

The "value" of T28 is indirect: every other task gets cheaper and safer. It is ranked P2 for that reason.

### Why this order

- T01 to T06 all sit on the screen a translator uses most, the concordance, and on the step after it, adding a term.
  T01 answers the question asked most often ("which word in the target corresponds?") and the aligned texts are already
  there. T02 turns the Keyness, Frequency and Job tables into a term-extraction workflow instead of one-off clicks.
- T03 matters because every translator already has glossaries. An empty termbase makes the Job tab and the exports
  much less useful on day one.
- T07 is small but it gates trust: the export is the deliverable that leaves the tool, and today it has never been
  opened by a real CAT tool.
- T08 is large, but it widens the aligned-texts feature to the files translators really have (a source DOCX and its
  translation) rather than only TMX files.
- P2 tasks are valuable on some jobs or are safety nets (backup, performance, tests). P3 tasks are rare or depend on
  how the tool is deployed.

## 3. Quick wins (slot in at any time)

Each is about a day or less and independent of the rest: **Q1**, **Q2**, **T07**, **T27**, **T25**. (T05 is done.)

## 4. Suggested milestones

| Milestone | Tasks | What the translator gets |
|---|---|---|
| **M1: trusted concordance** | T01, T04, T06, T07, Q1, Q2 (T05 done) | A concordance that points at the equivalent, filters, samples and shows its evidence; a verified export. (Tables already sort and filter.) |
| **M2: terminology pipeline** | T02, T03, T10, T15 | Import existing glossaries, triage candidates, edit the termbase comfortably, see term hits while reading. |
| **M3: more material in** | T08, T12, T16, T14 | More ways to build corpora (document pairs, scans, XLIFF), safer data, no duplicates. |
| **M4: speed and keys** | T09, T13, T17, T28 (rest) | Keyboard workflow, a stronger query language, big corpora stay fast, safer to change. |
| **M5: later** | T11, T18, T19, T20 to T27 | The rest, in the order of the table. |

## 5. Task details

Each task has the same parts: why it matters, what to build, what is out of scope, how to tell it is done, and notes on
where the code is and what could go wrong. File names are in `src/colloca/` unless stated.

---

### T01. Highlight the query and the likely equivalent in aligned concordance lines

**Priority** P1 · **Value** High · **Effort** M · **Source** Research #1

**Why it matters.** With "show translation" a translator sees the aligned target segment under each hit, but has to find
the corresponding word by eye. memoQ ("guess translation"), Sketch Engine and Reverso all highlight the probable
equivalent and flag it as a guess. The hard part (the data) already exists: `parallel.equivalents` scores target lemmas.

**Scope.**
- In `bilingual` lines, mark the **query** in the source segment (not only the KWIC node) and, when searching from the
  target corpus, in the target segment too.
- Mark the **likely equivalent** in the other segment: take the top candidate(s) from `parallel.equivalents` for the
  query (or an approved termbase translation of the query, which always wins), match them against the target segment's
  lemmas and highlight the matching tokens. Graded colour or weight by Dice; a visible "guess" marker (tooltip and a
  non-colour cue, for example a dotted underline).
- API: add token offsets or pre-marked segments to the `bilingual` response (for example `target_marks: [[start, end, score]]`),
  so the browser does not need the lemmatiser. Highlighting must work on the displayed text (`segment_text`), so compute
  offsets there.
- Compute the equivalents once per search, not once per line.

**Out of scope.** Multi-word target equivalents (single lemmas only, as in `equivalents`). Learning from the user's choices.

**Acceptance.**
- Searching "contrato" in a corpus with the sample memory highlights "contratto" in every target segment, with the guess marker.
- An approved termbase translation is preferred over a statistical one and is not marked as a guess.
- No line is mis-highlighted when the same word occurs twice, or when the lemma differs from the surface form ("contratti").
- The API still returns the old fields; CSV export is unchanged.

**Notes.** Touches `parallel.bilingual_concordance` and, in the front end, the `likelyEquiv` slot of
`frontend/src/screens/Concordance.svelte` (already wired to `Kwic` and `Highlight` with the `--hit-equiv` token and the
"guess" badge; it is empty until this task fills it). Beware
tokens vs characters: offsets must be computed from the same `form` + `sp` join used by `segment_text`.

---

### T02. Candidate review: accept / drop, "already in termbase" badge, stop list

**Priority** P1 · **Value** High · **Effort** M · **Source** Research #3

**Why it matters.** Today "+ term" is a per-row click with no memory. In memoQ's term extraction editor, candidates have
a status (Candidate / Accepted / Dropped), a score, examples, and dropped ones are remembered. Without this, the same
noise words come back on every keyness run and it is easy to add a term twice.

**Scope.**
- New "Candidates" table fed from Keyness, Frequency, N-grams, Collocations and the Job gaps/key terms ("send to candidates").
  Columns: status, term, POS, score (with the measure named), frequency, example sentence, translation (editable).
- Per row: accept (opens the existing add-term dialog prefilled, or saves directly if a translation is typed), drop.
- **Stop list**: dropped terms are stored per project and language and excluded from future candidate tables (with a
  "show dropped" switch and a way to restore).
- **In termbase** badge on every candidate list and on the Job tables (single words by lemma, phrases by form), plus an
  "only not in termbase" filter.
- Storage: a `term_rejections` table (project, language, lowercase term, created) and a migration (the next free schema version).

**Out of scope.** Automatic acceptance, machine-translated suggestions.

**Acceptance.** Dropping "plazo" in project A hides it from keyness and job tables in A but not in B. A term already in
the termbase is flagged everywhere a candidate list is shown. Restoring works. Tests cover scoping and the migration.

**Notes.** The badge needs a cheap lookup of termbase source terms by lemma and by form (reuse the term annotation done in
`jobanalysis._terms_in_scope`; consider caching the lemmatised terms per termbase version). Keyboard accept/drop belongs to T09.

---

### T03. Glossary import (TBX, CSV, Excel) with column mapping and a duplicate report

**Priority** P1 · **Value** High · **Effort** M · **Source** Research #10

**Why it matters.** Translators and clients already have glossaries, mostly Excel or TBX exports from their CAT tool. Without
import the termbase starts empty, which makes the Job tab (term recognition) and the exports far less useful.

**Scope.**
- Upload `.xlsx`, `.csv`/`.tsv` and `.tbx` (2008 and 2019 structures; parse with `defusedxml`).
- Spreadsheet import: show the first rows, let the user map columns to source term, translation, POS, status, domain,
  definition, notes, example; choose the language pair and the project; first row as header or not.
- TBX import: read `termEntry`/`conceptEntry`, language sections, terms, `partOfSpeech`, `administrativeStatus`
  (preferred to approved, admitted to approved or a new `admitted` status once T10 exists, deprecated to forbidden),
  `subjectField`, `definition`, `context`, notes. Concepts with several terms per language become several rows.
- **Dry run first**: report how many rows would be added, skipped as duplicates (same source and translation, case-insensitive,
  as enforced by `idx_terms_unique`), or rejected (with the reason per row); apply on confirmation.
- Import status default: `candidate` unless the file carries a status, so nothing is silently "approved".

**Out of scope.** Merging conflicting translations automatically; import of images or custom fields.

**Acceptance.** A round trip works: export TBX and Excel from the termbase, import them into an empty project, get identical entries.
Hostile XML (entity bomb) is refused. A 5,000-row sheet imports in seconds. Tests for each format and the duplicate report.

**Notes.** New `termimport.py` next to `termexport.py`; reuse `termbase.clean` for validation. Needs T07 to know what real
TBX looks like, so sample files from a CAT tool are valuable test data (ask the maintainer for anonymised ones).

---

### T04. Concordance search options: case, wildcard, any order, limit, filter inside results, random sample

**Priority** P1 · **Value** High · **Effort** M · **Source** Roadmap 10, Research #7

**Why it matters.** The concordance is the screen used most. Today the query is lower-cased, has no wildcard, the hit limit is
fixed at 500 in the UI, a term with thousands of hits shows only the first ones in document order, and there is no way to narrow
the hits that are on screen. memoQ and AntConc offer all of these.

**Scope.**
- **Case sensitive** switch (matching on `form` instead of `norm`; needs the query not to be lower-cased in that mode).
- **Wildcard `*`** at word start or end within a word (`contrat*`, `*miento`), translated to a SQL `LIKE` on the indexed column;
  a minimum of three literal characters to keep it fast.
- **Any order** for multi-word queries (all words in the same sentence, any order), shown as the sentence with the words marked.
- **Selectable hit limit** (100, 500, 2000) and **random sample** (a seeded shuffle so the same sample comes back; a "new sample" button).
- **Filter inside the results**: two boxes (left/right context, and, in aligned mode, source/target) that narrow the lines already
  loaded, client side.
- **Multi-level sort**: by the 1st or 2nd word to the right or left (AntConc 1L/2L/1R/2R) in addition to the current options.
- Keep every option in the CSV export.

**Out of scope.** Regex, part-of-speech patterns, distance patterns (T13).

**Acceptance.** Each option has an API test and a visible effect. `contrat*` finds "contrato", "contratos", "contratación" and states
the number of hits. A random sample of 100 from 5,000 hits is reproducible with the same seed. Response times stay under a second on
a 1M-word corpus.

**Notes.** `analysis._find_hits` builds the SQL; the wildcard and case modes belong there. Random sampling must not load all hits
into memory for the context lookups (sample the hit list first, then fetch context). Share the query box with T13 so the two do not
diverge.

---

### T05. Sortable analysis tables with a quick filter box

**Priority** P1 · **Value** High · **Effort** S · **Source** Research #13

**Status: done** (UI redesign, 2026-11). Every table is the shared `DataTable` component (`frontend/src/lib/ui/`):
click a header to sort (numbers numerically, text accent- and case-insensitively), a *Filter in results* box above it,
keyboard row navigation, no re-query; CSV links still export the full result. The text below is kept for reference.

**Why it matters.** Every table (frequency, keyness, collocations, n-grams, equivalents, job report, termbase) is sorted by the
server; changing the order means a new query, and there is no way to find a row in a long table. Translators expect to click a
header to sort and type in a filter box.

**Scope.** In the shared `table()` helper in `static/app.js`: clickable headers (ascending, descending, off; numbers sorted numerically,
text with `localeCompare` for Spanish and Italian), an arrow on the active column, and a filter box above each table that hides
non-matching rows (case- and accent-insensitive). The row count shows "n of m". Sorting keeps the "+ term" and concordance links working.

**Acceptance.** Works on all tables, including those rendered by the Job tab; does not re-query; keyboard accessible (header buttons,
not bare cells); the filter does not break the CSV link (CSV still exports the full result).

**Notes.** Pure front end. Do it before T09 so shortcuts can rely on a stable table component.

---

### T06. Hit detail panel and "open the document at this hit"

**Priority** P1 · **Value** High · **Effort** M · **Source** Roadmap 10, Research #8

**Why it matters.** A translator judges a precedent by where it comes from: which document, who wrote it, when, what kind of text.
All of that is in the database, but a hit shows only a truncated document title, and there is no way to read the surrounding text.

**Scope.**
- Clicking a line opens a detail strip: document title, source, author, date, text type, tags, the whole sentence, and in aligned mode the
  whole segment pair.
- "Open document" shows the document text (the `GET /api/documents/{id}` endpoint exists) scrolled to the hit with the match marked; for
  aligned documents show both sides in two columns, scrolled to the same segment.
- Previous/next hit buttons inside the viewer.
- API: a `GET /api/documents/{id}/context?pos=...` (or a `segment` parameter) returning a window of text with offsets, so the browser
  does not have to download a 10 MB document to show one hit.

**Acceptance.** From a hit you reach the document at the right place in one click, for both normal and aligned documents; metadata
shown matches the document; works from the Equivalents and Job tables too (via their concordance link).

**Notes.** Token positions map to characters through `form` + `sp`; build a helper that returns the text of a token range with
offsets. Reuse for T01 and T15.

---

### T07. Validate the TBX export against the official schema and a real CAT tool

**Priority** P1 · **Value** High · **Effort** S · **Source** Research #10, README caveat

**Why it matters.** The termbase export is the deliverable that leaves the tool, and the README says it has not been validated.
The research notes the structure and data-category names were not confirmed against the authoritative TBX-Basic definition, and that the
2008 structure's use in CAT tools is unverified.

**Scope.**
- Obtain the official TBX-Basic dialect files (RNG/DTD and the definition document from the TBX-Basic site) **after the maintainer
  approves the download**, and validate generated files for both `tbx` and `tbx2` in a test (use `lxml` in the test environment only).
- Check the `administrativeStatus` and `partOfSpeech` value lists and the placement of `definition`, `context` and `note` against the definition.
- Import a generated file into the CAT tool(s) the maintainer uses (Trados MultiTerm, memoQ, Phrase, OmegaT) and record the result in the README.
- Fix whatever differs; if the 2008 structure is not read by the maintainer's tool, say so and drop or fix it.
- Add a generated sample (`docs/samples/termbase-sample.tbx`) to the repository.

**Acceptance.** Generated TBX validates against the official schema in CI; the README states which tools were tested and with what result.

**Notes.** Do not claim "validated" in the README until the schema test exists. Blocks T03 (import) and T20.

---

### T08. Align two documents automatically when no TMX exists

**Priority** P1 · **Value** High · **Effort** L · **Source** New

**Why it matters.** Aligned texts today need a TMX or a two-column file. Many translators only have the original and the delivered
translation as two DOCX or PDF files. Aligning them is the usual way to build a client memory; every CAT tool has an aligner.

**Scope.**
- Upload two documents (source language, target language) into a pair of corpora, split each into sentences with the existing spaCy
  pipeline, and align the sentences with a length-based algorithm (Gale and Church) with anchors on numbers, dates, capitalised
  names and shared punctuation.
- Alignment types: 1:1, 1:2, 2:1, 1:0, 0:1; merged units are stored as one segment (joined with a space) so the existing storage
  (segment N of one side is the translation of segment N of the other) stays valid.
- **Review screen**: two columns, mark low-confidence links, merge and split segments, delete a pair, then confirm. Nothing is stored
  before confirmation.
- Report: number of links by type and the share of low-confidence ones.

**Out of scope.** Aligning more than two languages; embedding-based alignment (could replace the length model later).

**Acceptance.** A fixture pair of documents with known 1:1 and 1:2 links is aligned correctly in tests; the review screen can fix a wrong
link; the result is searchable with "show translation" and with Equivalents. A document pair of 10,000 words aligns in under a minute.

**Notes.** New module next to `parallel.py`. Storage needs no change if units are merged into single lines. Paragraph structure from DOCX
helps as anchors, so keep paragraph breaks when extracting.

---

### T09. Keyboard-first layer

**Priority** P1 · **Value** High · **Effort** M · **Source** Research #2

**Why it matters.** Translators work with their hands on the keyboard; memoQ, Phrase and OmegaT expose nearly every action as a shortcut.
Here only Enter in three inputs is wired.

**Scope.** Global shortcuts that do not clash with the browser: `/` or `Ctrl+K` focuses the concordance query (filled with the selected
text, if any); `Ctrl+E` adds a term from the selection or the focused row (opens the dialog); up/down move through rows and hits,
Enter opens the hit detail (T06); accept/drop on candidate rows (T02); `Esc` closes dialogs and panels; number keys 1 to 9 pick an example
sentence in the term dialog. A "?" overlay lists all shortcuts; each button's tooltip shows its key.

**Acceptance.** Every shortcut works with and without text selected, is documented in the overlay and the README, is disabled while typing
in an input, and is covered by a browser test (T28). Nothing breaks screen-reader navigation.

**Notes.** Depends on T05 (table component), T02 and T06 for the actions that use them. memoQ uses Ctrl+K and Ctrl+E too, which is why
those keys were suggested, but browsers reserve some of them (Ctrl+K in some browsers focuses the address bar): make the keys configurable.

---

### T10. Termbase table: sort, filter, inline edit, `admitted` and `superseded` statuses

**Priority** P2 · **Value** Medium · **Effort** M · **Source** Research #4, #5

**Why it matters.** The termbase tab can search and filter by status only. memoQ filters by domain, date, client and forbidden and sorts by
source, target, date, domain. The status vocabulary (candidate, approved, forbidden) has no "admitted" synonym status, so a preferred term and
an acceptable alternative cannot be told apart, and the TBX export writes every approved translation as `preferredTerm`.

**Scope.**
- Sort by any column (T05 gives the client-side part; add server-side sort for large termbases), filter by domain, part of speech, project,
  language pair and modified date, show the modified date.
- Inline editing of status and translation in the table.
- New statuses `admitted` (acceptable alternative) and `superseded` (obsolete); map them to `admittedTerm-admn-sts` and
  `supersededTerm-admn-sts` in TBX (after T07 confirms the values), and to the right wording in Excel and CSV.
- No schema change is strictly needed: there is no DB check constraint and the vocabulary lives in `termbase.STATUSES`; a migration is only needed if a new column (for example modified-by) is added.
- Bulk actions: set the status or domain of the selected rows, delete selected.

**Acceptance.** Sorting and filtering do not lose entries; an `admitted` translation exports as admitted; an import (T03) maps statuses both ways.

---

### T11. Job report: save and reopen, whole report as one Excel file

**Priority** P2 · **Value** Medium · **Effort** M · **Source** New

**Why it matters.** The report from the Job tab disappears when the server restarts or the page is reloaded, and each table is a separate CSV.
A translator wants to attach the analysis to the project and to send it to a project manager.

**Scope.**
- Persist the report (a `job_reports` table: corpus, project, title, created, parameters, JSON payload; migration) and list the saved reports
  in the Job tab with open and delete.
- One Excel workbook with a sheet per table plus a summary sheet (same formula-safety as the termbase export).
- Show the analysed text with termbase hits underlined and forbidden source terms in a warning style (research #6 for a source text);
  this needs the text, so keep it optional and stored only if the user ticks "keep the text".
- Optionally show the share of the text covered by aligned segments of the corpus (a rough leverage figure) once T18 exists.

**Acceptance.** A saved report reopens identically after a restart; the workbook opens in Excel with all tables; deleting a report deletes its text.

**Notes.** Confidentiality: the source text of a client job is sensitive. Default to not storing it, say so in the interface.

---

### T12. Input formats: OCR for scanned PDFs, XLIFF, ODT, RTF, XLSX, SRT

**Priority** P2 · **Value** Medium · **Effort** L (split: OCR M, XLIFF M, the others S each) · **Source** Roadmap 12

**Why it matters.** Clients often send scans (rejected today), bilingual XLIFF files, ODT or RTF documents, spreadsheets with text, and
subtitle files. Each missing format is a manual conversion step.

**Scope.**
- **OCR** for PDFs without a text layer: run `ocrmypdf` or Tesseract with the corpus language (`spa`, `ita`), as an optional extra so the
  base install stays small; clear message and a switch when the tool is missing; report OCR confidence and warn when it is low.
- **XLIFF 1.2 and 2.x** as a source of aligned segments (feeds the aligned-text import; `source` and `target` per unit) and as plain text.
- **ODT, RTF**: text extraction (odfpy or the zipped XML directly; striprtf).
- **XLSX/CSV text columns**: choose the column(s) to import as a document.
- **SRT/VTT**: strip timestamps, keep cue text as segments; an aligned variant for two subtitle tracks is out of scope.
- Extend `ingest.read_file` and the upload filters in the interface; keep the size and page limits.

**Acceptance.** A sample of each type imports, with the right language check and token counts; a scanned PDF gives text with a warning about
quality; a missing OCR tool produces an actionable message, not a stack trace.

**Notes.** OCR adds a system dependency (Docker image change, optional). Parse XML formats with `defusedxml`.

---

### T13. Advanced query language: regex, lemma + part of speech, distance patterns, accent-insensitive

**Priority** P2 · **Value** Medium · **Effort** L · **Source** Roadmap 11

**Why it matters.** Corpus tools such as Sketch Engine and AntConc let users ask for "any form of *tomar* followed within three words by a noun",
or find a word regardless of accents. Today a query is a sequence of lemmas or forms, nothing more.

**Scope.**
- Token-level query syntax: `[lemma="tomar"] []{0,3} [pos="NOUN"]` or a friendlier form (`tomar +3 NOUN`); regex on form or lemma; boolean `|`.
- **Accent-insensitive** matching as a switch (`cafe` finds `café`): needs a stripped-accents column or index (`norm_ascii`), a migration, and a
  re-annotation or a SQL backfill.
- Compile the query to SQL over `tokens` (joins on `pos`) with limits to keep it safe; reject patterns that would scan everything.
- Show the parsed query back to the user ("tomar, then 0 to 3 words, then a noun").

**Out of scope.** A full CQL implementation.

**Acceptance.** Documented grammar with examples; tests for each construct; error messages that point at the position of a mistake; no query can run
unbounded (timeouts and hit caps).

**Notes.** Do T04 first; its wildcard and case options are the simple end of this. Share one query parser. This is the largest task in the table
because of the SQL compilation and index design.

---

### T14. Project backup and restore, undo for deletes

**Priority** P2 · **Value** Medium · **Effort** M · **Source** Audit, New

**Why it matters.** Corpora and termbases are client work that took hours to build. Deleting a corpus or document is final and asks only for a
confirmation. The only backup instructions are a `docker run ... tar` line in the README, and nothing exports one project on its own.

**Scope.**
- **Export a project** (or the whole database) to a single file: a zip with a consistent copy of the SQLite data (using the backup API), or a
  portable JSON/CSV form of corpora, documents (text and metadata), termbase and aligned links, without the tokens (they can be re-annotated).
- **Import** that file into a fresh or existing installation, with a conflict report.
- **Soft delete**: deleted documents, corpora and terms go to a "Trash" for a configurable time (default 30 days) with restore and
  "empty trash"; migrations add `deleted` columns or a trash table.
- Automatic pre-migration backup already exists (`db.migrate`); keep it.

**Acceptance.** Round trip restores an identical project (same counts and termbase); restoring a deleted document brings its metadata and aligned
partner link back; permanent delete is explicit.

**Notes.** Tokens dominate database size, so exporting without them keeps files small; the re-annotation job already exists. Pairs with T23 (encrypted export).

---

### T15. Termbase hits and forbidden terms marked inside concordance lines, "check text" box

**Priority** P2 · **Value** Medium · **Effort** M · **Source** Research #6

**Why it matters.** In every CAT tool termbase hits are marked in the source segment and forbidden terms are treated differently. The Job tab
reports hits for a whole text but does not mark them in running text or in concordance lines.

**Scope.**
- In the concordance (and aligned lines, T01), underline words that belong to a termbase entry of the current project and show the approved
  translation on hover; a forbidden translation found in a target segment is shown in a warning style.
- A **"check text"** box: paste a source segment (or a draft translation) and see termbase hits marked, forbidden terms flagged. For a draft
  translation, check the target side against forbidden translations and approved ones.
- Reuse the term matching from `jobanalysis` (forms and lemmas, multi-word).

**Acceptance.** Hits are marked correctly for inflected and multi-word terms; forbidden translations are flagged in an example; colour is not the only cue.

**Notes.** Match on the server and return offsets (same mechanism as T01). Cache the lemmatised termbase per project to keep lookups fast.

---

### T16. Near-duplicate document detection

**Priority** P2 · **Value** Medium · **Effort** M · **Source** Roadmap 13

**Why it matters.** Only byte-identical text (after whitespace and case folding) is rejected as a duplicate. The same page fetched twice with a different
cookie banner, a PDF and its HTML version, or two versions of a contract, count twice in every frequency and keyness figure.

**Scope.** At import compute a similarity fingerprint (MinHash or SimHash over word shingles) and compare it with the corpus; if similarity is above a
threshold (default 85 to 90%), warn and let the user skip, import anyway or replace the older document. A "find near-duplicates" report for an existing
corpus. Store the fingerprint on the document (migration).

**Acceptance.** Two versions of a text with a changed paragraph are flagged; unrelated documents are not; large imports stay fast; the warning shows what
overlaps. Sentence imports (reference corpora) are exempt.

---

### T17. Query performance for large corpora

**Priority** P2 · **Value** Medium · **Effort** M · **Source** Roadmap 16

**Why it matters.** `frequency` runs two full-table `GROUP BY` queries, `keyness` runs it twice with an unlimited limit, `collocations` loads the whole
lemma table and runs one SQL query per hit. A base corpus of several million words, or a client corpus of one million, will make these slow.
(The sentence-file import is already heavy at around 7 million words.)

**Scope.**
- Measure first: a benchmark script that builds corpora of 1M and 5M words and times each analysis; add the figures to the README.
- Precomputed per-corpus counts (lemma, form, per document) maintained at import and re-annotation, used by frequency, keyness, coverage and reference
  columns; scoped filters fall back to the live query.
- Batch the collocation context lookups into a single query per document, and avoid `lemma_counts` over the whole corpus for rare nodes.
- Pagination or streaming for large result sets; index review (`EXPLAIN QUERY PLAN`) for the hit queries.

**Acceptance.** Documented timings; no analysis over 5 seconds on a 1M-word corpus; results identical before and after (the statistics tests must still pass unchanged).

**Notes.** Do not optimise before measuring. T28's test data generator can double as the benchmark corpus.

---

### T18. Segment lookup with match percentages (fuzzy matching against aligned texts)

**Priority** P2 · **Value** Medium · **Effort** L · **Source** Research #9

**Why it matters.** The shared vocabulary of CAT tools is the match percentage (100 exact, 75+ useful). Colloca holds aligned segments but cannot be queried with
a whole segment. The translator's own CAT tool already does this, so the value is in applying it to corpora that are not in the CAT tool.

**Scope.** A "Segment lookup" tab: paste a source segment and get the most similar source segments of the aligned corpora with a percentage, the aligned
target, and a word-level difference (words missing from the query in blue, as OmegaT and memoQ do). Use the usual bands (100, 95 to 99, 85 to 94, 75 to 84,
below 75). Optionally run it over a whole text to give a leverage figure for the Job report (T11).

**Acceptance.** Exact and fuzzy matches are found; the percentage is stable and documented (token-level edit distance with numbers and tags handled); lookup is
fast (an index on word shingles or a trigram table, not a full scan).

**Notes.** Needs an index on segments; plan it with T17. Do not promise CAT-grade results: say it is a lookup aid.

---

### T19. Term entry model: several terms per language, term-level notes, gender and number

**Priority** P3 · **Value** Medium · **Effort** L · **Source** Research #11

**Why it matters.** An entry is a single (source, translation) pair. TBX and memoQ model a concept with several terms per language (synonyms, variants), term-level
usage notes and, for Romance languages, gender and number. Today synonyms are separate rows, grouped only at export time by source term.

**Scope.** Introduce a concept table with language-level definition and several term rows per language (each with status, POS, gender, number, usage note,
example, match mode and case sensitivity); migrate existing rows to one concept each, grouped by project, language pair and lower-case source term; update the
termbase tab, the dialog, the Job matching, and the exports (TBX already has the structure).

**Acceptance.** Existing exports keep the same content after the migration; synonyms can be added to a concept; Italian gender is exported in TBX.

**Notes.** This is a data-model change touching termbase, jobanalysis, termexport and the UI; do it after T10 and T03 so imports and statuses are settled.

---

### T20. TMX export of aligned corpora, keep TMX inline markup

**Priority** P3 · **Value** Low · **Effort** M · **Source** Research #10

**Why it matters.** Aligned texts can be imported but not exported, so a memory built or cleaned in Colloca cannot go back to a CAT tool. The importer drops inline
tags, which is fine for corpus building but loses them on a round trip.

**Scope.** Export a corpus pair (or a filtered subset) as TMX 1.4b Level 1 (plain text) with the project and metadata as `prop` elements; optionally keep the original
inline markup when a TMX was imported (store the raw segment in a side table or column). Validate against the TMX DTD like T07.

**Acceptance.** Import, then export, then import again gives the same segments; the exported file opens in a CAT tool.

---

### T21. Related-term suggestions from word embeddings

**Priority** P3 · **Value** Low · **Effort** L · **Source** Roadmap 14

**Why it matters.** Suggesting synonyms and related terms ("terms that behave like this one") can help with drafting, but it is a new dependency (embeddings or a
thesaurus) and the quality in specialist domains is uneven.

**Scope.** Train or load word vectors (fastText on the client corpus plus the base corpus, or spaCy's vectors in `md`/`lg` models), show the nearest neighbours of a
lemma, filtered by part of speech, always labelled "related terms (statistical)". A thesaurus (for example Open Thesaurus data for Spanish and Italian) as a second
source with its licence recorded.

**Acceptance.** Neighbours are shown for a term with the source of each suggestion; nothing is added to the termbase automatically; the extra dependency is optional.

**Notes.** Defer until there is a clear need; it adds size to the image and its value to terminology work is uncertain.

---

### T22. Interface language (Spanish, Italian) and a semantic colour system

**Priority** P3 · **Value** Low · **Effort** M · **Source** Audit, Research #12

**Status: partly done** (UI redesign, 2026-11). Done: every interface string comes from one catalogue
(`frontend/src/lib/i18n.ts`, English only), and semantic colour tokens exist for query hit, likely equivalent, termbase
hit, forbidden term and the candidate / approved / forbidden statuses, each with a non-colour cue, in both themes
(`frontend/src/lib/styles/tokens.css`, contrast checked by a unit test). Remaining: the Spanish and Italian
catalogues with a language switch, and the contrast ratios written up as documentation.

**Why it matters.** The interface is English only while the users work in Spanish and Italian. The research also found one accent colour and badges only in the
termbase, where memoQ and Phrase use a fixed colour per kind of information. (A light and dark theme already exist.)

**Scope.** Move interface strings to a catalogue (en, es, it) with a language switch; define colour tokens for query hit, likely equivalent, term hit, forbidden term,
candidate, and keep them accessible in both themes with a non-colour cue; check contrast.

**Acceptance.** Every visible string comes from the catalogue; switching language does not reload data; contrast ratios documented.

**Notes.** Do the string extraction after T01 to T06 so new interface does not need to be translated twice.

---

### T23. Optional authentication and encryption at rest

**Priority** P3 · **Value** Low · **Effort** M · **Source** Roadmap 15

**Why it matters.** There is no authentication; the compose file binds to localhost, which is the whole protection. It only matters if the tool is shared on a
network or the disk is not encrypted. Client material often falls under an NDA.

**Scope.** An optional single password or token (environment variable) that protects the API and interface, with a login page and rate limiting; documentation for
reverse-proxy setups; optional SQLCipher or a documented encrypted volume for the database; encrypted export for T14.

**Acceptance.** With the variable unset behaviour is unchanged; with it set every endpoint requires the credential; the README states the threat model honestly.

---

### T24. PDF extraction robustness

**Priority** P3 · **Value** Low · **Effort** M · **Source** Audit

**Why it matters.** The PDF cleaner removes repeated headers and footers and joins soft-wrapped lines by heuristics. It can damage two-column layouts and tables, and
nothing tells the user a result is poor.

**Scope.** Detect multi-column pages from word coordinates and read them in order (pdfminer layout or PyMuPDF blocks), keep tables as rows, compute a quality score
(share of lines that end mid-sentence, very short lines, odd characters) and show it with a link to the preview before the text is added.

**Acceptance.** A fixture with two columns reads in the right order; a deliberately garbled PDF gets a low score and a warning.

---

### T25. URL fetching: DNS-rebinding hardening, import a list of URLs

**Priority** P3 · **Value** Low · **Effort** S · **Source** Audit

**Why it matters.** The address check resolves the host and then `httpx` resolves it again when connecting, a small window for DNS rebinding. Separately, URLs can
only be added one at a time.

**Scope.** Connect to the address that was checked (a custom transport or resolver pinned to the validated IP, with the original `Host` header); a textarea for several URLs
that are fetched as background jobs with a per-URL report (the trimming step becomes optional for lists); a polite delay and a per-host limit.

**Acceptance.** A test with a resolver that changes its answer between calls is refused; a list of ten URLs produces ten documents or ten clear errors.

---

### T26. Virtual scrolling for very large tables

**Priority** P3 · **Value** Low · **Effort** M · **Source** Audit

**Why it matters.** Tables render every row into the page (up to 5,000), which makes the browser slow for the largest results.

**Scope.** Render only the visible rows with a spacer (a small custom component or a library) in the shared `table()` helper, keeping sorting and filtering from T05.

**Acceptance.** 20,000 rows scroll smoothly; the sticky header, links and keyboard navigation keep working.

---

### T27. Dispersion plot for a word across documents

**Priority** P3 · **Value** Low · **Effort** S · **Source** Research #14

**Why it matters.** AntConc's "plot" shows where a word occurs across the documents of a corpus. It is secondary for translators but cheap.

**Scope.** A small bar or "barcode" chart per document for a query, using positions already stored; click a mark to open the hit (T06).

**Acceptance.** The plot matches the concordance counts per document.

---

### T28. Engineering health: browser tests, split `app.js`, logging, type checking

**Priority** P2 · **Value** Medium (indirect) · **Effort** M · **Source** Audit

**Status: partly done** (UI redesign, 2026-11). Done: the front end is a typed Svelte/Vite app in `frontend/` split
into screens, components and stores (replacing `app.js`), with eslint and svelte-check, Vitest unit and component
tests, and Playwright browser tests of the main flow (create corpus, upload, concordance, add term, termbase, CSV
export), all in CI. Remaining: the other browser flows (aligned texts, job analysis), logging, Python type checking
and coverage, the Python version floor, offline model install, and the sample-data generator.

**Why it matters.** The back end has 130 tests; the front end has none, and `static/app.js` is one 600-line file whose long lines hold most of the interface logic.
Each new feature is verified by hand in a browser. The server logs almost nothing. These make every other task slower and riskier.

**Scope.**
- Browser tests (Playwright) for the main flows: create corpus, import text, run an analysis, add a term, export, import aligned texts, analyse a job. Run in CI.
- Split `app.js` into modules by area (corpora and projects, sources, analyses, termbase, aligned texts, job) without a build step (ES modules); format with a formatter.
- Logging: structured logs for imports, jobs, errors and slow queries (a query timer that logs anything above a threshold); log level from the environment.
- Type checking (pyright or mypy at a basic level) in CI and a coverage report; fix the Python floor question (3.14 is very new; test 3.12 and 3.13).
- Offline-friendly install: document and test installing the spaCy models from a local wheel directory, so builds do not depend on GitHub downloads.
- A sample-data generator that builds corpora of any size for tests and for T17.

**Acceptance.** CI runs the browser tests; no function in the front end over about 60 lines; logs show job lifecycle events; the README explains offline install.

---

### Q1. Show the active spaCy model in the interface, fix the documented default

**Priority** Quick win · **Value** Medium · **Effort** S · **Source** Roadmap Phase 1 item 5

**Why it matters.** Lemma and part-of-speech quality depends on the model size, and today the only trace of the model is an "older model" tooltip. The Docker
build now defaults to `lg` (the compose file and Dockerfile were changed by the maintainer) while the README still describes `sm` and `md`, and `uv sync` installs `sm`.

**Scope.** Show the model name and version in the header or Sources tab (from `nlp.pipeline_name`, via a small `GET /api/status`); say plainly in the README which model each way of
running installs and which is recommended; warn in the interface when a corpus language runs on a small model; make the sync/test path state that it uses `sm`.

**Acceptance.** The interface shows the model for each language; README matches the Dockerfile and compose file.

---

### Q2. Keyness: also list words that are key only in the reference corpus

**Priority** Quick win · **Value** Medium · **Effort** S · **Source** Audit

**Why it matters.** `analysis.keyness` loops over the studied corpus's words only, so a word that is frequent in the reference and absent from the studied corpus never appears,
and negative keyness (under-use) is only visible for words that occur in both. The sign convention exists but half of it is missing.

**Scope.** Add an option (`both_directions`, off by default) that also scores the reference-only words (a = 0) and returns them with negative LL and a clear label ("under-used");
add a filter in the interface (over-used, under-used, both). Keep the default output unchanged.

**Acceptance.** A word absent from the studied corpus and frequent in the reference appears with a negative LL when the option is on; existing keyness tests pass unchanged; a new test
covers the new rows.

---

## 6. Open questions for the maintainer

These change priorities, so answers are worth getting early:

1. **Which CAT tool(s) do you deliver terminology and memories to?** (Trados, memoQ, Phrase, OmegaT, other.) It decides whether T07 tests the 2008 or the 2019 TBX first, and whether T20 matters.
2. **Where do your aligned texts come from?** TMX exports, bilingual DOCX, or two separate documents? That sets T08 against T12.
3. **How big do your corpora get?** If clients' corpora stay under 1M words, T17 and T26 can wait; if you plan the base corpora of several million words, T17 moves up.
4. **Is the tool ever used by anyone but you, or exposed on a network?** If yes, T23 becomes P1.
5. **Will you work in languages beyond Spanish and Italian?** The supported pair is hard-coded in `nlp.SUPPORTED`; adding a language is cheap for the pipeline but touches the language check (`langcheck`) and the stopword-based detection.
6. **Can you share anonymised sample files** (a glossary, a TBX export, a TMX, a bilingual DOCX)? They are the best test data for T03, T07, T08 and T12.

## 7. Done so far (for reference)

| PR | Delivered |
|---|---|
| #2 | Language check, upload limits, CSV formula safety, background imports, schema migrations, re-annotation, statistics tests, ruff and CI |
| #3 | Per-language base (reference) corpus, keyness default, base-corpus columns, sentence-file and CLI import |
| #4 | Projects, document metadata (tags, type, date, author), filters applied to every analysis |
| #5 | Termbase, TBX (2008 and 2019 structure), Excel and CSV export |
| #6 | Aligned texts: TMX and two-column import, translated concordance, Equivalents |
| #7 | Job analysis: coverage, gaps, key terms, termbase hits, repeated phrases, job glossary export |
| UI redesign | New interface (Svelte/Vite, `frontend/`): left-rail layout, CAT terminology, sortable and filterable tables (T05), keyboard shortcuts, colour tokens and string catalogue (part of T22), unit and browser tests (part of T28) |

Corrections to the first audit: a light and dark theme already exists (`prefers-color-scheme`, now in `frontend/src/lib/styles/tokens.css` with a manual Auto / Light / Dark switch), so no "dark mode" task is needed.
