# Translator UI/UX conventions (CAT, terminology and corpus tools) and what they mean for colloca

Research date: 2026-11-23. Location note: the repo had no `docs/`, `notes/` or `research/` directory, so this file
follows the fallback `docs/research/translator-ux.md`.

## How to read the evidence labels

- **[P]** a primary vendor/standard page that I fetched and read in full text.
- **[S]** claim taken only from a web-search result summary of a vendor page. The page itself could not be opened by me
  (docs.rws.com, helpdesk.atril.com and context.reverso.net returned HTTP 403). Treat as **unverified against the page**.
- **[SEC]** secondary source (paper, third-party site). Labelled in place.
- **[U]** could not be verified at all.

No Trados Studio or MultiTerm claim in this file is [P]: RWS documentation blocks automated fetching. Everything
about Trados is therefore [S] and should be re-checked by opening the cited page in a browser before relying on it.

---

## 1. Summary

1. Every mainstream CAT tool is **segment-based**: source on the left, target on the right, one row per segment, a
   confirm-and-next keystroke, and a side pane of suggestions. memoQ's grid is exactly this [P]. OmegaT stacks source and
   target inside one editor with a segment marker [P].
2. **Colour is the primary language** of the assistance panes, and it is vendor-specific but consistent in logic:
   TM/LiveDocs matches, term hits, forbidden terms, MT and concordance each get a fixed colour (memoQ [P], Phrase [P],
   OmegaT [P]; Wordfast and Déjà Vu [S]).
3. **Match percentage is the shared vocabulary**: 100 = exact, 101/102 = context match, below 100 = fuzzy, with a
   usable-fuzzy floor around 75% (memoQ [P], Phrase [P], Smartcat [S], Wordfast [S]).
4. **Concordance** is a keyword-in-context (KWIC) view reached with **Ctrl+K** in memoQ [P] and Smartcat [P]; the
   source+target variant shows the aligned translation of every hit, and memoQ can highlight a guessed translation
   inside it [P]. Sketch Engine's parallel concordance does the same for corpora [P].
5. **Term entries have three levels** (entry, language, term) in memoQ [P], MultiTerm [S] and the TBX data model [P].
   Concept-level fields are domain/subject/client/note, language-level is the definition, term-level is status,
   POS, example, usage flags.
6. **Term extraction is a triage workflow**, not a one-click export: candidates carry a status (Candidate / Accepted /
   Dropped in memoQ), a score, source and target examples, and are accepted or dropped with single keystrokes before
   anything reaches the term base [P].
7. Interchange standards are: **TMX** (TM), **TBX** (terms), **XLIFF** (bilingual work files), plus CSV/Excel as
   the pragmatic fallback. colloca already imports TMX and exports TBX/CSV/Excel.

---

## 2. Per-tool findings

### 2.1 Trados Studio / MultiTerm (RWS) - all [S], none opened

- Concordance Search window: searches source and target of the TMs from the Editor; matching text is highlighted yellow
  by default; matches parts of the query even when words are in a different order; an option runs it automatically when
  TM lookup returns nothing (off by default); highlight colour and font size are configurable; reachable from View
  tab, Information group. [S] https://docs.rws.com/en-US/trados-studio-2022-sr1-1076802/file-options-editor-concordance-search-344846 ,
  https://docs.rws.com/en-US/sdl-trados-studio-783545/concordance-search-window-340660
- You can insert text selected from a concordance result into the target segment. [S] same page.
- MultiTerm stores field info in a Termbase Definition; fields live at entry, language or term level. [S]
  https://docs.rws.com/en-US/multiterm-2024-1152755/termbase-entries-levels-and-fields-348549
- Term status: Trados Team/Enterprise "Status (System)" offers Forbidden, Superseded, Draft, In Review, Admitted,
  Rejected, Deprecated, Preferred, Recommended; the MultiTerm 2022 multilingual template uses a different picklist
  (Draft, In Review, Approved preferred, Approved alternative, Rejected obsolete, Rejected deprecated at term level).
  [S] https://docs.rws.com/en-US/trados-team-859828/adding-system-statuses-to-termbase-entries-1076448 ,
  https://docs.rws.com/en-US/multiterm-2022-sr1-983473/term-lifecycle-management-348478
- Translation Results window and editor grid details (match colours, percentages): not obtained. [U]
  (URL for manual check: https://docs.rws.com/en-US/trados-studio-2022-sr2-1107960/translation-results-window-340852)

### 2.2 memoQ - [P]

- **Translation grid**: source in the left cell, translation in the right cell, one segment per row; Ctrl+Enter confirms,
  saves to the working TM, sets status Confirmed and moves on; the next segment is pre-translated. Status bar counts:
  TR, R1, R2, Ed, Rej, Empty, Pre, Frag, MT. https://docs.memoq.com/current/en/Workspace/translation-editor.html
- **Translation results pane colours**: red = TM and LiveDocs; blue = term base; black = forbidden terms (cannot be
  inserted, QA warning if used); purple = fragment assembly; light orange = longest-substring concordance; deep orange =
  MT; yellow = MT concordance; grey = non-translatables; green = auto-translated items. Match bands: 101 context, 102
  double context, 100 exact, 95-99 high fuzzy, 85-94 and 75-84 medium, 50-74 low fuzzy; patched matches shown "!93%".
  Three compare boxes (current source, matched source, matched target) with track-changes or traditional diff view
  (black identical, red differences, blue words missing). Metadata under the match: subject, domain, project, client,
  TM, author, date. Ctrl+Up/Down moves, Ctrl+Space inserts, Ctrl+1..9 inserts the numbered hit, Ctrl+Shift+D toggles hidden
  hits. https://docs.memoq.com/current/en/Workspace/translation-results-list.html
- **Concordance** (Ctrl+K): default three-column KWIC; "Source+target" view shows source, target, TM/corpus, date
  modified, original document; options: auto-detect source/target, put selection in quotes, add wildcards, case
  sensitive, find different numbers, hit limit, `*` and `+` wildcards; "Guess translation" highlights a likely
  translation in green (darker = more confident); Filter source / Filter target boxes; Insert / Insert selected; Add term
  (Ctrl+E) opens Create term base entry. The page does not document sorting.
  https://docs.memoq.com/current/en/Workspace/concordance.html
- **LiveDocs**: corpora of document pairs (aligned), bilingual documents, monolingual reference documents; only pairs and
  bilingual docs return matches, monolingual ones are searched by running Concordance in the target language; alignment
  quality affects match penalties. https://docs.memoq.com/current/en/Workspace/memoq-online-project-livedocs.html
- **Term base entry**: Entry -> Language -> Term. Entry: ID, note, project, domain, subject, client, created/modified,
  image. Language: definition (one per language). Term: matching (fuzzy / 50% prefix default / exact / custom), case
  sensitivity (yes / permissive / no), forbidden flag, example, part of speech, gender, number.
  https://docs.memoq.com/11-1/en/Concepts/concepts-term-bases-inside-an-entry.html
- **Term base filter/sort**: filter by text (optionally exact), modification date, meta (project, domain, author,
  client, subject, forbidden, note), needs moderation; sort by source, target, modifier, date, domain, subject.
  https://docs.memoq.com/current/en/Workspace/filtering-sorting-a-term-base.html
- **Term extraction editor** (the closest analogue to colloca's candidate review): columns Status, #, score, Length,
  hides-shorter, Source (editable, with "Also" merged forms), source example, target example, Target. Statuses Candidate /
  Accepted / Dropped; Accept = Ctrl+Enter, Drop = Ctrl+D, hide shorter Ctrl+L, merge Ctrl+J, re-sort Ctrl+R, filter box
  Ctrl+Shift+F, "Only with TB result" checkbox; default sort status, score, frequency, alphabet; lower panes show
  occurrences (TM concordance hits blue, document occurrences white) and term-base hits; only accepted candidates go to
  the term base; dropped ones can feed a stop-word list. https://docs.memoq.com/current/en/Workspace/term-extraction-editor.html ,
  https://docs.memoq.com/current/en/Workspace/extract-terms.html (the latter only covers starting/continuing sessions;
  candidates can come from documents, TMs and LiveDocs). Export-to-term-base command, Excel and TaaS export: [S]
  (search summary of https://docs.memoq.com/current/en/Workspace/export-accepted-terms-to-term-base.html).
- **Shortcuts** (default set): Confirm Ctrl+Enter; Concordance Ctrl+K; Look Up Term **Ctrl+P**; Filter for selected text
  Ctrl+Shift+F; Display all/filtered hits Ctrl+Shift+D; Insert hit Ctrl+Space; Insert assembled hit F4; numbered hit
  Ctrl+1..9; Copy source to target Ctrl+Shift+S. https://docs.memoq.com/current/en/Workspace/keyboard-shortcuts.html
  (Note: an earlier search summary claimed Ctrl+L for term lookup; the shortcut page says Ctrl+P. The translation-results
  page lists Ctrl+K as "add concordance hit to a term entry" in that pane, so key meanings are pane-dependent.)
- Forbidden terms: a forbidden source term is not shown in the results; a forbidden target term is shown black and never
  highlighted; use triggers a QA warning. [P] (term base page) and [P] (results pane page above).

### 2.3 Phrase (Memsource) - [P] for TMS CAT pane

- CAT pane colours: light green = best TM/NT/MT by score; orange = term base items (preferred term on top); salmon =
  other TM/NT/MT; light purple = MT without QPS; grey = sub-segment TM matches marked "S". 101% = in-context, 100% exact,
  lower fuzzy; arrow-down = penalised score. Term markers: yellow = new/unapproved term, bold yellow = approved, bold yellow +
  pin = strict, red = rejected; asterisk marks a target term with note or usage information. Double-click or Ctrl+number
  applies; Ctrl+Up/Down navigate; Ctrl+Space inserts. Quality-prediction (QPS) bands for MT: 95-100 Excellent, 90-94 Very
  good, 75-89 Good, 0-74 Poor. https://support.phrase.com/hc/en-us/articles/5709683926812-CAT-Pane-TMS
- Concordance search in TMS is scoped to the active segment's project; if two TMs hold a match only the higher-priority one
  is shown automatically. [P] same page.
- Phrase Strings term base highlights matching terms in source and target (green = present/inserted, grey = in term base but
  not in the source string). [S] https://support.phrase.com/hc/en-us/articles/10112337656476-Using-a-Term-Base-Strings

### 2.4 Smartcat

- Ctrl+K on a word selected in Source or Target opens the Concordance Search tab with matches from the project's TMs; you
  can pick Source or Target; a "Global concordance" under Linguistic assets searches all your TMs. [P]
  https://help.smartcat.com/concordance-search/ (the page does not say whether hits are highlighted).
- Glossary terms highlighted in the source segment (one page says yellow), hover shows the approved translation; TM bands
  from 50-74 fuzzy to 100 exact and 101/102 context; default auto-insert threshold 75%; Ctrl+1, Ctrl+2... insert a TM match.
  [S] https://help.smartcat.com/managing-linguistic-resources-in-the-editor/ ,
  https://help.smartcat.com/how-tm-matching-works-in-smartcat/ (search summaries only; the summary itself flagged
  inconsistent 102% wording).

### 2.5 OmegaT - [P]

Source: https://omegat.sourceforge.io/manual-standard/en/chapter.panes.html
- Panes: Editor, Fuzzy Matches, Glossaries, Dictionaries, Machine Translations, Multiple Translations, Notepad, Comments,
  Segment properties, Status bar (table of contents at https://omegat.sourceforge.io/manual-standard/en/index.html).
- Fuzzy Matches pane shows **three percentages**: with stemming ignoring tags and numbers; without stemming ignoring tags and
  numbers; on the full text. Selected match bold; words missing from your segment blue; adjacent parts green. Best match is
  auto-selected on entering the segment; number-key shortcuts select a specific match.
- Glossary pane: `source = target` lines with numbered comments underneath; writable glossary entries in bold; tooltip names
  the glossary file; View > Mark Glossary Matches **underlines glossary terms in the source** and right-click opens the
  translations; Create Glossary Entry adds to the project's single writable glossary.
- Notepad notes are stored in the project TM; Comments pane is read-only (e.g. PO comments).
- Glossary file formats: not obtained (my attempt at the appendix URL returned 404). [U]

### 2.6 Wordfast - [S]

- Segment Score column shows TM match percentage; prefix `%` for 100/fuzzy, `+` for context, `*` for secondary TM; colours
  green (100), dark green (context), yellow (fuzzy), grey (no match); default fuzzy threshold 75%; terminology pane searches
  source or target glossaries and can add terms. Only the "Segment Score column" and "terminology pane" statements were
  confirmed in the Wordfast help page I opened ([P] https://www.wordfast.com/WFP/10.1/Wordfast_Pro_Help_Content.htm);
  colours, prefixes, threshold are [S] from search summaries of the Wordfast user guides
  (https://www.wordfast.com/pdf/WFP_5.10.0_User_Guide.pdf). Concordance shortcut varies by version; re-check.

### 2.7 Déjà Vu - [S]

- Termbase and lexicon entries are highlighted in the grid (page 403, colours not obtained). "Highlight AutoSearch results in
  source text" is an option; lexicon can extract frequent terms with regex help; DeepMiner statistical extraction creates
  sub-segment matches. [S] https://helpdesk.atril.com/hc/en-us/articles/115001875549-Highlighting-of-Termbase-Lexicon-entries-in-the-grid ,
  https://atril.com/compare-our-products/include-deja-vu-x3/

### 2.8 Linguee / Reverso Context-style bilingual concordancers

- Reverso: examples from bilingual texts (movie dialogues, official documents, websites, newspapers); the translation is
  highlighted in each example; clicking it shows equivalents; colours link translations to grammar categories and clicking a
  category filters; unvalidated algorithmic equivalents shown on grey; searching conjugated forms works better than infinitives.
  [S] (search summary of https://context.reverso.net/translation/about , page 403).
- Linguee: nothing obtained. [U]

### 2.9 Sketch Engine - [P]

- **Parallel concordance** works only on aligned corpora; you search the first language and see lines with aligned
  translations; you can display as many languages as the corpus has; toolbar for view options (tags, lemmas), random sample,
  shuffle, favourites, KWIC / alignment / sentence view, sort, filter, frequency; per-line metadata icon; it tries to
  highlight the most probable translation of the search word in the other language and warns that it may be wrong or missing.
  https://www.sketchengine.eu/guide/parallel-concordance-searching-translations/
- **Term extraction**: a focus corpus is compared with a reference corpus; results split into keywords (single words) and terms
  (multiword, must match a language-specific term grammar); keyness via Simple Maths on per-million frequencies; terms shown as
  lemmas; each result links to sentences in both focus and reference corpora; a frequency-range slider on the Advanced tab.
  https://www.sketchengine.eu/guide/keywords-and-term-extraction/ (the page does not describe result columns or export).
- Bilingual word sketches and Dice-based candidate translation: [S] search summary of
  https://www.sketchengine.eu/wp-content/uploads/Bilingual_Word_Sketches_2014.pdf (not opened).

### 2.10 AntConc and TermoStat

- AntConc (KWIC, Plot "barcode", Collocates with window span / min frequency / min range, sort by frequency, position or
  statistic (MI, T-score), double-click a collocate to open its concordance, 1L/2L/1R/2R multi-level sort in 3.x): [S]
  from search summary of https://www.laurenceanthony.net/software/antconc/releases/AntConc431/help.pdf . The PDF was
  compressed and unreadable by my fetcher. 4.x uses a "Sort by" option [S].
- TermoStat: academic papers only [SEC]: compares a specialised corpus with a general reference corpus; single/compound terms; POS
  filter; export of candidate lists; click a term to see concordances; languages EN/FR/ES/IT/PT. Source: the TermoStat/Drouin
  literature surfaced via https://aclanthology.org/2020.computerm-1.1 (Spanish-language description of v3.0 also secondary). Official
  manual not found. [U]
- SDL MultiTerm Extract, Tilde Terminology: not researched. [U]

---

## 3. Cross-tool conventions (what a translator will expect)

| # | Convention | Evidence |
|---|---|---|
| 1 | Side-by-side source / target rows, one segment per row | memoQ [P], OmegaT [P], Phrase [P] |
| 2 | Concordance is KWIC with a switch to source+target view; hit limit, case-sensitive, wildcard, quote-phrase options | memoQ [P], Sketch Engine [P] |
| 3 | The searched word is highlighted in the hit; in the aligned translation the likely equivalent is highlighted and flagged as a guess | memoQ guess-translation [P], Sketch Engine [P], Reverso [S], Trados yellow highlight [S] |
| 4 | Concordance is a single keystroke from the segment (Ctrl+K) and "add term" is a single keystroke from the concordance (Ctrl+E) | memoQ [P], Smartcat Ctrl+K [P] |
| 5 | Match scores are integers with 100 = exact, >100 = context, 75% as a practical floor; bands are colour coded | memoQ [P], Phrase [P], Smartcat [S], Wordfast [S] |
| 6 | Fixed colour per resource type (TM red, terms blue in memoQ; orange in Phrase); colours differ between vendors, so consistency within the app matters more than the particular palette | memoQ [P], Phrase [P] |
| 7 | Terms from the termbase are recognised and marked in the source segment (underline in OmegaT, light colour in memoQ/Smartcat, TB marker in Phrase); forbidden terms get a distinct, negative treatment | OmegaT [P], Phrase [P], memoQ [P] (forbidden), Smartcat [S] |
| 8 | Term entry: concept-level domain/subject/client/note; language-level definition; term-level status, POS, example, forbidden/usage, matching options | memoQ [P], TBX [P] |
| 9 | Term status is a small controlled vocabulary with at least preferred / admitted / forbidden(deprecated); extended sets exist (Draft, In Review, Superseded...) | Phrase [P] (new/approved/strict/rejected), MultiTerm [S], TBX see section 4 |
| 10 | Keyboard-first: confirm-and-next, insert hit by number, navigate hits with arrows, accept/drop candidates with single keys | memoQ [P], Phrase [P], OmegaT [P] |
| 11 | Filter box + sort on every list (termbase and candidate lists), with filter by status/domain/modified date | memoQ [P] |
| 12 | Term candidates carry a score, frequency, example sentences, and a status; accepting is an explicit step; dropped candidates are remembered (stop list) | memoQ [P], Sketch Engine [P] (score, links to sentences) |
| 13 | Evidence next to every suggestion: origin (TM / corpus / document), date, author, domain | memoQ [P] |
| 14 | Terms already in the termbase are flagged inside candidate lists ("Only with TB result") | memoQ [P] |

---

## 4. Standards

### TBX (ISO 30042)
- tbxinfo describes TBX as the international standard for archiving and exchanging terminological information, ISO 30042
  "Management of terminology resources", 2019 edition; dialects TBX-Core, TBX-Min, TBX-Basic; TBX v3 published 2019.
  [P] https://www.tbxinfo.net/
- Data-category modules: Core = note; Min = administrativeStatus, partOfSpeech, subjectField; Basic = context, definition,
  source, termType. [P] https://www.tbxinfo.net/developer-resources/tbx-data-categories/
- Structure (v3): `tbx` (needs `xml:lang`, `type`, `style` dca/dct) -> `tbxHeader` + `text/body` -> `conceptEntry` (id required)
  -> `langSec` (`xml:lang`) -> `termSec` -> `term`; `descrip`/`descripGrp`, `admin`, `transacGrp`, `note`, `ref`/`xref` can sit at
  concept, language or term level; unsupported categories can ride in `note` as "name::content". [P]
  https://www.tbxinfo.net/developer-resources/tbx-elements-reference/ (the page itself is labelled informative, not authoritative)
- The 2008 structure (`termEntry` / `langSet` / `tig`) that colloca's README says most CAT tools read is **not** confirmed by
  the tbxinfo pages I could read (the version-comparison page returned 404). [U]
- Permitted values of administrativeStatus (preferredTerm-admn-sts, admittedTerm-admn-sts, deprecatedTerm-admn-sts,
  supersededTerm-admn-sts...) and termType: the tbxinfo pages gave no values. A product help page and a W3C mailing-list file
  show the `-admn-sts` pattern [SEC]: https://worldserver.mattel.com/ws-legacy/help/en/ws/source/GUID-D069BC04-8706-4068-AC63-0F062A2A9BB9.html ,
  https://lists.w3.org/Archives/Public/public-esw-thes/2010Jun/att-0015/termAdminStatus.html . The authoritative definition is the
  TBX-Basic dialect page https://ltac-global.github.io/TBX-Basic_dialect (v1.2.1 2023, definition document not read) [U].
  **Action for maintainers: validate colloca's TBX against the official schema (README already says it is not validated).**

### TMX 1.4b
- `tmx` -> `header` (required attributes creationtool, creationtoolversion, segtype, o-tmf, adminlang, srclang, datatype) + `body`
  of `tu`; each `tu` has one `tuv` per language (`xml:lang` required) with exactly one `seg`; whitespace significant; inline
  codes `bpt`/`ept`, `it`, `ph`, `hi`, `sub`; `prop` for tool-specific data, unpublished types use the `x-` prefix; Level 1
  = plain text, Level 2 = with content markup. [P] https://www.ttt.org/oscarStandards/tmx/tmx14b.html (a copy of the spec; the
  GALA URL https://www.gala-global.org/tmx-14b returned 404 when fetched directly, and search lists https://gala-global.org/tmx-14b)
- Relevance: colloca's importer drops inline markup and skips units missing a language; this matches "Level 1" use and is fine for
  corpus building, but a translator re-exporting TMX would lose tags.

### XLIFF 2.1 (OASIS)
- Purpose: store localisable data and carry it between steps; `xliff > file > unit > segment (source, optional target)`; inline
  elements; segment `state` values `initial` (default), `translated`, `reviewed`, `final`; `subState` is user defined with a
  `prefix:value` shape; Translation Candidates (matches) and Glossary modules exist. [P]
  https://docs.oasis-open.org/xliff/xliff-core/v2.1/xliff-core-v2.1.html (only first ~200k of 508k characters read)
- SDLXLIFF is an RWS extension of XLIFF 1.2: not verified. [U]

### CSV / Excel
- Used as a fallback for glossaries (memoQ exports candidates to Excel [S]). No standard; column order convention is
  source | target | metadata.

---

## 5. Gap analysis for colloca

Repo state read: `README.md`, `static/index.html` (tabs Sources, Frequency, Concordance, Collocations, Equivalents, N-grams,
Keyness, Word cloud, Termbase, Base corpora), `static/app.js`, `static/style.css`, and the function list of `parallel.py` and
`termbase.py`. No code was changed.

### 5.1 What already matches translator expectations

- KWIC layout: left context right-aligned, node centred in bold accent colour, right context, source document column; sort by
  document / left / right context; context width setting; CSV export. (matches convention 2)
- **Show translation** toggle on the concordance giving the aligned target segment under each hit. (convention 2, memoQ
  source+target view, Sketch Engine parallel concordance)
- Equivalents tab with Dice scoring and "+ term" with example sentence, labelled as a statistical hint. Comparable to Sketch
  Engine's candidate translations and memoQ's "guess translation", and the honest labelling is what Sketch Engine does too.
- Term entry has source/target, POS, status, domain, definition, notes and an example with its source, close to memoQ's entry and
  language levels. "Forbidden" maps to deprecated in TBX export, matching memoQ's forbidden concept (convention 8, 9).
- Candidate -> approved workflow with status filter in the Termbase tab; export of approved entries only by default.
- Click-a-word-to-concordance across all tables (AntConc's collocate to KWIC behaviour).
- TMX/TSV/CSV/DOCX import, TBX/TBX2008/Excel/CSV export, formula-injection neutralisation.
- Keyness against a base corpus plus "Docs %" dispersion, and the term-extraction idea of focus vs reference corpus (Sketch Engine).
- Light/dark theme. Enter submits searches.

### 5.2 Gaps, ranked by value to a translator

| Rank | Gap | Convention it breaks | Why it matters | Suggested change |
|---|---|---|---|---|
| 1 | **Translation side of aligned hits is not highlighted** (`app.js` prints `→ target` plain); the searched term is only bolded in the left corpus | #3 | The first thing a translator looks for is "which words in the target correspond". | Highlight the likely equivalent in the target segment (use the Equivalents candidates or a dictionary of approved terms), tagged as a guess as Sketch Engine does; also highlight the query in the aligned segment when searching by target language. |
| 2 | **Keyboard-first workflow is absent**: only Enter in a few inputs; no Ctrl+K style jump, no "add term" key, no next/previous hit, no accept/drop keys | #4, #10 | Translators work with hands on keys; memoQ and Phrase expose almost every action as a shortcut. | Global shortcuts: `/` or Ctrl+K focus concordance query (with selected text), Ctrl+E add term from selected text, arrow keys to move through hits and rows, Enter/D to accept/drop candidates, Esc to close dialogs. Show them in tooltips. |
| 3 | **Term candidates have no triage view**: "+ term" is per row, with no bulk accept/drop, no score, no already-in-termbase flag, no keep/drop memory | #12, #14 | memoQ's candidate editor (statuses, score, examples, filter, Only with TB result, stop list) is the established workflow. | Add a "Candidates" review table fed from Keyness/Frequency/N-grams with a status column, checkbox/keyboard accept and drop, an "in termbase" badge, a "dropped" list that is excluded next time, example sentence column, and a score column explaining the measure. |
| 4 | **Termbase table is not sortable, no inline edit, no search by field, no filter by domain/modified date** | #11 | memoQ filters by domain, date, client, forbidden; sort by source/target/date. Current list can only search and filter by status. | Clickable column sort, filter by domain/POS/date, show "modified" date, inline editing of status and target. |
| 5 | **Term status vocabulary is minimal** (candidate / approved / forbidden); no *admitted* synonym status, no *superseded*; TBX maps approved to `preferredTerm` always | #9, TBX | Translators distinguish preferred vs admitted alternates; Phrase has strict/approved/new/rejected, MultiTerm has preferred/admitted/deprecated/superseded [S]. | Add `admitted` (and optionally `superseded`) and write the matching TBX administrativeStatus values after validating them against the TBX-Basic definition. |
| 6 | **No term recognition in a source text**, i.e. nothing highlights termbase hits in a pasted/uploaded segment or in concordance lines | #7 | In every CAT tool termbase hits are marked in the segment; forbidden ones are shown differently. | In concordance, highlight words that exist in the termbase in the left/right context and the aligned segment; offer a "check text" box that underlines term hits and forbidden terms (memoQ forbidden = no insertion + QA warning). |
| 7 | **Concordance options lag behind**: no case-sensitive switch, no wildcard (`*`), no "any order" vs exact-phrase choice, no filter-within-results, hit limit fixed at 500 | #2 | memoQ exposes all of these; AntConc offers multi-level sort. | Add case-sensitive, `*` wildcards, "words in any order" toggle, source/target filter boxes, selectable limit, and sort by the 1st/2nd word right and left. |
| 8 | **No per-hit evidence panel** (document, date, author, text type) beyond a truncated document name | #13 | memoQ shows TM name, date, author, domain under a hit; useful to judge reliability of a precedent. | Row click opens a detail strip with document title, date, text type, tags and the full aligned segment pair. Metadata already exists in the DB. |
| 9 | **No match-percentage concept** (no segment-level lookup against aligned texts / TM) | #5 | The central CAT expectation is "type or paste a segment, see fuzzy matches %". colloca has the aligned segments but no way to query by whole segment. | Optional: a "Segment lookup" tab that returns the most similar source segments with percentage, the aligned target, a word-level diff (memoQ compare boxes, OmegaT blue missing words). Use the usual bands (100 exact, 75+ useful). |
| 10 | **Interchange gaps**: no TMX export, no TBX/CSV glossary **import**, no XLIFF; TBX not schema-validated; TMX inline markup dropped | Standards | Translators will want to give the term list to their CAT tool (done) and also to load their existing glossaries/TMs. | Validate TBX against the official schema (TBX-Basic v1.2.1 package); add TBX/CSV/XLSX glossary import with column mapping and a dedupe report; consider TMX export of the aligned corpora. |
| 11 | **Term entry fields missing**: no language-level synonym list per entry, no term-level notes/usage separate from entry notes, no case-sensitivity/match mode, no domain pick-list governance | #8 | memoQ distinguishes language and term level; TBX has three levels. | Support several terms per language in one concept (synonyms/variants), term-level usage note, and gender/number if Romance-language users need them (memoQ has both). Spanish/Italian gender matters. |
| 12 | **Colour system is minimal**: one accent colour; status badges only in termbase | #6 | Consistent semantic colours make scanning easy. | Define tokens for: query hit, likely equivalent (green, graded by confidence), term hit, forbidden term (red/black), candidate (neutral). Keep them accessible in dark mode and do not rely on colour alone (add underline or icon). |
| 13 | Table sorting and filtering on analysis tables is absent client-side; every re-sort needs a re-query | #11 | Translators expect to click a header to sort. | Make result tables client-sortable and add a quick filter box (memoQ "Filter" box). |
| 14 | Concordance "plot" / dispersion view (AntConc) | AntConc [S] | Useful but secondary for translators. | Optional later. |

### 5.3 Top recommendations

1. Highlight the likely target equivalent inside the aligned segment, flagged as a guess, and highlight the query in whichever
   side it appears.
2. Add a keyboard layer (Ctrl+K-style concordance, Ctrl+E add term, arrow navigation, accept/drop keys).
3. Build a candidate-review table with accept/drop, score, in-termbase badge, stop list and examples.
4. Make the termbase table sortable/filterable and add `admitted` / `superseded` statuses; validate TBX against the official
   schema before relying on it.
5. Mark termbase hits (and forbidden terms) in concordance lines and add a "check text" box; then consider segment lookup
   with match percentages.

---

## 6. Sources

Primary (read):
- https://docs.memoq.com/current/en/Workspace/concordance.html
- https://docs.memoq.com/current/en/Workspace/translation-results-list.html
- https://docs.memoq.com/current/en/Workspace/translation-editor.html
- https://docs.memoq.com/current/en/Workspace/memoq-online-project-livedocs.html
- https://docs.memoq.com/11-1/en/Concepts/concepts-term-bases-inside-an-entry.html
- https://docs.memoq.com/current/en/Workspace/filtering-sorting-a-term-base.html
- https://docs.memoq.com/current/en/Workspace/term-extraction-editor.html
- https://docs.memoq.com/current/en/Workspace/extract-terms.html
- https://docs.memoq.com/current/en/Workspace/keyboard-shortcuts.html
- https://support.phrase.com/hc/en-us/articles/5709683926812-CAT-Pane-TMS
- https://help.smartcat.com/concordance-search/
- https://omegat.sourceforge.io/manual-standard/en/chapter.panes.html
- https://omegat.sourceforge.io/manual-standard/en/index.html
- https://www.sketchengine.eu/guide/parallel-concordance-searching-translations/
- https://www.sketchengine.eu/guide/keywords-and-term-extraction/
- https://www.tbxinfo.net/
- https://www.tbxinfo.net/developer-resources/tbx-data-categories/
- https://www.tbxinfo.net/developer-resources/tbx-elements-reference/
- https://www.ttt.org/oscarStandards/tmx/tmx14b.html
- https://docs.oasis-open.org/xliff/xliff-core/v2.1/xliff-core-v2.1.html
- https://www.wordfast.com/WFP/10.1/Wordfast_Pro_Help_Content.htm (only the statements noted)

Search-summary only (page not opened or blocked) [S]:
- https://docs.rws.com/en-US/trados-studio-2022-sr1-1076802/file-options-editor-concordance-search-344846
- https://docs.rws.com/en-US/sdl-trados-studio-783545/concordance-search-window-340660
- https://docs.rws.com/en-US/trados-studio-2022-sr2-1107960/translation-results-window-340852
- https://docs.rws.com/en-US/multiterm-2024-1152755/termbase-entries-levels-and-fields-348549
- https://docs.rws.com/en-US/trados-team-859828/adding-system-statuses-to-termbase-entries-1076448
- https://docs.rws.com/en-US/multiterm-2022-sr1-983473/term-lifecycle-management-348478
- https://docs.memoq.com/current/en/Workspace/export-accepted-terms-to-term-base.html
- https://support.phrase.com/hc/en-us/articles/10112337656476-Using-a-Term-Base-Strings
- https://help.smartcat.com/managing-linguistic-resources-in-the-editor/
- https://help.smartcat.com/how-tm-matching-works-in-smartcat/
- https://www.wordfast.com/pdf/WFP_5.10.0_User_Guide.pdf
- https://helpdesk.atril.com/hc/en-us/articles/115001875549-Highlighting-of-Termbase-Lexicon-entries-in-the-grid
- https://atril.com/compare-our-products/include-deja-vu-x3/
- https://context.reverso.net/translation/about
- https://www.sketchengine.eu/wp-content/uploads/Bilingual_Word_Sketches_2014.pdf
- https://www.laurenceanthony.net/software/antconc/releases/AntConc431/help.pdf

Secondary [SEC]:
- https://aclanthology.org/2020.computerm-1.1 (TermoStat literature)
- https://worldserver.mattel.com/ws-legacy/help/en/ws/source/GUID-D069BC04-8706-4068-AC63-0F062A2A9BB9.html (third-party TBX status mapping)
- https://lists.w3.org/Archives/Public/public-esw-thes/2010Jun/att-0015/termAdminStatus.html (mailing-list attachment)

Not verified at all [U]: Trados Studio editor grid and Translation Results colours; SDLXLIFF; MultiTerm Extract; Tilde
Terminology; Linguee; OmegaT glossary file formats; TBX-Basic permitted termType/administrativeStatus values from the
authoritative definition; the TBX 2008 vs 2019 structural comparison; ISO 30042 text itself (paid).
