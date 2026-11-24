# Accessibility: colour, contrast and language

- Colours are tokens in `frontend/src/lib/styles/tokens.css`, for light and dark themes (Auto follows the system).
- `frontend/tests/contrast.test.ts` checks every pair below against WCAG 2.1 and **fails the build if any text pair is under 4.5:1** (AA).
- This page's table is generated. After changing a colour:

```bash
cd frontend && UPDATE_DOCS=1 npx vitest run contrast
```

- Commit the updated table. The test fails if the table and `tokens.css` disagree.

## What each colour means

| Meaning | Token family | Non-colour cue (so colour is never the only signal) |
|---|---|---|
| The word you searched for (query hit) | `--hit-query-*` | **bold** |
| Likely equivalent in the aligned text (a statistical guess) | `--hit-equiv-*` | **dotted underline** and a "guess" label |
| Term from the termbase | `--hit-term-*` | **solid underline**; the approved translation in the tooltip |
| Forbidden translation | `--hit-forbidden-*` | **strike-through** and a ⚠ sign before the word |
| Candidate / approved / admitted / superseded / forbidden entry | `--status-*` and badges | the **status word** is always written; admitted has a dashed border, superseded is italic, forbidden is struck through |

- Hit colours: background + text colour, always used together; each pair is measured.
- Status colours: text on the page background and on the table surface. Selected rows put the badge on a surface pill, so the ratio holds.

## Measured contrast ratios

Thresholds: 4.5:1 = AA (normal text), 7:1 = AAA. All pairs are at least AA.

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

- English, Spanish, Italian. First visit uses the first of `navigator.languages` that Colloca supports, else English.
- The **Language** switch (`EN`, `ES`, `IT`, each named in itself) changes it at once; stored in `localStorage` key `colloca.lang`.
- The page `lang` attribute follows the choice, so screen readers pick the right voice.
- Tables sort and numbers format by that language (`1.234,5` in Spanish and Italian).
- Not translated: server messages (errors, language-check wording, job progress), file format names, your data.
- POS tags such as `NOUN` are universal tags used by the query language and stay as is.
- Working on the catalogues: README, *Frontend*.

## Keyboard and screen readers

- Every action has a keyboard path ([shortcuts](interface.md#keyboard); remappable).
- Tables are real tables with sortable header buttons.
- Dialogs are native modals: focus stays inside, Esc closes.
- Status messages and the document summary use live regions.
