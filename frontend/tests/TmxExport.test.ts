import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
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

  describe('mode="button"', () => {
    it('opens the export card in a dialog', async () => {
      render(TmxExport, { mode: 'button' });
      const open = await screen.findByRole('button', { name: 'Export TMX' });
      expect(screen.queryByRole('link', { name: 'Download TMX' })).toBeNull();
      await fireEvent.click(open);
      const dlg = screen.getByRole('dialog', { name: 'Export aligned texts (TMX)' });
      const link = within(dlg).getByRole('link', { name: 'Download TMX' });
      expect(link.getAttribute('href')).toBe('/api/corpora/1/export-tmx?partner_corpus_id=2&markup=true');
      expect(within(dlg).getByRole('switch', { name: 'keep inline markup' })).toBeInTheDocument();
    });

    it('shows no button when the corpus has no partner', async () => {
      partners = [];
      render(TmxExport, { mode: 'button' });
      await waitFor(() => expect(calls).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 10));
      expect(screen.queryByRole('button', { name: 'Export TMX' })).toBeNull();
    });

    it('shows no button without aligned documents', async () => {
      corpusStore.aligned = false;
      render(TmxExport, { mode: 'button' });
      expect(screen.queryByRole('button', { name: 'Export TMX' })).toBeNull();
      expect(calls).toEqual([]);
    });
  });
});
