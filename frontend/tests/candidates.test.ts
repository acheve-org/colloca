import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accept, basket, dropTerms, inTermbase, isDropped, restoreTerms, review, sendToCandidates, syncBasket, visible,
} from '../src/lib/candidates.svelte';
import { CORPUS_CHANGED, corpusStore } from '../src/lib/corpus.svelte';
import { termStore } from '../src/lib/term.svelte';
import type { Corpus } from '../src/lib/types';

let calls: { path: string; body: unknown }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return { ok: true, status: 200, statusText: 'ok', json: async () => ({}) };
  });
  localStorage.clear();
  corpusStore.list = [{ id: 1, name: 'c', lang: 'es', project_id: 5 } as unknown as Corpus];
  corpusStore.currentId = 1;
  window.dispatchEvent(new CustomEvent(CORPUS_CHANGED));
  review.showDropped = false;
  review.onlyNew = false;
  basket.key = '';
  basket.items = [];
  syncBasket();
});
afterEach(() => vi.unstubAllGlobals());

const row = (item: string, extra = {}) => ({ item, ...extra });

describe('candidate flags', () => {
  it('hides dropped rows unless asked, and in-termbase rows on request', () => {
    const rows = [row('plazo', { dropped: true }), row('contrato', { in_termbase: 'approved' }), row('garantía')];
    expect(visible(rows).map((r) => r.item)).toEqual(['contrato', 'garantía']);
    review.showDropped = true;
    expect(visible(rows)).toHaveLength(3);
    review.onlyNew = true;
    expect(visible(rows).map((r) => r.item)).toEqual(['plazo', 'garantía']);
  });

  it('drop and restore call the stop list of the corpus and take effect at once, case-insensitively', async () => {
    const r = row('Plazo');
    expect(isDropped(r)).toBe(false);
    expect(await dropTerms(['Plazo'])).toBe(true);
    expect(calls[0]).toEqual({ path: '/api/corpora/1/rejections', body: { terms: ['Plazo'] } });
    expect(isDropped(row('plazo'))).toBe(true);
    await restoreTerms(['plazo']);
    expect(calls[1].path).toBe('/api/corpora/1/rejections/restore');
    expect(isDropped(r)).toBe(false);
  });

  it('a term saved from the dialog counts as in the termbase', () => {
    termStore.draft.src_term = 'Fianza';
    window.dispatchEvent(new CustomEvent('term-saved'));
    expect(inTermbase(row('fianza'))).toBe('candidate');
  });
});

describe('the Candidates table', () => {
  const entry = (item: string) => ({
    item, pos: 'NOUN', origin: 'keyness', measure: 'log-likelihood', score: 12, freq: 3, example: '',
  });

  it('keeps terms once per project and language, in the browser', () => {
    expect(sendToCandidates([entry('plazo'), entry('Plazo'), entry('fianza')])).toBe(2);
    expect(sendToCandidates([entry('plazo')])).toBe(0);
    expect(JSON.parse(localStorage.getItem('corpora.candidates.5.es') ?? '[]')).toHaveLength(2);
  });

  it('accept saves directly when a translation is typed', async () => {
    sendToCandidates([entry('plazo')]);
    const c = { ...basket.items[0], translation: 'termine' };
    expect(await accept(c)).toBe(true);
    expect(calls[0].path).toBe('/api/terms');
    expect(calls[0].body).toMatchObject({
      project_id: 5, src_lang: 'es', src_term: 'plazo', tgt_term: 'termine', status: 'approved', origin: 'keyness',
    });
    expect(inTermbase(row('plazo'))).toBe('candidate');
  });

  it('accept without a translation opens the prefilled add-term dialog', async () => {
    sendToCandidates([entry('plazo')]);
    expect(await accept(basket.items[0])).toBe(false);
    expect(calls.some((c) => c.path === '/api/terms')).toBe(false); // nothing saved
    expect(termStore.open).toBe(true);
    expect(termStore.draft.src_term).toBe('plazo');
    termStore.open = false;
  });
});
