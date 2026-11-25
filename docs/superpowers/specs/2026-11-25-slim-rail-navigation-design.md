# Slim rail navigation: design

Status: approved by the user on 2026-11-25 after reviewing the interactive prototype (one change: Settings tab order). Date: 2026-11-25.

## Intent and why

The left rail lists 18 destinations in 7 groups (Explore alone has up to 10 items). It has no hierarchy between daily tools and one-time setup, it takes 200px of width on every screen, it does not work on narrow screens (at 390px it uses about 40% of the width, and the Projects table clips at 800px), and no screen has a title. The working corpus, which decides what every screen shows, is a small block at the top of the rail.

Goal: make it quick to see where you are and which corpus you are working in, give the daily tools room, and make the app usable on small screens, without slowing down expert use.

## Goals

- A slim icon rail with one entry per **area**; the screens of an area become **tabs** across the top of the page.
- A **page header** on every screen: the corpus picker (project › corpus, language badge) and the area/screen title.
- The corpus picker is always visible and switches corpus from any screen.
- Works from phone width up with no horizontal clipping of the shell.
- Existing URLs, shortcuts and screen behaviour keep working.

## Non-goals

- No visual refresh (colors, type scale, spacing tokens stay as they are; that is the next piece of work).
- No changes to screen content (filters, tables, Sources forms).
- No new routes or route renames; `#/concordance?...` and the rest stay valid.
- No command palette in this change (option C was not chosen).

## Anti-goals

- Experts must not need more clicks than today to reach a screen (one click from the rail to an area, one to a tab).
- Icons must not be a guessing game: no icon-only entries without a visible text label.

## Approaches considered

- **A. Grouped rail, setup at the bottom.** Smallest change, but keeps the 200px rail and the narrow-screen problem. Not chosen.
- **B. Slim icon rail plus section tabs.** Most room for results, works on narrow screens, keeps related analyses one click apart. **Chosen by the user.**
- **C. Top bar and command palette.** Fastest for experts, but the biggest change and the least discoverable. Not chosen.

## Design (my calls are marked)

**Areas and tabs** (my call: the grouping follows today's groups, with setup moved last):

| Rail entry | Tabs |
|---|---|
| Corpus | Sources (single screen: no tab strip) |
| Explore | Concordance, Collocations, N-grams, Frequency list, Dispersion plot, Keyness, Word cloud, Related terms; Equivalents and Segment lookup when the corpus is aligned |
| Terms | Termbase, Candidates, Check text |
| Job | Job (single screen) |
| Settings (bottom of the rail) | Languages, Projects, Backup and Trash (in this order, set by the user) |

**Rail** (my call): about 56px wide; each entry is an icon with a short text label under it, a tooltip, and an accessible name. The foot holds one entry that opens a small menu with the theme (Auto/Light/Dark), the interface language (EN/ES/IT) and Log out when a password is set. This replaces the three foot rows. Clicking an area returns to the screen last used in it, with its last search (reuses the existing last-params behaviour).

**Page header** (my call): top row has the corpus picker on the left: a dropdown button showing `Corpus name · LANG`, with the project name next to it; its menu lists corpora grouped by project plus "Manage projects…". Under it, the page title (the area name; the screen name where there are tabs) and the tab strip. If the tabs do not fit, the extra ones go into a "More" menu rather than scrolling. Areas with a single screen (Corpus, Job) show the title and no tab strip.

**Screens without a corpus** (Projects, Languages): the corpus picker is hidden, as the breadcrumb is today.

**Narrow screens** (my call): the 56px rail stays; the page content gets the rest. At every width, tabs that do not fit fold into the "More" menu and the active tab is always shown (as in the approved prototype); tables keep their own scrolling. No separate mobile layout.

**Picker menu** (my call, a change from the prototype): the app only knows whether the *current* corpus is aligned, so the "aligned" badge shows on the picker button only, not next to each corpus in the menu. Base (reference) corpora are left out of the menu, as on Projects.

**Status line**: unchanged, above the header.

**Routing**: `ScreenId`, hash routes and the `base` alias are unchanged; a new mapping from screen to area drives the rail highlight and the tab strip. The rule that leaves a screen whose item is hidden (Equivalents, Segment lookup) is kept.

**Parts of the code touched**: `Rail.svelte` (becomes the slim rail; `NAV` becomes areas with tabs), `AppShell.svelte` (grid column and header), `ContextBlock.svelte` (replaced by the corpus picker), new header and tab components under `frontend/src/lib/ui/`, `i18n` strings, `docs/interface.md`, and tests that click rail links (`frontend/e2e`, `frontend/tests`).

## Left to the builder

- Icon set and the exact icons (simple inline SVG, no new dependency unless one is already used).
- Breakpoints and the exact overflow behaviour of the tab strip.
- Focus order and ARIA: keep the `navigation` landmark names so tests can still find links by name; add a second landmark label for the tab strip.
- Updating the e2e and unit tests and the contrast checks for any new surfaces.
