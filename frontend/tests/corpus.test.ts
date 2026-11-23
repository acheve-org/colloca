import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(corpora: unknown[], parallelDocs = 0) {
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      statusText: '',
      json: async () =>
        url === '/api/corpora'
          ? corpora
          : url.endsWith('/parallel')
            ? { documents: parallelDocs, segments: 0, partners: [] }
            : {},
    })),
  );
  return await import('../src/lib/corpus.svelte');
}

const c = (id: number) => ({ id, name: `c${id}`, lang: 'en', project_id: null, docs: 1, tokens: 10 });

afterEach(() => vi.unstubAllGlobals());

describe('corpusStore', () => {
  it('has a null currentId with no corpora', async () => {
    const { corpusStore } = await load([]);
    await corpusStore.reload();
    expect(corpusStore.currentId).toBeNull();
    expect(corpusStore.current).toBeNull();
    expect(corpusStore.aligned).toBe(false);
  });

  it('select clears scope, sets aligned and fires corpus-changed', async () => {
    const { corpusStore, CORPUS_CHANGED } = await load([c(1), c(2)], 3);
    await corpusStore.reload();
    corpusStore.scope.tags = 'a';
    const spy = vi.fn();
    window.addEventListener(CORPUS_CHANGED, spy);
    await corpusStore.select(2);
    window.removeEventListener(CORPUS_CHANGED, spy);
    expect(corpusStore.currentId).toBe(2);
    expect(corpusStore.current?.name).toBe('c2');
    expect(corpusStore.scope.tags).toBe('');
    expect(corpusStore.aligned).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('scopeParams maps to API names and omits project', async () => {
    const { corpusStore, scopeParams } = await load([c(1)]);
    corpusStore.scope.type = 'law';
    corpusStore.scope.from = '2020';
    corpusStore.scope.project = '3';
    expect(scopeParams()).toEqual({ tags: '', text_type: 'law', date_from: '2020', date_to: '' });
    corpusStore.clearScope();
    expect(corpusStore.scope.type).toBe('');
  });

  it('fires corpus-changed and leaves aligned=false when /parallel fails', async () => {
    const { corpusStore, CORPUS_CHANGED } = await load([c(1)]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, statusText: 'boom', json: async () => ({}) })),
    );
    const spy = vi.fn();
    window.addEventListener(CORPUS_CHANGED, spy);
    await corpusStore.select(1);
    window.removeEventListener(CORPUS_CHANGED, spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(corpusStore.currentId).toBe(1);
    expect(corpusStore.aligned).toBe(false);
  });

  it('a late response for A does not overwrite B (A then B)', async () => {
    const { corpusStore } = await load([c(1), c(2)]);
    const resolvers: Record<string, (v: unknown) => void> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string) =>
          new Promise((resolve) => {
            resolvers[url] = (documents) =>
              resolve({ ok: true, status: 200, statusText: '', json: async () => ({ documents }) });
          }),
      ),
    );
    const a = corpusStore.select(1);
    const b = corpusStore.select(2);
    resolvers['/api/corpora/2/parallel'](0);
    await b;
    resolvers['/api/corpora/1/parallel'](5);
    await a;
    expect(corpusStore.currentId).toBe(2);
    expect(corpusStore.aligned).toBe(false);
  });
});
