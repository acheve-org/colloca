import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dispersion from '../src/screens/Dispersion.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { route } from '../src/lib/router.svelte';
import type { DispersionResult } from '../src/lib/types';

const RESULT: DispersionResult = {
  total: 3,
  range: 2,
  docs: [
    { doc_id: 1, title: 'uno', words: 100, length: 120, hits: 2, per_million: 20000, marks: [
      { pos: 6, span: 1, at: 0.05 }, { pos: 110, span: 1, at: 0.92 }] },
    { doc_id: 2, title: 'dos', words: 50, length: 60, hits: 0, per_million: 0, marks: [] },
    { doc_id: 3, title: 'tres', words: 40, length: 50, hits: 1, per_million: 25000, marks: [{ pos: 25, span: 1, at: 0.5 }] },
  ],
};

let calls: string[] = [];
beforeEach(() => {
  calls = [];
  route.params = {};
  corpusStore.list = [{ id: 7, name: 'c', lang: 'es', project_id: null, documents: 3, tokens: 190 } as never];
  corpusStore.currentId = 7;
  corpusStore.loaded = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    const body = String(url).endsWith('/facets')
      ? { tags: [], text_types: [], date_min: '', date_max: '' }
      : String(url).includes('/context')
      ? { document: { title: 'uno', aligned: false }, blocks: [{ n: 1, text: 'El contrato.', hit: true, marks: [], pair: '' }], more_before: false, more_after: false }
      : RESULT;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function plot(): Promise<void> {
  render(Dispersion);
  await fireEvent.input(screen.getByLabelText('Word or phrase'), { target: { value: 'contrato' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Plot' }));
  await screen.findByText(/3 hits in 2 of 3 documents/);
}

describe('Dispersion', () => {
  it('asks for the plot with the query options and shows one bar per document', async () => {
    await plot();
    const call = calls.find((c) => c.includes('/dispersion'))!;
    expect(call).toMatch(/\/api\/corpora\/7\/dispersion\?.*q=contrato/);
    expect(call).toContain('unit=lemma');
    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getByRole('img', { name: '2 hits in “uno”' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'no hits in “dos”' })).toBeInTheDocument();
    expect(document.querySelectorAll('.plot')[0].querySelectorAll('.mark')).toHaveLength(2);
    expect(document.querySelectorAll('.plot')[1].querySelectorAll('.mark')).toHaveLength(0);
  });

  it('marks sit at their relative position', async () => {
    await plot();
    const marks = [...document.querySelectorAll('.plot')[0].querySelectorAll<HTMLElement>('.mark')];
    expect(marks.map((m) => m.style.left)).toEqual(['5%', '92%']);
  });

  it('a click on the bar opens the document at the nearest mark', async () => {
    await plot();
    const bar = document.querySelectorAll<HTMLElement>('.plot')[0];
    bar.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 10, right: 100, bottom: 10, x: 0, y: 0, toJSON() {} });
    await fireEvent.click(bar, { clientX: 90 });
    await waitFor(() => expect(calls.some((c) => c.includes('/api/documents/1/context') && c.includes('pos=110'))).toBe(true));
    expect(await screen.findByText('Hit 2 of 3')).toBeInTheDocument();
  });

  it('the viewer steps through the marks of the plot, across documents', async () => {
    await plot();
    const bar = document.querySelectorAll<HTMLElement>('.plot')[0];
    bar.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 10, right: 100, bottom: 10, x: 0, y: 0, toJSON() {} });
    await fireEvent.click(bar, { clientX: 90 });
    await fireEvent.click(await screen.findByRole('button', { name: 'Next hit' }));
    await waitFor(() => expect(calls.some((c) => c.includes('/api/documents/3/context') && c.includes('pos=25'))).toBe(true));
    expect(screen.getByText('Hit 3 of 3')).toBeInTheDocument();
  });

  it('refuses an empty query without calling the server', async () => {
    render(Dispersion);
    await fireEvent.click(screen.getByRole('button', { name: 'Plot' }));
    await tick();
    expect(calls.filter((c) => c.includes('/dispersion'))).toHaveLength(0);
  });
});
