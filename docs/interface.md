# The interface

Colour, contrast and screen-reader notes: [accessibility.md](accessibility.md).

## Layout

| Area | Content |
|---|---|
| Icon rail | Narrow bar on the left with five areas: **Corpus** (Sources), **Explore**, **Terms** and **Job**, with **Settings** at the bottom. *Menu* (at the foot) holds the theme (Auto, Light, Dark), the language (EN, ES, IT) and *Log out* when a password is set. |
| Page header | Above the work area: the working-corpus picker, the screen title and the tabs of the current area. |
| Corpus picker | Shows the working corpus and its project; a dropdown lists corpora grouped by project and ends with *Manage projects…*. Hidden on *Languages* and *Projects*. |
| Tabs | **Explore**: Concordance, Collocations, N-grams, Frequency list, Dispersion plot, Keyness, Word cloud, Related terms; Equivalents and Segment lookup only for aligned corpora. **Terms**: Termbase, Candidates, Check text. **Settings**: Languages, Projects, Backup and Trash. Tabs that do not fit fold into a *More* menu; the current tab is always shown. |
| Work area | Toolbar (options, document filter) → result strip (counts, *Filter in results*) → sortable table → detail strip with actions for the selected row. |
| Status line | Top of the window: messages, active model per language. |

- First run: with an empty address and no working corpus selected, the app opens on *Projects* (or *Languages* when no language is configured). A deep link opens its screen with an empty-state message instead; empty screens point to the next step ("Add your first language", "Start your first project", "Create a corpus").
- Choosing an area in the rail opens the screen last used in it.
- Creating, renaming, moving and deleting corpora and projects is done on *Projects*.
- Screen and options live in the address (`#/concordance?q=...`): reload and bookmarks restore the search; the rail and tabs return each screen to its last search.
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
