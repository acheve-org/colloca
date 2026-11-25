import type { ScreenId } from './router.svelte';

export type AreaId = 'corpus' | 'explore' | 'terms' | 'job' | 'settings';

export interface Area {
  id: AreaId;
  /** i18n key of the area name */
  label: string;
  tabs: ScreenId[];
  /** Screens of the area that are not tabs (reached from a link, with a way back). */
  extra?: ScreenId[];
  /** Placed at the foot of the rail. */
  bottom?: boolean;
}

export const AREAS: readonly Area[] = [
  { id: 'corpus', label: 'nav.group.corpus', tabs: ['sources'], extra: ['sources-add'] },
  {
    id: 'explore',
    label: 'nav.group.explore',
    tabs: [
      'concordance', 'collocations', 'ngrams', 'frequency', 'dispersion', 'keyness', 'cloud', 'related',
      'equivalents', 'lookup',
    ],
  },
  { id: 'terms', label: 'nav.group.terms', tabs: ['termbase', 'candidates', 'check'] },
  { id: 'job', label: 'nav.group.job', tabs: ['job'] },
  { id: 'settings', label: 'nav.group.settings', tabs: ['languages', 'projects', 'trash'], bottom: true },
];

/** Extra screens with a link back to the screen they come from. */
export const BACK_LINKS: Partial<Record<ScreenId, ScreenId>> = { 'sources-add': 'sources' };

/** Screens shown only when the current corpus is aligned. */
export const ALIGNED_ONLY: readonly ScreenId[] = ['equivalents', 'lookup'];

/** Screens that work without a corpus (the picker is hidden there). */
export const NO_CORPUS_SCREENS: readonly ScreenId[] = ['languages', 'projects'];

/** Screens whose results the document filter (the scope) applies to: the control is shown in the header there. */
export const SCOPE_SCREENS: readonly ScreenId[] = [
  'concordance', 'collocations', 'ngrams', 'frequency', 'dispersion', 'keyness', 'cloud', 'related',
  'equivalents', 'lookup', 'job',
];

export function areaOf(screen: ScreenId): AreaId {
  return (AREAS.find((a) => a.tabs.includes(screen) || a.extra?.includes(screen)) ?? AREAS[0]).id;
}

export function visibleTabs(area: AreaId, aligned: boolean): ScreenId[] {
  const tabs = AREAS.find((a) => a.id === area)?.tabs ?? [];
  return tabs.filter((t) => aligned || !ALIGNED_ONLY.includes(t));
}

/**
 * Indices of the tabs to show (ascending) given each tab's width, the room available and the width of the
 * "More" button. Everything is shown if it fits; otherwise room is kept for More and the active tab is
 * always shown, replacing the last one that fit (and more, if it is wider).
 */
export function fitTabs(widths: number[], available: number, active: number, moreWidth: number): number[] {
  const all = widths.map((_, i) => i);
  if (widths.reduce((a, b) => a + b, 0) <= available) return all;
  let room = available - moreWidth;
  const shown: number[] = [];
  for (const i of all) {
    if (widths[i] > room) break;
    room -= widths[i];
    shown.push(i);
  }
  if (active >= 0 && !shown.includes(active)) {
    if (shown.length) shown.pop();
    shown.push(active);
    // The swapped-in tab may be wider than the one it replaced: drop others until it fits with More.
    const total = () => shown.reduce((sum, i) => sum + widths[i], 0) + moreWidth;
    while (total() > available) {
      const drop = shown.filter((i) => i !== active).pop();
      if (drop === undefined) break;
      shown.splice(shown.indexOf(drop), 1);
    }
  }
  return shown;
}
