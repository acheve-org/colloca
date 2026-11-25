import type { ScreenId } from './router.svelte';

export type AreaId = 'corpus' | 'explore' | 'terms' | 'job' | 'settings';

export interface Area {
  id: AreaId;
  /** i18n key of the area name */
  label: string;
  tabs: ScreenId[];
  /** Placed at the foot of the rail. */
  bottom?: boolean;
}

export const AREAS: readonly Area[] = [
  { id: 'corpus', label: 'nav.group.corpus', tabs: ['sources'] },
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
  { id: 'settings', label: 'nav.group.setup', tabs: ['languages', 'projects', 'trash'], bottom: true },
];

/** Screens shown only when the current corpus is aligned. */
export const ALIGNED_ONLY: readonly ScreenId[] = ['equivalents', 'lookup'];

/** Screens that work without a corpus (the picker is hidden there). */
export const NO_CORPUS_SCREENS: readonly ScreenId[] = ['languages', 'projects'];

export function areaOf(screen: ScreenId): AreaId {
  return (AREAS.find((a) => a.tabs.includes(screen)) ?? AREAS[0]).id;
}

export function visibleTabs(area: AreaId, aligned: boolean): ScreenId[] {
  const tabs = AREAS.find((a) => a.id === area)?.tabs ?? [];
  return tabs.filter((t) => aligned || !ALIGNED_ONLY.includes(t));
}
