export type ScreenId =
  | 'sources'
  | 'base'
  | 'concordance'
  | 'collocations'
  | 'ngrams'
  | 'frequency'
  | 'keyness'
  | 'cloud'
  | 'equivalents'
  | 'termbase'
  | 'job';

export const SCREENS: readonly ScreenId[] = [
  'sources', 'base', 'concordance', 'collocations', 'ngrams', 'frequency',
  'keyness', 'cloud', 'equivalents', 'termbase', 'job',
];

function parse(hash: string): { screen: ScreenId; params: Record<string, string> } {
  const m = hash.replace(/^#\/?/, '');
  const [name, query = ''] = m.split('?', 2);
  const screen = (SCREENS as readonly string[]).includes(name) ? (name as ScreenId) : 'sources';
  return { screen, params: Object.fromEntries(new URLSearchParams(query)) };
}

export const route = $state<{ screen: ScreenId; params: Record<string, string> }>(
  parse(window.location.hash),
);

function sync(): void {
  const r = parse(window.location.hash);
  route.screen = r.screen;
  route.params = r.params;
}

window.addEventListener('hashchange', sync);

export function go(screen: ScreenId, params: Record<string, string> = {}): void {
  const q = Object.entries(params)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  window.location.hash = `#/${screen}${q ? `?${q}` : ''}`;
  sync();
}
