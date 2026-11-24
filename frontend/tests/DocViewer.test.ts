import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DocViewer from '../src/lib/ui/DocViewer.svelte';
import type { ConcLine, DocContext } from '../src/lib/types';

const hit = (pos: number, over: Partial<ConcLine> = {}): ConcLine => ({
  doc_id: 7, doc: 'Contrato 7', pos, left: '', node: 'plazo', right: '', matches: [pos], ...over,
});

const ctx = (aligned: boolean, more = true): DocContext => ({
  document: {
    id: 7, corpus_id: 1, title: 'Contrato 7', source: '', kind: 'paste', author: '', date: '',
    text_type: '', tags: [], tokens: 100, aligned,
  },
  blocks: [
    { n: 1, text: 'Antes.', hit: false, pair: aligned ? 'Prima.' : '', marks: [] },
    { n: 2, text: 'El plazo termina.', hit: true, pair: aligned ? 'Il termine scade.' : '', marks: [{ start: 3, end: 8 }] },
  ],
  more_before: more,
  more_after: false,
});

let urls: URL[];
let body: DocContext;

beforeEach(() => {
  urls = [];
  body = ctx(false);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(new URL(url, 'http://x'));
    return { ok: true, status: 200, statusText: 'ok', json: async () => body };
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('DocViewer', () => {
  it('asks for the context of the hit and marks the match in its block', async () => {
    render(DocViewer, { open: true, hit: hit(42, { matches: [42, 43, 44] }), index: 1, total: 3 });
    await waitFor(() => expect(screen.getByText('Antes.')).toBeInTheDocument());
    expect(urls[0].pathname).toBe('/api/documents/7/context');
    expect(urls[0].searchParams.get('pos')).toBe('42');
    expect(urls[0].searchParams.get('span')).toBe('3');
    const mark = document.querySelector('.hit-block .hit-query');
    expect(mark?.textContent).toBe('plazo');
    expect(document.querySelector('.hit-block')?.textContent).toContain('El plazo termina.');
    expect(screen.getByText('Hit 1 of 3')).toBeInTheDocument();
  });

  it('shows both sides of an aligned document', async () => {
    body = ctx(true);
    render(DocViewer, { open: true, hit: hit(5), index: 1, total: 1 });
    await waitFor(() => expect(screen.getByText('Il termine scade.')).toBeInTheDocument());
    expect(screen.getByText('Aligned translation')).toBeInTheDocument();
  });

  it('loads more context and offers previous and next hits', async () => {
    const onprev = vi.fn();
    const onnext = vi.fn();
    render(DocViewer, { open: true, hit: hit(5), index: 2, total: 3, onprev, onnext });
    await waitFor(() => screen.getByText('Antes.'));
    await fireEvent.click(screen.getByRole('button', { name: 'Show more before' }));
    await waitFor(() => expect(urls).toHaveLength(2));
    expect(urls[1].searchParams.get('radius')).toBe('6');
    await fireEvent.click(screen.getByRole('button', { name: 'Previous hit' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Next hit' }));
    expect(onprev).toHaveBeenCalledTimes(1);
    expect(onnext).toHaveBeenCalledTimes(1);
  });

  it('disables previous on the first hit and next on the last', async () => {
    render(DocViewer, { open: true, hit: hit(5), index: 1, total: 1, onprev: () => {}, onnext: () => {} });
    await waitFor(() => screen.getByText('Antes.'));
    expect(screen.getByRole('button', { name: 'Previous hit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next hit' })).toBeDisabled();
  });

  it('shows the error when the context cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 404, statusText: 'Not Found', json: async () => ({ detail: 'Document not found' }),
    })));
    render(DocViewer, { open: true, hit: hit(5), index: 1, total: 1 });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Document not found'));
  });
});
