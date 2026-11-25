import { AREAS, areaOf, type AreaId } from './nav';

export type ScreenId =
  | 'sources'
  | 'sources-add'
  | 'languages'
  | 'projects'
  | 'concordance'
  | 'collocations'
  | 'ngrams'
  | 'frequency'
  | 'dispersion'
  | 'keyness'
  | 'cloud'
  | 'equivalents'
  | 'lookup'
  | 'related'
  | 'termbase'
  | 'candidates'
  | 'check'
  | 'job'
  | 'trash';

export const SCREENS: readonly ScreenId[] = [
  'sources', 'sources-add', 'languages', 'projects', 'concordance', 'collocations', 'ngrams', 'frequency',
  'dispersion', 'keyness', 'cloud', 'equivalents', 'lookup', 'related', 'termbase', 'candidates', 'check', 'job', 'trash',
];

function parse(hash: string): { screen: ScreenId; params: Record<string, string> } {
  const m = hash.replace(/^#\/?/, '');
  const q = m.indexOf('?');
  const name = q < 0 ? m : m.slice(0, q);
  const query = q < 0 ? '' : m.slice(q + 1);
  const wanted = name === 'base' ? 'languages' : name === 'sources/add' ? 'sources-add' : name; // the old Base corpora address
  const screen = (SCREENS as readonly string[]).includes(wanted) ? (wanted as ScreenId) : 'sources';
  return { screen, params: Object.fromEntries(new URLSearchParams(query)) };
}

/** `#/screen?params`, empty params left out. */
export function hrefFor(screen: ScreenId, params: Record<string, string> = {}): string {
  const q = Object.entries(params)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `#/${screen === 'sources-add' ? 'sources/add' : screen}${q ? `?${q}` : ''}`;
}

const isTab = (screen: ScreenId): boolean => AREAS.some((a) => a.tabs.includes(screen));

const initial = parse(window.location.hash);

export const route = $state<{ screen: ScreenId; params: Record<string, string> }>({
  screen: initial.screen,
  params: initial.params,
});

// The params each screen was last shown with (in memory), so the rail can bring a screen
// back as it was left: its autoRun then restores the search.
const lastParams = $state<Partial<Record<ScreenId, Record<string, string>>>>({
  [initial.screen]: initial.params,
});

// The screen last shown in each area (in memory); an unvisited area starts at its first tab.
const lastScreen = $state<Record<AreaId, ScreenId>>(
  Object.fromEntries(AREAS.map((a) => [a.id, a.tabs[0]])) as Record<AreaId, ScreenId>,
);
if (isTab(initial.screen)) lastScreen[areaOf(initial.screen)] = initial.screen;

function sync(): void {
  const r = parse(window.location.hash);
  route.screen = r.screen;
  route.params = r.params;
  lastParams[r.screen] = r.params;
  if (isTab(r.screen)) lastScreen[areaOf(r.screen)] = r.screen;
}

window.addEventListener('hashchange', sync);

export function go(screen: ScreenId, params: Record<string, string> = {}): void {
  window.location.hash = hrefFor(screen, params);
  sync();
}

/** The rail link of a screen: with the params it was last shown with, if any. */
export const screenHref = (screen: ScreenId): string => hrefFor(screen, lastParams[screen] ?? {});

/** The rail link of an area: its last screen, with the params that screen was last shown with. */
export const areaHref = (area: AreaId): string => screenHref(lastScreen[area]);
