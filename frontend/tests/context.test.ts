import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { corpusStore } from '../src/lib/corpus.svelte';
import { projectStore } from '../src/lib/projects.svelte';
import { loadLanguageNames, workingContext } from '../src/lib/context.svelte';

const corpus = (id: number, lang: string, project_id: number | null) => ({
  id, name: `c${id}`, lang, project_id, is_reference: 0, docs: 1, tokens: 1,
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, statusText: 'OK', json: async () => ({ es: 'Spanish' }),
  })));
  projectStore.list = [{ id: 7, name: 'Acme', corpora: 1, trashed: 0 }];
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
