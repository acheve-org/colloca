# Accessibility: colour, contrast and language

Colloca's colours are defined once, as tokens in `frontend/src/lib/styles/tokens.css`, for a light and a dark theme
(Auto follows the system, or choose Light or Dark in the rail). A unit test (`frontend/tests/contrast.test.ts`) checks
every pair listed below against WCAG 2.1 and **fails the build if any text pair drops under 4.5:1** (level AA for normal
text). This page is generated from the same numbers: after changing a colour, run

```bash
cd frontend && UPDATE_DOCS=1 npx vitest run contrast
```

and commit the updated table. The test fails if the table and `tokens.css` disagree.

## What each colour means

| Meaning | Token family | Non-colour cue (so colour is never the only signal) |
|---|---|---|
| The word you searched for (query hit) | `--hit-query-*` | **bold** |
| Likely equivalent in the aligned text (a statistical guess) | `--hit-equiv-*` | **dotted underline** and a "guess" label |
| Term from the termbase | `--hit-term-*` | **solid underline**; the approved translation in the tooltip |
| Forbidden translation | `--hit-forbidden-*` | **strike-through** and a ⚠ sign before the word |
| Candidate / approved / admitted / superseded / forbidden entry | `--status-*` and badges | the **status word** is always written; admitted has a dashed border, superseded is italic, forbidden is struck through |

Hit colours are a background and a text colour that are always used together, so each pair is measured against itself.
Status colours are text on the page background and on the table surface (selected rows put the badge on a surface pill so the
ratio holds there too).

## Measured contrast ratios

WCAG thresholds: 4.5:1 is AA for normal text, 7:1 is AAA. Everything below is at least AA.

<!-- contrast-table -->
| Pair | Tokens | Light | Dark |
|---|---|---|---|
| fg on bg | `--fg` on `--bg` | 15.73 (AAA) | 14.49 (AAA) |
| fg on surface | `--fg` on `--surface` | 14.67 (AAA) | 13.33 (AAA) |
| muted on surface | `--muted` on `--surface` | 5.73 (AA) | 6.57 (AA) |
| muted on bg | `--muted` on `--bg` | 6.14 (AA) | 7.14 (AAA) |
| button text on accent | `--accent-fg` on `--accent` | 6.09 (AA) | 7.30 (AAA) |
| accent on bg | `--accent` on `--bg` | 6.09 (AA) | 7.00 (AA) |
| danger on bg | `--danger` on `--bg` | 6.57 (AA) | 7.87 (AAA) |
| status-candidate on bg | `--status-candidate` on `--bg` | 5.93 (AA) | 10.05 (AAA) |
| status-approved on bg | `--status-approved` on `--bg` | 7.13 (AAA) | 9.47 (AAA) |
| status-forbidden on bg | `--status-forbidden` on `--bg` | 6.57 (AA) | 7.87 (AAA) |
| status-candidate on surface | `--status-candidate` on `--surface` | 5.53 (AA) | 9.25 (AAA) |
| status-approved on surface | `--status-approved` on `--surface` | 6.65 (AA) | 8.72 (AAA) |
| status-forbidden on surface | `--status-forbidden` on `--surface` | 6.13 (AA) | 7.24 (AAA) |
| danger on surface | `--danger` on `--surface` | 6.13 (AA) | 7.24 (AAA) |
| accent on surface | `--accent` on `--surface` | 5.68 (AA) | 6.44 (AA) |
| rail text on rail | `--rail-fg` on `--rail-bg` | 12.52 (AAA) | 12.52 (AAA) |
| rail muted on rail | `--rail-muted` on `--rail-bg` | 6.17 (AA) | 6.17 (AA) |
| rail text on rail hover | `--rail-fg` on `--rail-hover` | 10.03 (AAA) | 10.03 (AAA) |
| rail muted on rail hover | `--rail-muted` on `--rail-hover` | 4.95 (AA) | 4.95 (AA) |
| rail accent on rail | `--rail-accent` on `--rail-bg` | 6.05 (AA) | 6.05 (AA) |
| hit-query | `--hit-query-fg` on `--hit-query-bg` | 8.27 (AAA) | 8.38 (AAA) |
| hit-equiv | `--hit-equiv-fg` on `--hit-equiv-bg` | 7.16 (AAA) | 8.12 (AAA) |
| hit-term | `--hit-term-fg` on `--hit-term-bg` | 8.70 (AAA) | 8.12 (AAA) |
| hit-forbidden | `--hit-forbidden-fg` on `--hit-forbidden-bg` | 7.70 (AAA) | 8.23 (AAA) |
<!-- contrast-table -->

## Interface language

The interface is available in English, Spanish and Italian. The first visit follows the browser language (the first of
`navigator.languages` that Colloca supports, else English); the **Language** switch at the bottom of the left rail
(`EN`, `ES`, `IT`; each language is named in itself) changes it at once, without reloading data, and remembers the choice in
the browser (`localStorage`, key `colloca.lang`). The page's `lang` attribute follows the choice, so screen readers pick the right
voice, and tables sort and numbers are written by the rules of that language (`1.234,5` in Spanish and Italian).

What is **not** translated: text that comes from the server (error messages, the language-check wording of an import, job
progress), the names of file formats, and the data itself (your documents, terms, tags). Part-of-speech tags such as `NOUN`
are the universal tags used in the query language and stay as they are.

How to work on the catalogues is in the README ("Interface language").

## Keyboard and screen readers

Everything has a keyboard path (see the `?` overlay for the list; the keys can be changed). Tables are real tables with
sortable header buttons; dialogs are native modal dialogs (focus stays inside, Esc closes); status messages and the
document summary are announced through live regions.
