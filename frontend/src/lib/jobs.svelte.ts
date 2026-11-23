import { untrack } from 'svelte';
import { get } from './api';
import { corpusStore } from './corpus.svelte';
import { messages } from './messages.svelte';
import type { Job } from './types';

const POLL_MS = 1000;

/** Background jobs across every active watcher, for the progress strip in StatusLine. */
export const jobs = $state<{ running: number; progress: number }>({ running: 0, progress: 0 });

// Active jobs per live watcher; `jobs` is recomputed from it (plain map: not read reactively).
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, `jobs` is the state
const active = new Map<number, Job[]>();
let nextWatcher = 0;

function publish(): void {
  const all = [...active.values()].flat();
  jobs.running = all.length;
  jobs.progress = all.length ? all.reduce((s, j) => s + (j.progress || 0), 0) / all.length : 0;
}

export const isActive = (j: Job) => j.status === 'queued' || j.status === 'running';

export interface WatchOptions {
  /** A job was just submitted: finding none active on the first poll still means it finished. */
  started?: boolean;
  /** Every poll's full job list (finished ones included), for a per-screen job log. */
  onUpdate?: (list: Job[]) => void;
  /** Called when the watcher stops by itself (nothing left to run, or polling failed). */
  onStop?: () => void;
}

/**
 * Polls `/api/corpora/{id}/jobs` every second while any job there is queued or running.
 * `onDone` is called once, when the jobs that were running have all finished; polling then
 * stops. Returns a stop function (call it on unmount): it cancels the timer and ignores a
 * response still in flight.
 */
export function watchJobs(corpusId: number, onDone: () => void, opts: WatchOptions = {}): () => void {
  const wid = ++nextWatcher;
  let stopped = false;
  let seen = !!opts.started;
  let retried = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stop(): void {
    stopped = true;
    clearTimeout(timer);
    timer = undefined;
    if (active.delete(wid)) publish();
  }

  async function poll(): Promise<void> {
    timer = undefined;
    let list: Job[];
    try {
      list = await get<Job[]>(`/api/corpora/${corpusId}/jobs`);
    } catch (err) {
      if (stopped) return;
      // One retry before giving up: a single failed poll is often a blip.
      if (!retried) {
        retried = true;
        timer = setTimeout(poll, POLL_MS);
        return;
      }
      stop();
      opts.onStop?.();
      messages.say(err instanceof Error ? err.message : String(err), 'err');
      return;
    }
    if (stopped) return;
    retried = false;
    const running = list.filter(isActive);
    active.set(wid, running);
    publish();
    opts.onUpdate?.(list);
    if (running.length) {
      seen = true;
      timer = setTimeout(poll, POLL_MS);
      return;
    }
    stop();
    opts.onStop?.();
    if (seen) onDone();
  }

  poll();
  return stop;
}

// ------------------------------------------------------------------ app-level tracking
/**
 * Fired on window when the tracked jobs of a corpus have finished; `detail.id` is the corpus.
 * Screens refresh their own tables on it; `corpusStore` has already been told to reload.
 */
export const JOBS_DONE = 'jobs-done';

/** The last job list seen per tracked corpus, for the job logs of Sources and Base corpora. */
export const jobLogs = $state<{ by: Record<number, Job[]> }>({ by: {} });

// One live watcher per corpus, owned by this module so it survives screen changes.
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- stop functions, not state
const tracked = new Map<number, () => void>();

/**
 * Follows the jobs of a corpus independently of any screen: the StatusLine strip keeps
 * counting them and, when they finish, `corpusStore` reloads (doc counts, aligned flag) and
 * JOBS_DONE is fired. A corpus already being followed is not polled twice; pass
 * `started` right after submitting a job so a job that finished before the first poll counts.
 */
export function trackJobs(corpusId: number, started = false): void {
  const live = tracked.get(corpusId);
  if (live) {
    if (!started) return;
    live();
  }
  const stop = watchJobs(
    corpusId,
    () => {
      corpusStore.reload().catch((err) => messages.say(err instanceof Error ? err.message : String(err), 'err'));
      window.dispatchEvent(new CustomEvent(JOBS_DONE, { detail: { id: corpusId } }));
    },
    {
      started,
      onUpdate: (list) => (jobLogs.by = { ...jobLogs.by, [corpusId]: list }),
      onStop: () => {
        if (tracked.get(corpusId) === stop) tracked.delete(corpusId);
      },
    },
  );
  tracked.set(corpusId, stop);
}

/** Stops following a corpus (it was deleted). */
export function untrackJobs(corpusId: number): void {
  tracked.get(corpusId)?.();
  tracked.delete(corpusId);
  const { [corpusId]: _gone, ...rest } = jobLogs.by;
  void _gone;
  jobLogs.by = rest;
}

/** Stops every tracked watcher and forgets the logs (app teardown, tests). */
export function stopAllJobs(): void {
  for (const stop of tracked.values()) stop();
  tracked.clear();
  jobLogs.by = {};
}

/**
 * App-level owner: follows the current corpus (started once one is current, again on every
 * change). Returns the teardown, which stops all tracking.
 */
export function startJobTracking(): () => void {
  const off = $effect.root(() => {
    $effect(() => {
      const id = corpusStore.currentId;
      if (id !== null) untrack(() => trackJobs(id));
    });
  });
  return () => {
    off();
    stopAllJobs();
  };
}
