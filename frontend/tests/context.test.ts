import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { corpusStore } from '../src/lib/corpus.svelte';
import { projectStore } from '../src/lib/projects.svelte';
import { ensureLanguageName, loadLanguageNames, workingContext } from '../src/lib/context.svelte';

const corpus = (id: number, lang: string, project_id: number | null) => ({
  id, name: `c${id}`, lang, project_id, is_reference: 0, docs: 1, tokens: 1,
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, statusText: 'OK', json: async () => ({ es: 'Spanish' }),
  })));
  projectStore.list = [{ id: 7, name: 'Acme', corpora: 1, trashed: 0, terms: 0 }];
  corpusStore.list = [corpus(1, 'es', 7), corpus(2, 'es', null), corpus(3, 'xx', 7)];
  corpusStore.currentId = null;
});
afterEach(() => vi.unstubAllGlobals());

describe('workingContext', () => {
  it('is null without a corpus', () => {
    expect(workingContext()).toBeNull();
  });

  it('resolves the language name and the project', async () => {
    await loadLanguageNames();
    corpusStore.currentId = 1;
    const c = workingContext();
    expect(c?.languageName).toBe('Spanish');
    expect(c?.language).toBe('es');
    expect(c?.project?.name).toBe('Acme');
    expect(c?.corpus.id).toBe(1);
  });

  it('tolerates a missing project and an unknown language', async () => {
    await loadLanguageNames();
    corpusStore.currentId = 2;
    expect(workingContext()?.project).toBeNull();
    corpusStore.currentId = 3;
    expect(workingContext()?.languageName).toBe('xx');
  });
});

describe('ensureLanguageName', () => {
  it('reloads once when the language is missing, then shows the name', async () => {
    await loadLanguageNames();
    corpusStore.list = [corpus(4, 'it', null)];
    corpusStore.currentId = 4;
    expect(workingContext()?.languageName).toBe('it');
    const f = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ es: 'Spanish', it: 'Italian' }) }));
    vi.stubGlobal('fetch', f);
    await ensureLanguageName();
    await ensureLanguageName();
    expect(f).toHaveBeenCalledTimes(1);
    expect(workingContext()?.languageName).toBe('Italian');
  });

  it('falls back to the code, without throwing, when the load fails (and does not retry)', async () => {
    await loadLanguageNames();
    corpusStore.list = [corpus(5, 'fr', null)];
    corpusStore.currentId = 5;
    const f = vi.fn(async () => { throw new Error('down'); });
    vi.stubGlobal('fetch', f);
    await expect(ensureLanguageName()).resolves.toBeUndefined();
    await ensureLanguageName();
    expect(f).toHaveBeenCalledTimes(1);
    expect(workingContext()?.languageName).toBe('fr');
  });

  it('asks once for a code the API does not know, however often it runs', async () => {
    await loadLanguageNames();
    corpusStore.list = [corpus(6, 'zz', null)];
    corpusStore.currentId = 6;
    const f = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ es: 'Spanish' }) }));
    vi.stubGlobal('fetch', f);
    await ensureLanguageName();
    await ensureLanguageName();
    expect(f).toHaveBeenCalledTimes(1);
    expect(workingContext()?.languageName).toBe('zz');
  });
});
