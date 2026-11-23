import { get } from './api';
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
      stop();
      messages.say(err instanceof Error ? err.message : String(err), 'err');
      return;
    }
    if (stopped) return;
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
    if (seen) onDone();
  }

  poll();
  return stop;
}
