import { render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StatusLine from '../src/lib/ui/StatusLine.svelte';
import { activity, BUSY_DELAY_MS, resetActivity } from '../src/lib/activity.svelte';
import { get } from '../src/lib/api';
import { messages } from '../src/lib/messages.svelte';

let release: Array<() => void>;

beforeEach(() => {
  vi.useFakeTimers();
  release = [];
  messages.clear();
  resetActivity();
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
    release.push(() => resolve({ ok: true, status: 200, statusText: '', json: async () => ({}) }));
  })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('activity', () => {
  it('stays quiet for a request that finishes before the delay', async () => {
    const p = get('/api/x');
    expect(activity.pending).toBe(1);
    expect(activity.busy).toBe(false);
    release[0]();
    await p;
    await vi.advanceTimersByTimeAsync(BUSY_DELAY_MS * 2);
    expect(activity.pending).toBe(0);
    expect(activity.busy).toBe(false);
  });

  it('turns busy once a request outlasts the delay, and clears when all finish', async () => {
    const a = get('/api/a');
    const b = get('/api/b');
    await vi.advanceTimersByTimeAsync(BUSY_DELAY_MS + 1);
    expect(activity.busy).toBe(true);
    release[0]();
    await a;
    expect(activity.busy).toBe(true);
    release[1]();
    await b;
    expect(activity.busy).toBe(false);
  });

  it('counts a failed request as finished', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() => Promise.reject(new Error('down')));
    await expect(get('/api/x')).rejects.toThrow('down');
    expect(activity.pending).toBe(0);
  });

  it('ignores the job polling, which would keep the indicator on', async () => {
    const p = get('/api/corpora/1/jobs');
    await vi.advanceTimersByTimeAsync(BUSY_DELAY_MS + 1);
    expect(activity.pending).toBe(0);
    expect(activity.busy).toBe(false);
    release[0]();
    await p;
  });

  it('shows in the status line while busy', async () => {
    render(StatusLine);
    expect(screen.queryByTestId('activity')).toBeNull();
    const p = get('/api/x');
    await vi.advanceTimersByTimeAsync(BUSY_DELAY_MS + 1);
    expect(await screen.findByTestId('activity')).toBeInTheDocument();
    release[0]();
    await p;
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByTestId('activity')).toBeNull();
  });
});
