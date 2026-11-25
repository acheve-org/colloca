# The interface

Colour, contrast and screen-reader notes: [accessibility.md](accessibility.md).

## Layout

| Area | Content |
|---|---|
| Icon rail | Narrow bar on the left with four areas, plus Settings at the bottom: **Corpus** (Sources), **Explore**, **Terms** and **Job**. *Menu* (at the foot) holds the theme (Auto, Light, Dark), the language (EN, ES, IT) and *Log out* when a password is set. |
| Page header | Above the work area: the working-corpus picker, the screen title and the tabs of the current area. On the analysis screens, *Segment lookup* (aligned corpora) and *Job*, it also holds the document filter: an *All documents* / *N of M documents* pill that opens a panel (tags, text type, dates), with a removable chip for each active part. The filter persists across screens, resets when the corpus changes, and does not re-run a search. |
| Corpus picker | Shows the working corpus and its project; a dropdown lists corpora grouped by project and ends with *Manage projects…*. Hidden on *Languages* and *Projects*. |
| Tabs | **Explore**: Concordance, Collocations, N-grams, Frequency list, Dispersion plot, Keyness, Word cloud, Related terms; Equivalents and Segment lookup only for aligned corpora. **Terms**: Termbase, Candidates, Check text. **Settings**: Languages, Projects, Backup and Trash. Tabs that do not fit fold into a *More* menu; the current tab is always shown. |
| Work area | Toolbar (options) → result strip (counts, *Filter in results*) → sortable table → detail strip with actions for the selected row. |
| Sources | **Corpus** > Sources is the document list: a sortable table with a filter, a detail strip (*Edit details*, *Remove*), *+ Add documents* and *Find near-duplicates* (a dialog) above it, and the live job log. Below the table, two collapsed sections: *Corpus settings* (name, project) and, for an aligned corpus with partners, *Export aligned texts (TMX)*. An empty corpus shows four tiles (from the web, upload, paste, aligned texts) that open *Add documents*. *+ Add documents* opens its own page (`#/sources/add`); see [getting-started.md](getting-started.md#workflow). |
| Status line | Top of the window: messages, active model per language. |

- The rail labels are 10px (11px for *Menu*), not the body size, because at the small size token they clip in Spanish and Italian (*Términos*, *Impostazioni*) in the fixed 56px rail.
- First run: with an empty address and no working corpus selected, the app opens on *Projects* (or *Languages* when no language is configured). Until a language, a project and a corpus exist, every other screen (all except *Languages*, *Projects* and *Backup and Trash*) shows a three-step checklist instead: *Add a language*, *Start a project*, *Create a corpus*. Finished steps are ticked, and the current step has one button that goes to the right screen (*Add language*, *New project*, *New corpus*).
- Empty screens come in two kinds. A *quiet hint* is a title and one sentence at the top of an analysis screen that has not run yet; the run button carries a subtle ring until there is a result, and some hints offer "Try:" chips that run the analysis with one option changed (on the Frequency list: *word forms*, *only nouns*, *with stopwords*). A *guided card* is a centred dashed card with a title, a sentence and buttons, shown when there is nothing to show and a next step exists:
  - No corpus selected: *Choose a corpus* (opens *Projects*).
  - A project without corpora: *New corpus*.
  - A search with no hits (Concordance): the likely reasons, then *Clear the filter and search* when a document filter is active and *Search the exact form* after a lemma search. The word cloud offers *Clear the filter* in the same way. A filter is only cleared when you press the button.
  - An empty Termbase: *Import a glossary* and *Add terms from the Concordance*. Empty Candidates: *Open the Frequency list*.
- Small screens: below 640 px the Concordance shows one card per hit instead of the table (selecting, *Filter in results*, the detail strip and the arrow keys work the same; with *Source + target* a card shows both segments). Below 640 px the Concordance form shows the query, *Search*, *Options*, *+ Term* and *CSV*; *Options* summarises the unit, width and sort, lists the toggles that are on as chips, and opens the unit, width, sort and hits controls and the toggles in a panel (state is kept when the window crosses 640 px). Below 640 px *Projects* lists corpora as cards, each with a *⋯* menu (*Rename*, one *Move: project* entry per other project, *Delete*, which still asks for confirmation) instead of table buttons. Below 900 px *Projects* stacks: a *Change* button opens the list of projects, then the corpora of the chosen project follow below; choosing a project folds the list and puts focus back on *Change*. Wide tables scroll inside their own area, not the page.
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
