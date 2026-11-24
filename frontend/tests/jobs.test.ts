import { render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StatusLine from '../src/lib/ui/StatusLine.svelte';
import { JOBS_DONE, jobLogs, jobs, startJobTracking, stopAllJobs, trackJobs, watchJobs } from '../src/lib/jobs.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { messages } from '../src/lib/messages.svelte';
import type { Job } from '../src/lib/types';

const job = (id: number, status: string, progress = 0): Job => ({
  id, corpus_id: 1, kind: 'import', label: `file${id}.txt`, status, progress, error: '', code: '', result: {},
});

let responses: Job[][];
let fetches: string[];
let fail: string | null;

beforeEach(() => {
  vi.useFakeTimers();
  fetches = [];
  fail = null;
  responses = [];
  messages.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetches.push(url);
    if (fail) return { ok: false, status: 500, statusText: 'x', json: async () => ({ detail: fail }) };
    const body = responses.length > 1 ? responses.shift()! : (responses[0] ?? []);
    return { ok: true, status: 200, statusText: '', json: async () => body };
  }));
});

afterEach(() => {
  stopAllJobs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('watchJobs', () => {
  it('polls the corpus jobs while one runs, then stops and calls onDone once', async () => {
    responses = [[job(1, 'running', 0.2)], [job(1, 'running', 0.6)], [job(1, 'done', 1)]];
    const onDone = vi.fn();
    const stop = watchJobs(4, onDone);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toEqual(['/api/corpora/4/jobs']);
    expect(jobs.running).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetches.length).toBe(2);
    expect(jobs.progress).toBeCloseTo(0.6);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetches.length).toBe(3);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(jobs.running).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetches.length).toBe(3);
    expect(onDone).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops after one poll when no job is running, without calling onDone', async () => {
    responses = [[job(1, 'done', 1)]];
    const onDone = vi.fn();
    watchJobs(4, onDone);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetches.length).toBe(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('with started:true a job that already finished still counts as done', async () => {
    responses = [[job(1, 'done', 1)]];
    const onDone = vi.fn();
    watchJobs(4, onDone, { started: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(onDone).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetches.length).toBe(1);
  });

  it('the stop function cancels the timer: no more polls and no onDone', async () => {
    responses = [[job(1, 'queued')], [job(1, 'done', 1)]];
    const onDone = vi.fn();
    const stop = watchJobs(4, onDone);
    await vi.advanceTimersByTimeAsync(0);
    expect(jobs.running).toBe(1);
    stop();
    expect(jobs.running).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetches.length).toBe(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a response that arrives after stop', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal('fetch', vi.fn(async () => {
      await gate;
      return { ok: true, status: 200, statusText: '', json: async () => [job(1, 'running')] };
    }));
    const onDone = vi.fn();
    const onUpdate = vi.fn();
    const stop = watchJobs(4, onDone, { onUpdate });
    stop();
    release();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(jobs.running).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sums running jobs over watchers and passes each list to onUpdate', async () => {
    responses = [[job(1, 'running'), job(2, 'queued'), job(3, 'error')]];
    const onUpdate = vi.fn();
    const a = watchJobs(4, () => {}, { onUpdate });
    const b = watchJobs(5, () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(jobs.running).toBe(4);
    expect(onUpdate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 3 })]));
    a();
    expect(jobs.running).toBe(2);
    b();
    expect(jobs.running).toBe(0);
  });

  it('retries a failed poll once, then reports the server detail and stops', async () => {
    fail = 'gone';
    const onDone = vi.fn();
    const onStop = vi.fn();
    watchJobs(4, onDone, { onStop });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches.length).toBe(1);
    expect(messages.current).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetches.length).toBe(2);
    expect(messages.current).toEqual({ text: 'gone', kind: 'err' });
    expect(onDone).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a poll that fails once and then works keeps polling without an error', async () => {
    responses = [[job(1, 'running')], [job(1, 'done', 1)]];
    fail = 'blip';
    const onDone = vi.fn();
    watchJobs(4, onDone, { started: true });
    await vi.advanceTimersByTimeAsync(0);
    fail = null;
    await vi.advanceTimersByTimeAsync(1000);
    expect(jobs.running).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(messages.current).toBeNull();
  });

  it('StatusLine shows a progress strip while jobs run', async () => {
    responses = [[job(1, 'running', 0.25)], [job(1, 'done', 1)]];
    render(StatusLine);
    expect(screen.queryByText(/job running/)).not.toBeInTheDocument();
    watchJobs(4, () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('1 background job running')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '25');
    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.queryByText(/job running/)).not.toBeInTheDocument();
  });
});

describe('app-level job tracking', () => {
  let state: Record<number, Job[][]>;
  let paths: string[];

  beforeEach(() => {
    paths = [];
    state = { 1: [[]], 2: [[]] };
    corpusStore.list = [
      { id: 1, name: 'A', lang: 'es', project_id: null, is_reference: 0, docs: 1, tokens: 1 },
      { id: 2, name: 'B', lang: 'it', project_id: null, is_reference: 0, docs: 1, tokens: 1 },
    ];
    corpusStore.currentId = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      paths.push(url);
      const m = /^\/api\/corpora\/(\d+)\/jobs$/.exec(url);
      let body: unknown = [];
      if (m) {
        const q = state[Number(m[1])] ?? [[]];
        body = q.length > 1 ? q.shift()! : q[0];
      } else if (url === '/api/corpora') body = corpusStore.list;
      else if (url.endsWith('/parallel')) body = { documents: 1, segments: 2, partners: [] };
      return { ok: true, status: 200, statusText: '', json: async () => body };
    }));
  });

  afterEach(() => {
    corpusStore.list = [];
    corpusStore.currentId = null;
  });

  const polls = (id: number) => paths.filter((p) => p === `/api/corpora/${id}/jobs`).length;

  it('follows the current corpus, and switching back and forth does not double-poll', async () => {
    state[1] = [[job(1, 'running')]];
    const stop = startJobTracking();
    corpusStore.currentId = 1;
    await vi.advanceTimersByTimeAsync(0);
    expect(polls(1)).toBe(1);
    corpusStore.currentId = 2;
    await vi.advanceTimersByTimeAsync(0);
    corpusStore.currentId = 1;
    await vi.advanceTimersByTimeAsync(0);
    expect(polls(2)).toBe(1);
    expect(polls(1)).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(polls(1)).toBe(4);
    expect(jobs.running).toBe(1);
    stop();
  });

  it('when tracked jobs finish: reloads the corpus store once, refreshes aligned and fires JOBS_DONE', async () => {
    corpusStore.currentId = 1;
    state[1] = [[job(1, 'running')], [job(1, 'done', 1)]];
    const done = vi.fn();
    window.addEventListener(JOBS_DONE, done);
    trackJobs(1, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(jobLogs.by[1]).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(paths.filter((p) => p === '/api/corpora').length).toBe(1);
    expect(paths).toContain('/api/corpora/1/parallel');
    expect(corpusStore.aligned).toBe(true);
    expect(done).toHaveBeenCalledTimes(1);
    expect((done.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(paths.filter((p) => p === '/api/corpora').length).toBe(1);
    window.removeEventListener(JOBS_DONE, done);
  });

  it('the teardown stops every watcher and leaks no timer', async () => {
    state[1] = [[job(1, 'running')]];
    state[2] = [[job(2, 'queued')]];
    const stop = startJobTracking();
    corpusStore.currentId = 1;
    await vi.advanceTimersByTimeAsync(0);
    trackJobs(2, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(jobs.running).toBe(2);
    stop();
    expect(jobs.running).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const n = paths.length;
    corpusStore.currentId = 2;
    await vi.advanceTimersByTimeAsync(5000);
    expect(paths.length).toBe(n);
  });
});
