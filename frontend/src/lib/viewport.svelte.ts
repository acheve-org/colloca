/** Reactive viewport flags: `narrow` below 640px (concordance cards), `stacked` below 900px (stacked panes). */
const NARROW = '(max-width: 639px)';
const STACKED = '(max-width: 899px)';

const state = $state({ narrow: false, stacked: false });

function watch(query: string, set: (matches: boolean) => void): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const mq = window.matchMedia(query);
  set(mq.matches);
  mq.addEventListener?.('change', (e) => set(e.matches));
}

watch(NARROW, (m) => (state.narrow = m));
watch(STACKED, (m) => (state.stacked = m));

export const viewport: { readonly narrow: boolean; readonly stacked: boolean } = {
  get narrow() {
    return state.narrow;
  },
  get stacked() {
    return state.stacked;
  },
};

/** Test hook: override the flags. */
export function __setViewportForTests(patch: { narrow?: boolean; stacked?: boolean }): void {
  if (patch.narrow !== undefined) state.narrow = patch.narrow;
  if (patch.stacked !== undefined) state.stacked = patch.stacked;
}
