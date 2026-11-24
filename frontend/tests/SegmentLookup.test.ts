import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SegmentLookup from '../src/screens/SegmentLookup.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { messages } from '../src/lib/messages.svelte';
import type { LookupResult } from '../src/lib/types';

const RESULT: LookupResult = {
  query_words: 9,
  found: 2,
  matches: [
    {
      doc_id: 4, doc: 'memoria', seg: 0, pos: 12, span: 14, percent: 92, band: '85-94', exact: false,
      numbers_differ: false, only_numbers_differ: false,
      source: 'El arrendador debe entregar las llaves el primer día del mes.',
      target: 'Il locatore deve consegnare le chiavi il primo giorno del mese.',
      diff: [
        { text: 'El', kind: 'same', sp: true }, { text: 'arrendador', kind: 'same', sp: true },
        { text: 'mes', kind: 'extra', sp: false }, { text: 'año', kind: 'missing', sp: true }, { text: '.', kind: 'same', sp: false },
      ],
    },
    {
      doc_id: 4, doc: 'memoria', seg: 3, pos: 80, span: 9, percent: 100, band: '100', exact: true,
      numbers_differ: true, only_numbers_differ: true, source: 'Plazo de 30 días.', target: 'Termine di 30 giorni.',
      diff: [{ text: 'Plazo', kind: 'same', sp: true }],
    },
  ],
};

let calls: { url: string; body?: string }[];
let reply: LookupResult;

beforeEach(() => {
  calls = [];
  reply = RESULT;
  corpusStore.list = [{ id: 1, name: 'ES', lang: 'es', project_id: null, is_reference: 0, docs: 2, tokens: 10 } as never];
  corpusStore.currentId = 1;
  corpusStore.loaded = true;
  messages.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body as string | undefined });
    const body = String(url).endsWith('/facets') ? { tags: [], text_types: [], date_min: '', date_max: '' }
      : String(url).endsWith('/scope') ? { filtered: false, docs: 2, words: 10, total_docs: 2, total_words: 10 }
      : String(url).includes('/context') ? { document: { title: 'memoria', aligned: true }, blocks: [], more_before: false, more_after: false }
      : reply;
    return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.list = [];
  corpusStore.currentId = null;
});

const lookups = () => calls.filter((c) => c.url.includes('/segment-lookup'));

describe('SegmentLookup', () => {
  it('asks for nothing until a segment is pasted', async () => {
    render(SegmentLookup);
    await fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(messages.current?.text).toBe('Paste the segment to look up first.'));
    expect(lookups()).toHaveLength(0);
  });

  it('sends the segment with the chosen threshold and lists matches with percent, band and translation', async () => {
    render(SegmentLookup);
    await fireEvent.input(screen.getByLabelText('Segment to look up'), { target: { value: 'El arrendador debe entregar las llaves.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('2 similar segments for your 9 words')).toBeInTheDocument();
    const sent = lookups()[0];
    expect(sent.url).toBe('/api/corpora/1/segment-lookup');
    expect(JSON.parse(sent.body!)).toEqual({ text: 'El arrendador debe entregar las llaves.', min_percent: 70, limit: 10 });
    const items = within(screen.getByRole('list', { name: 'Similar segments' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('92%')).toBeInTheDocument();
    expect(within(items[0]).getByText('85 to 94%')).toBeInTheDocument();
    expect(within(items[0]).getByText('Il locatore deve consegnare le chiavi il primo giorno del mese.')).toBeInTheDocument();
    expect(within(items[1]).getByText('identical')).toBeInTheDocument();
    expect(within(items[1]).getByText('numbers differ')).toBeInTheDocument();
  });

  it('marks the words that differ, with cues other than colour', async () => {
    render(SegmentLookup);
    await fireEvent.input(screen.getByLabelText('Segment to look up'), { target: { value: 'algo' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    const extra = await screen.findByText('mes');
    expect(extra).toHaveClass('extra');
    expect(extra).toHaveAttribute('title', 'In the stored segment, not in yours');
    const missing = screen.getByText('año');
    expect(missing).toHaveClass('missing');
    expect(missing).toHaveAttribute('title', 'In your segment, not in the stored one');
    expect(screen.getByText(/Blue underlined/)).toBeInTheDocument();
  });

  it('Ctrl+Enter looks up, and a changed threshold is sent', async () => {
    render(SegmentLookup);
    await fireEvent.change(screen.getByLabelText('At least'), { target: { value: '85' } });
    const box = screen.getByLabelText('Segment to look up');
    await fireEvent.input(box, { target: { value: 'algo' } });
    await fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(lookups()).toHaveLength(1));
    expect(JSON.parse(lookups()[0].body!).min_percent).toBe(85);
  });

  it('says so when nothing is that alike', async () => {
    reply = { query_words: 4, found: 0, matches: [] };
    render(SegmentLookup);
    await fireEvent.input(screen.getByLabelText('Segment to look up'), { target: { value: 'algo nuevo' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('No segment is 70% alike or more.')).toBeInTheDocument();
  });

  it('opens a match in the document viewer at its position', async () => {
    render(SegmentLookup);
    await fireEvent.input(screen.getByLabelText('Segment to look up'), { target: { value: 'algo' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await fireEvent.click((await screen.findAllByRole('button', { name: 'Open the document memoria' }))[0]);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/documents/4/context') && c.url.includes('pos=12'))).toBe(true));
  });

  it('shows the server error, not a result', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      String(url).includes('/segment-lookup')
        ? ({ ok: false, status: 400, statusText: 'Bad', json: async () => ({ detail: 'The segment has no words to look up' }) } as Response)
        : ({ ok: true, status: 200, json: async () => ({ tags: [], text_types: [], date_min: '', date_max: '', filtered: false }) } as Response));
    render(SegmentLookup);
    await fireEvent.input(screen.getByLabelText('Segment to look up'), { target: { value: '...' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(messages.current?.text).toBe('The segment has no words to look up'));
  });
});
