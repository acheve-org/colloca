export type ScreenId =
  | 'sources'
  | 'languages'
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
  'sources', 'languages', 'concordance', 'collocations', 'ngrams', 'frequency',
  'dispersion', 'keyness', 'cloud', 'equivalents', 'lookup', 'related', 'termbase', 'candidates', 'check', 'job', 'trash',
];

function parse(hash: string): { screen: ScreenId; params: Record<string, string> } {
  const m = hash.replace(/^#\/?/, '');
  const q = m.indexOf('?');
  const name = q < 0 ? m : m.slice(0, q);
  const query = q < 0 ? '' : m.slice(q + 1);
  const wanted = name === 'base' ? 'languages' : name; // the old Base corpora address
  const screen = (SCREENS as readonly string[]).includes(wanted) ? (wanted as ScreenId) : 'sources';
  return { screen, params: Object.fromEntries(new URLSearchParams(query)) };
}

/** `#/screen?params`, empty params left out. */
function hashFor(screen: ScreenId, params: Record<string, string>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `#/${screen}${q ? `?${q}` : ''}`;
}

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

function sync(): void {
  const r = parse(window.location.hash);
  route.screen = r.screen;
  route.params = r.params;
  lastParams[r.screen] = r.params;
}

window.addEventListener('hashchange', sync);

export function go(screen: ScreenId, params: Record<string, string> = {}): void {
  window.location.hash = hashFor(screen, params);
  sync();
}

/** The rail link of a screen: with the params it was last shown with, if any. */
export const screenHref = (screen: ScreenId): string => hashFor(screen, lastParams[screen] ?? {});
