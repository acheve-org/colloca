# Termbase

## Adding terms

- **+ Term** next to any row of *Frequency*, *Collocations*, *N-grams*, *Keyness*, *Equivalents*, Job report.
- *+ Term* button beside the concordance search.
- Select a concordance hit, press **Ctrl/Cmd+E**. Selected text in the hit becomes the term (or the translation, if in the target segment).
- The dialog pre-fills term, part of speech, example sentence. *Find examples* lists whole sentences from the current corpus (respects the document filter).

## Entries

An entry is a (source term, translation) pair.

| Field | Values |
|---|---|
| Status | `candidate` (to review; translation may be empty), `approved` (preferred), `admitted` (acceptable alternative), `superseded` (obsolete), `forbidden` (must not be used; exported as deprecated) |
| Other | part of speech, domain, definition, notes, example sentence |
| Target language | The other supported language |

- Every status except `candidate` needs a translation.
- **Scope**: entries belong to the project of the corpus they were added from. Every working corpus belongs to a project. A corpus uses its project's termbase plus the general termbase (entries with no project), which is shared by all projects. Deleting a project permanently deletes its termbase entries; they do not go to the Trash.
- **Termbase screen**: list, sort by any column, search, filter (status, domain, part of speech, modification date), edit status and translation in the table, bulk-apply status or domain, bulk delete.

## Concepts, synonyms, gender, number

- Pairs about the same thing share a **concept**. Default: all pairs with the same source term (any case) in a project and language pair.
- In the detail strip: *Add translation*, *Add source synonym* (e.g. *domicilio* for *vivienda*), *Same concept* (lists the other pairs).
- Each side has **gender** (masculine, feminine, neuter, other), **number** (singular, plural, dual, mass, other) and a **usage note** (*Gender, number and notes* in the dialog). Spanish or Italian words such as *femminile*, *pl* are understood on import.
- Job matching, *In termbase* badges and *Check text* still work per pair.

## Reviewing candidates

Applies to *Frequency*, *Collocations*, *N-grams*, *Keyness*, Job gaps, key terms, phrases.

| Control | Behaviour |
|---|---|
| **In termbase** badge | Single words match by lemma, phrases by word forms. Any status counts. |
| *Only not in termbase* | Hides terms already present. |
| **Drop** | Adds to the project's stop list (per project and language, case-insensitive). Hidden in that project only. |
| *Show dropped*, **Restore** | Undo, here or in the stop list at the foot of *Candidates*. |
| **→ Candidates** | Keeps the term in *Candidates* (stored in this browser, per project and language). |
| **Accept** (in *Candidates*) | With a translation typed: saves as `approved`. Without: opens the pre-filled dialog. |

## Importing a glossary

*Termbase → Import glossary*: `.xlsx`, `.csv`/`.tsv` (map columns, header row optional), `.tbx` (2008 and 2019; XML entities refused).

- A check run lists rows to add, skip as duplicates, reject, with reasons. Nothing is stored until you confirm.
- Status defaults to `candidate` unless the file carries one.
- TBX import: each entry is one concept. Sheet with a *Concept* column: same; without: source term decides.
- Tested with Corpora's own exports and `docs/samples/`. Real CAT-tool exports not tried.

## Export

Termbase screen or `GET /api/terms/export?format=...&project=...&status=...`.

| Format | Notes |
|---|---|
| `tbx` | TBX 2019 (`conceptEntry / langSec / termSec`), TBX-Basic categories only. |
| `tbx2` | TBX 2008 (`termEntry / langSet / tig`), read by most CAT tools. |
| `xlsx`, `csv` | Status written as a word. Extra columns after *Project*: source and translation gender, number, note, *Concept* (round trip keeps grouping). |

- Default: `approved` and `admitted` only. Tick *include candidates* to add them.
- **TBX mapping**:
  - One entry per concept, all source terms and translations as terms of the two language sections.
  - Approved → `preferredTerm`, admitted → `admittedTerm`, superseded → `supersededTerm`, forbidden → `deprecatedTerm`. Candidates carry no `administrativeStatus` (TBX-Basic has no "proposed").
  - Gender → `grammaticalGender`; usage notes → `note`. **Number is Excel/CSV only** (no TBX-Basic category).
  - Proper noun exported as `noun` (no `properNoun` in TBX-Basic).
  - An export with no entries is invalid TBX (schema needs a concept).
- Cells starting with `=`, `+`, `-`, `@` are neutralised in CSV and Excel (text, never formulas).
- **Job glossary**: *Glossary for this job* exports only the entries found in the text (`/api/terms/export?ids=...`).

### Verification status

| Checked | Not checked |
|---|---|
| `tbx` output validates against the official TBX core RELAX NG schema (`tests/schemas/`, `tests/test_tbx_schema.py`, lxml). | Import into Trados, memoQ, Phrase, OmegaT. Try `docs/samples/termbase-sample.tbx` and `termbase-sample-tbx2.tbx` and report. |
| TBX-Basic value lists and placements (`partOfSpeech`, `administrativeStatus`, where `definition`, `context`, `subjectField` may sit) by hand-written rules from the TBX-Basic Schematron. | `tbx2` has no schema in the repo: only value lists checked. |
