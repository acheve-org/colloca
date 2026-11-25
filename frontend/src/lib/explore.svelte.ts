import { onMount, untrack } from 'svelte';
import { CORPUS_CHANGED, corpusStore } from './corpus.svelte';
import { t } from './i18n';
import { messages } from './messages.svelte';
import { route } from './router.svelte';

/** Integer from a number input (null while empty) clamped to [min, max]; `def` when unusable. */
export function toInt(v: unknown, def: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def;
}

/** Route params a screen was opened with (read once, at construction). */
export const initialParams = (): Record<string, string> => untrack(() => ({ ...route.params }));

/** The `{ref, min_freq, pos}` of the last successful Keyness run, for the word cloud. */
export const keynessMemo = $state.raw<{ last: Record<string, string | number> | null }>({ last: null });
if (typeof window !== 'undefined') {
  window.addEventListener(CORPUS_CHANGED, () => (keynessMemo.last = null));
}

interface RunnerOptions {
  /** Drops this screen's results, selection and filter (the corpus changed). */
  reset: () => void;
  /** Runs the screen once the corpus has loaded (an initial route restored the form). */
  autoRun?: boolean;
  /** The auto-run also waits for this (e.g. choices the restored form needs are loaded). */
  ready?: () => boolean;
  run: () => void;
}

/**
 * The plumbing every explore screen shares: a stale-response guard, the loading flag,
 * error reporting that keeps the previous results, the reset on `corpus-changed` and the
 * run-on-load of a restored route. Call it during component initialisation.
 */
export function useRunner(o: RunnerOptions) {
  let seq = 0;
  let loading = $state(false);
  let failed = $state(false);

  /**
   * `load` fetches for the current corpus, `apply` stores a response that is still the
   * newest (and may call `go()` to persist the options: only a run that worked reaches it). Previous results stay in place while loading and after a failure.
   */
  async function exec<T>(load: (corpusId: number) => Promise<T>, apply: (r: T, corpusId: number) => void): Promise<void> {
    const id = corpusStore.currentId;
    if (id === null) {
      messages.say(t('corpus.selectFirst'), 'err');
      return;
    }
    const n = ++seq;
    loading = true;
    failed = false;
    messages.say(t('corpus.working'));
    try {
      const r = await load(id);
      if (n !== seq) return;
      apply(r, id);
      messages.clear();
    } catch (err) {
      if (n !== seq) return;
      failed = true;
      messages.say(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      if (n === seq) loading = false;
    }
  }

  function onCorpusChanged(): void {
    seq++;
    loading = false;
    failed = false;
    messages.clearWorking();
    o.reset();
  }

  let autoRan = false;
  $effect(() => {
    if (autoRan || !o.autoRun || !corpusStore.loaded || corpusStore.currentId === null) return;
    if (o.ready && !o.ready()) return;
    autoRan = true;
    untrack(o.run);
  });

  onMount(() => {
    window.addEventListener(CORPUS_CHANGED, onCorpusChanged);
    return () => {
      window.removeEventListener(CORPUS_CHANGED, onCorpusChanged);
      seq++;
      messages.clearWorking();
    };
  });

  return {
    get loading() {
      return loading;
    },
    /** No run yet to look at: nothing loading and the last run did not fail. */
    get idle() {
      return !loading && !failed;
    },
    exec,
  };
}
