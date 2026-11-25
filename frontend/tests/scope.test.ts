import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CORPUS_CHANGED, corpusStore } from '../src/lib/corpus.svelte';
import { setLang, t } from '../src/lib/i18n';
import {
  clearScope,
  clearScopePart,
  loadScope,
  refreshScope,
  refreshScopeSoon,
  scopeActive,
  scopeChips,
  scopeSummary,
  scopeView,
  startScope,
} from '../src/lib/scope.svelte';

type Reply = { ok: boolean; body: unknown };
const ok = (body: unknown): Reply => ({ ok: true, body });
const fail = (detail: string): Reply => ({ ok: false, body: { detail } });

let replies: Record<string, (url: string) => Reply | Promise<Reply>>;
let calls: string[];

function route(url: string) {
  const path = url.split('?')[0];
  const r = replies[path];
  return r ? r(url) : ok({});
}

beforeEach(() => {
  calls = [];
  replies = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const r = await route(url);
      return { ok: r.ok, status: r.ok ? 200 : 400, statusText: 'Bad', json: async () => r.body };
    }),
  );
  corpusStore.currentId = 1;
  corpusStore.clearScope();
  scopeView.facets = { tags: [], text_types: [], date_min: '', date_max: '' };
  scopeView.info = null;
  scopeView.error = '';
});

afterEach(() => {
  setLang('en');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const info = { filtered: true, docs: 5, total_docs: 12, words: 20244, total_words: 48200 };

describe('chips and active', () => {
  it('has no chips for an empty scope', () => {
    expect(scopeChips()).toEqual([]);
    expect(scopeActive()).toBe(false);
  });

  it('builds a chip per set part, with … for an open date end', () => {
    corpusStore.scope.tags = ' wind ';
    corpusStore.scope.type = 'news';
    corpusStore.scope.from = '2022';
    expect(scopeChips()).toEqual([
      { key: 'tags', text: `${t('filter.tags')}: wind` },
      { key: 'type', text: `${t('filter.type')}: news` },
      { key: 'dates', text: '2022–…' },
    ]);
    corpusStore.scope.from = '';
    corpusStore.scope.to = '2024';
    expect(scopeChips().at(-1)).toEqual({ key: 'dates', text: '…–2024' });
  });

  it('localizes the chip prefixes and follows a language change', () => {
    corpusStore.scope.tags = 'wind';
    corpusStore.scope.type = 'news';
    expect(scopeChips()[0].text).toBe('Tags: wind');
    setLang('es');
    expect(scopeChips().map((c) => c.text)).toEqual(['Etiquetas: wind', 'Tipo: news']);
  });

  it('is active as soon as a field is set, with no summary yet', () => {
    expect(scopeView.info).toBeNull();
    corpusStore.scope.type = 'news';
    expect(scopeActive()).toBe(true);
  });

  it('is active when the summary says filtered', () => {
    scopeView.info = info;
    expect(scopeActive()).toBe(true);
  });
});

describe('scopeSummary', () => {
  it('is empty before a reply', () => {
    expect(scopeSummary()).toBe('');
  });
  it('says all documents when not filtered', () => {
    scopeView.info = { ...info, filtered: false };
    expect(scopeSummary()).toBe('All documents');
  });
  it('gives the filter summary when filtered', () => {
    scopeView.info = info;
    expect(scopeSummary()).toContain('5 of 12 documents');
    expect(scopeSummary()).toContain('words');
  });
  it('shows the error first', () => {
    scopeView.info = info;
    scopeView.error = 'boom';
    expect(scopeSummary()).toBe('boom');
  });
});

describe('refreshScope', () => {
  it('sends the scope as query params and stores the reply', async () => {
    replies['/api/corpora/1/scope'] = () => ok(info);
    corpusStore.scope.tags = 'wind';
    corpusStore.scope.type = 'news';
    corpusStore.scope.from = '2022';
    corpusStore.scope.to = '2023';
    await refreshScope();
    const u = new URL(calls[0], 'http://x');
    expect(u.pathname).toBe('/api/corpora/1/scope');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      tags: 'wind',
      text_type: 'news',
      date_from: '2022',
      date_to: '2023',
    });
    expect(scopeView.info).toEqual(info);
  });

  it('does nothing without a corpus', async () => {
    corpusStore.currentId = null;
    await refreshScope();
    expect(calls).toEqual([]);
  });

  it('records a failure and leaves info null', async () => {
    replies['/api/corpora/1/scope'] = () => fail('nope');
    await refreshScope();
    expect(scopeView.error).toBe('nope');
    expect(scopeView.info).toBeNull();
  });

  it('drops a slow reply that a newer request overtook', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    replies['/api/corpora/1/scope'] = async () => {
      n += 1;
      if (n === 1) {
        await gate;
        return ok({ ...info, docs: 1 });
      }
      return ok({ ...info, docs: 2 });
    };
    const first = refreshScope();
    await refreshScope();
    release();
    await first;
    expect(scopeView.info?.docs).toBe(2);
  });
});

describe('loadScope', () => {
  it('loads facets then the summary', async () => {
    const facets = { tags: [{ tag: 'a', docs: 1 }], text_types: [], date_min: '2000', date_max: '2020' };
    replies['/api/corpora/1/facets'] = () => ok(facets);
    replies['/api/corpora/1/scope'] = () => ok(info);
    await loadScope();
    expect(scopeView.facets).toEqual(facets);
    expect(scopeView.info).toEqual(info);
  });

  it('drops facets that arrive for another corpus', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    replies['/api/corpora/1/facets'] = async () => {
      await gate;
      return ok({ tags: [{ tag: 'old', docs: 1 }], text_types: [], date_min: '', date_max: '' });
    };
    replies['/api/corpora/1/scope'] = () => ok(info);
    const p = loadScope();
    corpusStore.currentId = 2;
    release();
    await p;
    expect(scopeView.facets.tags).toEqual([]);
  });

  it('ignores a failing facets request but still refreshes the summary', async () => {
    replies['/api/corpora/1/facets'] = () => fail('x');
    replies['/api/corpora/1/scope'] = () => ok(info);
    await loadScope();
    expect(scopeView.facets.tags).toEqual([]);
    expect(scopeView.error).toBe('');
    expect(scopeView.info).toEqual(info);
  });
});

describe('clearing', () => {
  beforeEach(() => {
    replies['/api/corpora/1/scope'] = () => ok({ ...info, filtered: false });
    corpusStore.scope.tags = 'a';
    corpusStore.scope.type = 'news';
    corpusStore.scope.from = '2022';
    corpusStore.scope.to = '2023';
  });

  it('clears both ends for dates and re-requests', async () => {
    clearScopePart('dates');
    expect(corpusStore.scope.from).toBe('');
    expect(corpusStore.scope.to).toBe('');
    expect(corpusStore.scope.tags).toBe('a');
    await vi.waitFor(() => expect(calls.length).toBe(1));
  });

  it('clears one part at a time', () => {
    clearScopePart('tags');
    expect(corpusStore.scope.tags).toBe('');
    clearScopePart('type');
    expect(corpusStore.scope.type).toBe('');
    expect(corpusStore.scope.from).toBe('2022');
  });

  it('clears everything and re-requests', async () => {
    clearScope();
    expect(scopeChips()).toEqual([]);
    await vi.waitFor(() => expect(calls.length).toBe(1));
  });
});

describe('startScope', () => {
  it('loads now, resets and reloads on CORPUS_CHANGED, and stops cleanly', async () => {
    replies['/api/corpora/1/scope'] = () => ok(info);
    replies['/api/corpora/2/scope'] = () => ok({ ...info, docs: 9 });
    const stop = startScope();
    await vi.waitFor(() => expect(scopeView.info?.docs).toBe(5));

    corpusStore.currentId = 2;
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
    expect(scopeView.info).toBeNull();
    await vi.waitFor(() => expect(scopeView.info?.docs).toBe(9));

    stop();
    const n = calls.length;
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
    expect(calls.length).toBe(n);
  });

  it('drops a reply that arrives for the previous corpus', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    replies['/api/corpora/1/scope'] = async () => {
      await gate;
      return ok({ ...info, docs: 1 });
    };
    replies['/api/corpora/2/scope'] = () => ok({ ...info, docs: 2 });
    const stop = startScope();
    corpusStore.currentId = 2;
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
    await vi.waitFor(() => expect(scopeView.info?.docs).toBe(2));
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(scopeView.info?.docs).toBe(2);
    stop();
  });

  it('stop cancels a pending debounced refresh', () => {
    vi.useFakeTimers();
    const stop = startScope();
    calls.length = 0;
    refreshScopeSoon();
    stop();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([]);
  });
});

describe('refreshScopeSoon', () => {
  it('coalesces rapid calls into one request after 350 ms', async () => {
    vi.useFakeTimers();
    replies['/api/corpora/1/scope'] = () => ok(info);
    refreshScopeSoon();
    refreshScopeSoon();
    refreshScopeSoon();
    vi.advanceTimersByTime(349);
    expect(calls.length).toBe(0);
    vi.advanceTimersByTime(1);
    expect(calls.length).toBe(1);
  });
});
