import { languageCount, languagesFailed, languagesLoaded } from './context.svelte';
import { corpusStore } from './corpus.svelte';
import { projectStore } from './projects.svelte';
import { go } from './router.svelte';

/** The first unmet first-run step. */
export type SetupStep = 'language' | 'project' | 'corpus';

/** True once languages, projects and corpora have all been fetched (nothing to decide before). */
export const setupReady = (): boolean => corpusStore.loaded && projectStore.loaded && languagesLoaded();

/** True when any of the three loads failed: no first-run claim is made then (the error toast says why). */
export const setupFailed = (): boolean => corpusStore.failed || projectStore.failed || languagesFailed();

/** The first unfinished step, or null when a working corpus is selected. Only meaningful when `setupReady()`. */
export function setupStep(): SetupStep | null {
  if (setupFailed()) return null;
  const cur = corpusStore.current;
  const hasWorking = corpusStore.list.some((c) => !c.is_reference);
  if (cur && (!cur.is_reference || hasWorking)) return null;
  if (languageCount() === 0) return 'language';
  if (projectStore.list.length === 0) return 'project';
  return 'corpus';
}

/**
 * The initial redirect: returns a function that, once the stores have loaded and the hash is
 * still empty, goes to the first unfinished step. It acts at most once (true when it did),
 * so it never fights a later navigation.
 */
export function redirectOnce(): () => boolean {
  let done = false;
  return () => {
    if (done || !setupReady()) return false;
    done = true;
    if (window.location.hash.replace(/^#\/?/, '') !== '') return false;
    if (setupFailed()) return false;
    const step = setupStep();
    if (!step) return false;
    go(step === 'language' ? 'languages' : 'projects');
    return true;
  };
}
