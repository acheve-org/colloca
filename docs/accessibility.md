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
- Status colours: text on the page background and on the table surface. Selected rows and cards are tinted with `--accent-soft` (with a left bar or outline, so colour is not the only cue); the text and status colours are checked on that tint too.

## Measured contrast ratios

Thresholds: 4.5:1 = AA (normal text), 7:1 = AAA. All pairs are at least AA.

<!-- contrast-table -->
| Pair | Tokens | Light | Dark |
|---|---|---|---|
| fg on bg | `--fg` on `--bg` | 14.21 (AAA) | 12.21 (AAA) |
| fg on surface | `--fg` on `--surface` | 12.88 (AAA) | 10.52 (AAA) |
| muted on surface | `--muted` on `--surface` | 5.03 (AA) | 6.02 (AA) |
| muted on bg | `--muted` on `--bg` | 5.55 (AA) | 6.99 (AA) |
| button text on accent | `--accent-fg` on `--accent` | 5.55 (AA) | 9.10 (AAA) |
| accent on bg | `--accent` on `--bg` | 5.01 (AA) | 7.79 (AAA) |
| danger on bg | `--danger` on `--bg` | 5.94 (AA) | 7.14 (AAA) |
| status-candidate on bg | `--status-candidate` on `--bg` | 5.36 (AA) | 8.82 (AAA) |
| status-approved on bg | `--status-approved` on `--bg` | 6.44 (AA) | 8.55 (AAA) |
| status-forbidden on bg | `--status-forbidden` on `--bg` | 5.94 (AA) | 7.14 (AAA) |
| status-candidate on surface | `--status-candidate` on `--surface` | 4.85 (AA) | 7.59 (AAA) |
| status-approved on surface | `--status-approved` on `--surface` | 5.84 (AA) | 7.36 (AAA) |
| status-forbidden on surface | `--status-forbidden` on `--surface` | 5.38 (AA) | 6.15 (AA) |
| danger on surface | `--danger` on `--surface` | 5.38 (AA) | 6.15 (AA) |
| accent on surface | `--accent` on `--surface` | 4.54 (AA) | 6.71 (AA) |
| fg on panel | `--fg` on `--panel` | 15.00 (AAA) | 11.27 (AAA) |
| muted on panel | `--muted` on `--panel` | 5.86 (AA) | 6.45 (AA) |
| accent on panel | `--accent` on `--panel` | 5.29 (AA) | 7.19 (AAA) |
| danger on panel | `--danger` on `--panel` | 6.27 (AA) | 6.59 (AA) |
| fg on accent-soft | `--fg` on `--accent-soft` | 13.08 (AAA) | 8.62 (AAA) |
| status-candidate on accent-soft | `--status-candidate` on `--accent-soft` | 4.93 (AA) | 6.22 (AA) |
| status-approved on accent-soft | `--status-approved` on `--accent-soft` | 5.93 (AA) | 6.03 (AA) |
| status-forbidden on accent-soft | `--status-forbidden` on `--accent-soft` | 5.47 (AA) | 5.04 (AA) |
| accent on accent-soft | `--accent` on `--accent-soft` | 4.61 (AA) | 5.50 (AA) |
| muted on accent-soft | `--muted` on `--accent-soft` | 5.11 (AA) | 4.93 (AA) |
| danger on accent-soft | `--danger` on `--accent-soft` | 5.47 (AA) | 5.04 (AA) |
| rail text on rail | `--rail-fg` on `--rail-bg` | 11.39 (AAA) | 13.49 (AAA) |
| rail muted on rail | `--rail-muted` on `--rail-bg` | 5.61 (AA) | 6.65 (AA) |
| rail text on rail hover | `--rail-fg` on `--rail-hover` | 10.03 (AAA) | 10.03 (AAA) |
| rail muted on rail hover | `--rail-muted` on `--rail-hover` | 4.95 (AA) | 4.95 (AA) |
| rail accent on rail | `--rail-accent` on `--rail-bg` | 7.66 (AAA) | 9.08 (AAA) |
| hit-query | `--hit-query-fg` on `--hit-query-bg` | 7.80 (AAA) | 6.79 (AA) |
| hit-equiv | `--hit-equiv-fg` on `--hit-equiv-bg` | 7.16 (AAA) | 7.09 (AAA) |
| hit-term | `--hit-term-fg` on `--hit-term-bg` | 8.70 (AAA) | 7.41 (AAA) |
| hit-forbidden | `--hit-forbidden-fg` on `--hit-forbidden-bg` | 7.70 (AAA) | 7.65 (AAA) |
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
