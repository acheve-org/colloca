# The interface

Colour, contrast and screen-reader notes: [accessibility.md](accessibility.md).

## Layout

| Area | Content |
|---|---|
| Icon rail | Narrow bar on the left: the Corpora logo at the top, then four areas, plus Settings at the bottom: **Corpus** (Sources), **Explore**, **Terms** and **Job**. *Menu* (at the foot) holds the theme (Auto, Light, Dark), the language (EN, ES, IT) and *Log out* when a password is set. |
| Page header | Above the work area: the context header, then the tabs of the current area. The screen title is not shown (screen readers still get one heading per screen); on *Add documents* a back link to Sources takes the place of the tabs. On the analysis screens, *Segment lookup* (aligned corpora) and *Job*, the right of the context header holds the document filter: an *All documents* / *N of M documents* pill that opens a panel under it (tags, text type, dates), with a removable chip for each active part. The filter persists across screens, resets when the corpus changes, and does not re-run a search. |
| Context header | A band on every screen, *Working in*: the project (or *No project*), the working corpus in large type, its language code and *Aligned* when it has partners. A gear (*Change corpus or project*) opens *Projects* on the working corpus's project, where *Open* switches corpus; on *Projects* the gear is highlighted. With no corpus it reads *No corpus selected* with a *Choose a corpus* link instead of the gear. |
| Tabs | **Explore**: Concordance, Collocations, N-grams, Frequency list, Dispersion plot, Keyness, Word cloud, Related terms; Equivalents and Segment lookup only for aligned corpora. **Terms**: Termbase, Candidates, Check text. **Settings**: Languages, Projects, Backup and Trash. Tabs that do not fit fold into a *More* menu; the current tab is always shown. |
| Work area | Toolbar (options) → result strip (counts, *Filter in results*) → sortable table → detail strip with actions for the selected row. |
| Sources | **Corpus** > Sources is the document list. One toolbar line (it wraps when narrow): the count (*N documents*), the corpus size pill (*182k words · workable*; it opens the readiness list, see [getting-started.md](getting-started.md)), *Filter in results*, then on the right *Re-annotate with current model* (only when documents use an older model), *Find near-duplicates* (a dialog), *Export TMX* (only for an aligned corpus with partners; a dialog), a *More* menu (*Reload*) and *+ Add documents*. Corpus name and project are edited on *Projects*, not here. Below, the live job log and a sortable table that fills the width (no sideways scroll from 640 px). Selecting a row opens a side panel named after the document: its details, *Read*, *Edit details* and *More actions for …* (*Re-annotate all outdated* when the document uses an older model, *Remove*); Escape in the table or × closes it. Double-click or Enter on a row opens *Edit details*. An empty corpus shows four tiles (from the web, upload, paste, aligned texts) that open *Add documents*. *+ Add documents* opens its own page (`#/sources/add`); see [getting-started.md](getting-started.md#workflow). |
| Document reader | *Read* in the side panel opens the whole document on its own page (`#/sources/read?doc=<id>`): a back link (*← Documents*), the title, a line with type, date, words and source, *Edit details*, and *Find in document*. The text sits in a reading column (72 characters wide at most); an aligned document shows numbered pairs, source and translation side by side (stacked below 640 px). Pages of 100 paragraphs or pairs load as you scroll; if one fails, *Retry* loads it again. *Find in document* highlights every match in the loaded text and shows *N of M* (or *No matches*); Enter goes to the next match, Shift+Enter to the previous one. |
| Projects | **Settings** > Projects is a list and a panel. The list (left, 280 px) names each project with its corpus count, plus *No project* when some corpora have none; the chosen project is marked, and *+ New project* opens a dialog. The panel shows the chosen project: its name as the heading with ✎ (*Rename project*, renamed in place: Enter saves, Escape cancels), *New corpus*, and a *⋯* menu (*Project actions*) with *Delete project…*. Below, a table of its corpora (name, language, documents, words): the working corpus has a *Current* badge, the others an *Open* button that switches to them. Clicking a row (or Enter or Space on it) opens *Corpus settings*, a side panel with the name, the project, the language and size, *Save* and *Delete corpus…* (which asks first); Escape or × closes it and returns focus to the row. Saving a new project shows that project with the corpus still selected. The list and the panel scroll separately. |
| Languages | **Settings** > Languages is a list and a panel, like *Projects*. The list names each language with its code and three status dots (*Model*, *OCR*, *Base corpus*), each with its label and a shape per state (disc installed, half disc installing, crossed disc failed, ring missing); *+ Add language* opens the catalog and selects the language you add. The panel shows the chosen language: its name as the heading, its code, *Used by N corpora*, *Edit* and a *⋯* menu (*Language actions*) with *Remove* (unavailable while corpora use the language, with a line saying why), then the *Language model*, *OCR data* and *Base corpus* sections; *Import even if the language looks wrong* (the language-check override for base-corpus uploads) is in *Base corpus*. See [languages.md](languages.md). |
| Status bar | Along the bottom, beside the rail: the latest message on the left, running jobs with a progress bar on the right. Confirmations and notes fade after 6 seconds; errors stay until replaced or dismissed with their × (*Dismiss message*), which returns focus to the work area. A thin accent bar slides along the top edge, above the context header, while a request is loading. |

- The rail labels are 10px (11px for *Menu*), not the body size, because at the small size token they clip in Spanish and Italian (*Términos*, *Impostazioni*) in the fixed 56px rail.
- First run: with an empty address and no working corpus selected, the app opens on *Projects* (or *Languages* when no language is configured). Until a language, a project and a corpus exist, every other screen (all except *Languages*, *Projects* and *Backup and Trash*) shows a three-step checklist instead: *Add a language*, *Start a project*, *Create a corpus*. Finished steps are ticked, and the current step has one button that goes to the right screen (*Add language*, *New project*, *New corpus*).
- Empty screens come in two kinds. A *quiet hint* is a title and one sentence at the top of an analysis screen that has not run yet; the run button carries a subtle ring until there is a result, and some hints offer "Try:" chips that run the analysis with one option changed (on the Frequency list: *word forms*, *only nouns*, *with stopwords*). A *guided card* is a centred dashed card with a title, a sentence and buttons, shown when there is nothing to show and a next step exists:
  - No corpus selected: *Choose a corpus* (opens *Projects*).
  - A project without corpora: *New corpus*.
  - A search with no hits (Concordance): the likely reasons, then *Clear the filter and search* when a document filter is active and *Search the exact form* after a lemma search. The word cloud offers *Clear the filter* in the same way. A filter is only cleared when you press the button.
  - An empty Termbase: *Import a glossary* and *Add terms from the Concordance*. Empty Candidates: *Open the Frequency list*.
- Small screens: below 640 px the Concordance shows one card per hit instead of the table (selecting, *Filter in results*, the detail strip and the arrow keys work the same; with *Source + target* a card shows both segments). Below 640 px the Concordance form shows the query, *Search*, *Options*, *+ Term* and *CSV*; *Options* summarises the unit, width and sort, lists the toggles that are on as chips, and opens the unit, width, sort and hits controls and the toggles in a panel (state is kept when the window crosses 640 px). Side panels (*Corpus settings* on Projects, the document panel on Sources) sit beside the table from 1280 px, float over the right edge of the page between 640 and 1280 px, and cover the page below 640 px. Below 900 px *Projects* and *Languages* show their list first; choosing a project or a language shows its panel in its place with a *Back* button, which returns to the list with focus on that entry. Below 640 px *Projects* lists corpora as cards (name, language, size, *Current* or *Open*); the name opens *Corpus settings*. Wide tables scroll inside their own area, not the page.
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
- Remap in the **?** overlay: select a key, press the new one (Esc cancels). Stored in `localStorage` key `corpora.keys`. *Restore default keys* resets.
- Buttons show their key in the tooltip.

## Interface language

- English, Spanish, Italian. First visit follows the browser language.
- **EN / ES / IT** switch changes it at once, no reload; choice stored in the browser.
- Tables sort and numbers format by the chosen language.
- Not translated: server messages (errors, language-check wording, job progress) and your data.
