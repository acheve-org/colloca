import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TmxExport from '../src/screens/TmxExport.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';

let partners: unknown[];
let calls: string[];

beforeEach(() => {
  calls = [];
  partners = [{ id: 2, name: 'Memoria IT', lang: 'it', docs: 3 }];
  corpusStore.currentId = 1;
  corpusStore.aligned = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    return { ok: true, status: 200, statusText: 'OK', json: async () => partners };
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.currentId = null;
  corpusStore.aligned = false;
});

describe('TmxExport', () => {
  it('offers the download of the single partner, with the markup switch on', async () => {
    render(TmxExport);
    const link = await screen.findByRole('link', { name: 'Download TMX' });
    expect(calls).toEqual(['/api/corpora/1/aligned-partners']);
    expect(link.getAttribute('href')).toBe('/api/corpora/1/export-tmx?partner_corpus_id=2&markup=true');
    expect(screen.queryByLabelText('Translations from')).toBeNull();      // nothing to choose
    await fireEvent.click(screen.getByRole('switch', { name: 'keep inline markup' }));
    await waitFor(() => expect(link.getAttribute('href')).toContain('markup=false'));
  });

  it('lets you choose between several partner corpora', async () => {
    partners = [{ id: 2, name: 'Memoria IT', lang: 'it', docs: 3 }, { id: 5, name: 'Otra', lang: 'it', docs: 1 }];
    render(TmxExport);
    const select = await screen.findByLabelText('Translations from');
    await fireEvent.change(select, { target: { value: '5' } });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Download TMX' }).getAttribute('href')).toContain('partner_corpus_id=5'));
  });

  it('shows nothing without aligned documents and asks for nothing', async () => {
    corpusStore.aligned = false;
    render(TmxExport);
    expect(screen.queryByRole('link', { name: 'Download TMX' })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('shows nothing when the corpus has no partner', async () => {
    partners = [];
    render(TmxExport);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByRole('link', { name: 'Download TMX' })).toBeNull();
  });
});
