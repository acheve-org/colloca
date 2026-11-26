import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentReader from '../src/screens/DocumentReader.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { go } from '../src/lib/router.svelte';
import type { DocBlocks } from '../src/lib/types';

const meta = (id: number, over: Partial<DocBlocks['document']> = {}): DocBlocks['document'] => ({
  id, corpus_id: 1, title: `Doc ${id}`, source: 'brochure.pdf', kind: 'file', author: '', date: '2023-11',
  text_type: 'Brochure', tags: [], tokens: 83991, aligned: false, ...over,
});

/** A page of the document: blocks `start`.. up to `total`, text "D<id> p<n>". */
const page = (id: number, start: number, limit: number, total: number, over: Partial<DocBlocks['document']> = {}): DocBlocks => ({
  document: meta(id, over),
  blocks: Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, i) => ({
    n: start + i,
    text: `D${id} p${start + i}`,
    pair: over.aligned ? `T${id} p${start + i}` : '',
  })),
  total,
});

type Reply = { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
let urls: URL[];
let reply: (u: URL, method: string) => Reply;

let observers: { cb: IntersectionObserverCallback; targets: Element[]; live: boolean }[];

beforeEach(() => {
  urls = [];
  observers = [];
  reply = (u) => {
    const id = Number(u.pathname.split('/')[3]);
    const start = Number(u.searchParams.get('start') ?? 0);
    const limit = Number(u.searchParams.get('limit') ?? 100);
    return { status: 200, body: page(id, start, limit, 250) };
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://x');
    urls.push(u);
    const r = await reply(u, init?.method ?? 'GET');
    return { ok: r.status < 400, status: r.status, statusText: 'x', json: async () => r.body };
  }));
  vi.stubGlobal('IntersectionObserver', class {
    rec: { cb: IntersectionObserverCallback; targets: Element[]; live: boolean };
    constructor(cb: IntersectionObserverCallback) {
      this.rec = { cb, targets: [], live: true };
      observers.push(this.rec);
    }
    observe(el: Element) {
      this.rec.targets.push(el);
    }
    unobserve() {}
    disconnect() {
      this.rec.live = false;
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.currentId = null;
  go('sources');
});

const blockCalls = () => urls.filter((u) => u.pathname.endsWith('/blocks'));
/** Fire the live observer as if the sentinel scrolled into view. */
const reachEnd = async () => {
  const o = observers.filter((x) => x.live && x.targets.length).at(-1);
  expect(o).toBeDefined();
  o!.cb([{ isIntersecting: true, target: o!.targets[0] } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
  await tick();
};

const open = (doc: string) => {
  go('sources-read', { doc });
  return render(DocumentReader);
};

describe('DocumentReader', () => {
  it('shows the title, the metadata and the first page as paragraphs', async () => {
    open('7');
    expect(await screen.findByRole('heading', { level: 2, name: 'Doc 7' })).toBeInTheDocument();
    expect(blockCalls()[0].pathname).toBe('/api/documents/7/blocks');
    expect(blockCalls()[0].searchParams.get('start')).toBe('0');
    expect(blockCalls()[0].searchParams.get('limit')).toBe('100');
    expect(screen.getByText('Brochure')).toBeInTheDocument();
    expect(screen.getByText('2023-11')).toBeInTheDocument();
    expect(screen.getByText('83,991 words')).toBeInTheDocument();
    expect(screen.getByText('brochure.pdf')).toBeInTheDocument();
    expect(screen.queryByText('aligned')).not.toBeInTheDocument();
    const paras = document.querySelectorAll('.prose p');
    expect(paras).toHaveLength(100);
    expect(paras[0].textContent).toBe('D7 p0');
    expect(screen.getByRole('button', { name: 'Edit details' })).toBeInTheDocument();
  });

  it('loads the next page when the end comes into view, and stops at the total', async () => {
    open('7');
    await screen.findByText('D7 p99');
    await reachEnd();
    await screen.findByText('D7 p199');
    expect(blockCalls()[1].searchParams.get('start')).toBe('100');
    await reachEnd();
    await screen.findByText('D7 p249');
    expect(blockCalls()[2].searchParams.get('start')).toBe('200');
    expect(document.querySelectorAll('.prose p')).toHaveLength(250);
    // Everything is loaded: no sentinel left to watch, no further request.
    expect(observers.filter((x) => x.live && x.targets.length)).toHaveLength(0);
    expect(blockCalls()).toHaveLength(3);
  });

  it('says it is loading more while the next page is on its way', async () => {
    open('7');
    await screen.findByText('D7 p99');
    let release!: () => void;
    reply = (u) => new Promise((res) => {
      release = () => res({ status: 200, body: page(7, Number(u.searchParams.get('start')), 100, 250) });
    });
    await reachEnd();
    expect(screen.getByRole('status')).toHaveTextContent('Loading more…');
    release();
    await screen.findByText('D7 p199');
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('shows aligned segments as numbered rows with their pairs', async () => {
    reply = () => ({ status: 200, body: page(9, 0, 100, 2, { aligned: true }) });
    open('9');
    await screen.findByText('D9 p0');
    const rows = document.querySelectorAll('.pairs .row');
    expect(rows).toHaveLength(2);
    // The backend numbers segments from 0; the reader shows them from 1.
    expect(rows[0].querySelector('.n')!.textContent).toBe('1');
    expect(rows[1].querySelector('.n')!.textContent).toBe('2');
    expect(rows[1].textContent).toContain('D9 p1');
    expect(rows[1].textContent).toContain('T9 p1');
    expect(screen.getByText('aligned')).toBeInTheDocument();
    expect(document.querySelector('.prose')).toBeNull();
  });

  it('keeps a long unbroken string in an aligned row from widening the page', async () => {
    reply = () => ({ status: 200, body: page(9, 0, 100, 1, { aligned: true }) });
    open('9');
    await screen.findByText('D9 p0');
    const row = document.querySelector<HTMLElement>('.pairs .row')!;
    expect(getComputedStyle(row).gridTemplateColumns).toBe('40px minmax(0px, 1fr) minmax(0px, 1fr)');
    const spans = row.querySelectorAll<HTMLElement>('span:not(.n)');
    expect(spans).toHaveLength(2);
    for (const s of spans) expect(getComputedStyle(s).overflowWrap).toBe('anywhere');
  });

  it('offers Retry when a later page fails, and loads that page again', async () => {
    open('7');
    await screen.findByText('D7 p99');
    reply = () => ({ status: 500, body: { detail: 'Server down' } });
    await reachEnd();
    expect(await screen.findByText('Server down')).toBeInTheDocument();
    reply = (u) => ({ status: 200, body: page(7, Number(u.searchParams.get('start')), 100, 250) });
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('D7 p199');
    const calls = blockCalls();
    expect(calls.at(-1)!.searchParams.get('start')).toBe('100');
    expect(calls.at(-2)!.searchParams.get('start')).toBe('100');
    expect(screen.queryByText('Server down')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('shows Document not found for a 404', async () => {
    reply = () => ({ status: 404, body: { detail: 'Document not found' } });
    open('7');
    expect(await screen.findByText('Document not found')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it.each(['', 'abc', '-3', '1.5'])('shows Document not found for doc=%j without asking the server', async (doc) => {
    go('sources-read', doc ? { doc } : {});
    render(DocumentReader);
    expect(await screen.findByText('Document not found')).toBeInTheDocument();
    expect(blockCalls()).toHaveLength(0);
  });

  it('drops the answer for a document left behind', async () => {
    const pending: Record<number, () => void> = {};
    reply = (u) => {
      const id = Number(u.pathname.split('/')[3]);
      return new Promise((res) => {
        pending[id] = () => res({ status: 200, body: page(id, 0, 100, 3) });
      });
    };
    open('7');
    await waitFor(() => expect(pending[7]).toBeDefined());
    go('sources-read', { doc: '8' });
    await waitFor(() => expect(pending[8]).toBeDefined());
    pending[8]();
    await screen.findByRole('heading', { level: 2, name: 'Doc 8' });
    pending[7]();
    await tick();
    await tick();
    expect(screen.getByRole('heading', { level: 2, name: 'Doc 8' })).toBeInTheDocument();
    expect(screen.queryByText('D7 p0')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.prose p')).toHaveLength(3);
  });

  it('edits the details and shows the new metadata after saving', async () => {
    // Saving runs in the working corpus, whichever corpus the document belongs to.
    corpusStore.currentId = 2;
    let title = 'Doc 7';
    reply = (u, method) => {
      if (method === 'PATCH') {
        title = 'Renamed';
        return { status: 200, body: {} };
      }
      if (u.pathname.endsWith('/facets')) return { status: 200, body: { tags: [], text_types: [], date_min: '', date_max: '' } };
      if (u.pathname === '/api/documents/7') {
        return {
          status: 200,
          body: {
            id: 7, corpus_id: 1, title, source: 'brochure.pdf', kind: 'file', text_type: 'Brochure', doc_date: '2023-11',
            author: '', n_tokens: 83991, pipeline: '', lang_check: '', added: '', segmented: 0, pair_doc_id: null, chars: 0,
            tags: [], stale: false,
          },
        };
      }
      return { status: 200, body: page(7, 0, 100, 3, { title }) };
    };
    open('7');
    await screen.findByRole('heading', { level: 2, name: 'Doc 7' });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const input = await screen.findByDisplayValue('Doc 7');
    expect(urls.some((u) => u.pathname === '/api/corpora/1/facets')).toBe(true);
    await fireEvent.input(input, { target: { value: 'Renamed' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Renamed' })).toBeInTheDocument();
  });
});
