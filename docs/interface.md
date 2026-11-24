# The interface

Colour, contrast and screen-reader notes: [accessibility.md](accessibility.md).

## Layout

| Area | Content |
|---|---|
| Left rail | Working-context block: corpus, project, language badge, a *Change* link to *Projects* and a quick switch to another corpus (grouped by project). |
| Rail groups | **Setup** (Languages, Projects) · **Corpus** (Sources) · **Explore** (Concordance, Collocations, N-grams, Frequency list, Dispersion plot, Keyness, Word cloud, Related terms; Equivalents and Segment lookup for aligned corpora) · **Terms** (Termbase, Candidates, Check text) · **Job** · **Data** (Backup and Trash). |
| Rail foot | Theme (Auto, Light, Dark), language (EN, ES, IT), *Log out* when a password is set. |
| Context bar | Breadcrumb above work screens: language › project › corpus (each links to *Languages* or *Projects*). Hidden on *Languages* and *Projects*. |
| Work area | Toolbar (options, document filter) → result strip (counts, *Filter in results*) → sortable table → detail strip with actions for the selected row. |
| Status line | Top of the window: messages, active model per language. |

- First run: with an empty address and no working corpus selected, the app opens on *Projects* (or *Languages* when no language is configured). A deep link opens its screen with a "set up first" message instead; empty screens point to the next step.
- Creating, renaming, moving and deleting corpora and projects is done on *Projects*.
- Screen and options live in the address (`#/concordance?q=...`): reload and bookmarks restore the search; the rail returns each screen to its last search.
- Back/forward between searches on one screen changes the address without re-running the search.
- The Job report stays while you visit other screens (a running analysis continues) until you change corpus.

## Keyboard

| Key | Action |
|---|---|
| `/`, Ctrl/Cmd+K | Go to Concordance, focus query (filled with a short selection). Off while a dialog is open. |
| ↑ ↓, PageUp/PageDown, Home/End | Move through rows of a focused table. |
| Enter | Open the selected row (edit document or term). |
| Ctrl/Cmd+E | Add the selected concordance hit or selected text as a term. |
| A / D | *Candidates*: accept / drop (or restore) the selected row. |
| 1–9 | Term dialog: use the matching example sentence. |
| Esc | Close a dialog. |
| ? | List shortcuts. |

- Plain-key shortcuts are off while typing in a field.
- Remap in the **?** overlay: select a key, press the new one (Esc cancels). Stored in `localStorage` key `colloca.keys`. *Restore default keys* resets.
- Buttons show their key in the tooltip.

## Interface language

- English, Spanish, Italian. First visit follows the browser language.
- **EN / ES / IT** switch changes it at once, no reload; choice stored in the browser.
- Tables sort and numbers format by the chosen language.
- Not translated: server messages (errors, language-check wording, job progress) and your data.
