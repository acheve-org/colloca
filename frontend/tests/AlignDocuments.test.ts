import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AlignDocuments from '../src/screens/AlignDocuments.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { stopAllJobs } from '../src/lib/jobs.svelte';
import { messages } from '../src/lib/messages.svelte';

interface Call { method: string; path: string; search?: string; body?: unknown }
let calls: Call[];
let languages: Record<string, string> | null;
const apiCalls = () => calls.filter((c) => c.path !== '/api/languages');

const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });
const proposal = {
  title: 'contrato', source_lang: 'es', target_lang: 'it',
  links: [
    { src: ['Uno.'], tgt: ['Uno it.'], type: '1:1', confidence: 0.9, low: false },
    { src: ['Dos.'], tgt: ['Dos a.', 'Dos b.'], type: '1:2', confidence: 0.05, low: true },
    { src: ['Tres.'], tgt: [], type: '1:0', confidence: 0, low: true },
  ],
};

beforeEach(() => {
  calls = [];
  languages = null;
  messages.clear();
  corpusStore.list = [
    { id: 1, name: 'ES', lang: 'es', project_id: null, is_reference: 0, docs: 0, tokens: 0 },
    { id: 2, name: 'IT', lang: 'it', project_id: null, is_reference: 0, docs: 0, tokens: 0 },
  ];
  corpusStore.currentId = 1;
  corpusStore.loaded = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://x');
    const raw = init?.body;
    calls.push({ method: init?.method ?? 'GET', path: u.pathname, search: u.search, body: typeof raw === 'string' ? JSON.parse(raw) : raw });
    if (u.pathname === '/api/languages' && languages) return res(200, languages);
    if (u.pathname === '/api/corpora/1/align/propose') return res(200, proposal);
    if (u.pathname === '/api/corpora/1/align/confirm') return res(202, { job_id: 5 });
    if (/\/jobs$/.test(u.pathname)) return res(200, []);
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  stopAllJobs();
  vi.unstubAllGlobals();
  corpusStore.list = [];
  corpusStore.currentId = null;
});

async function propose() {
  render(AlignDocuments);
  const file = (n: string) => new File(['x'], n, { type: 'text/plain' });
  await fireEvent.change(screen.getByLabelText('Original document'), { target: { files: [file('a.txt')] } });
  await fireEvent.change(screen.getByLabelText('Translation'), { target: { files: [file('b.txt')] } });
  await fireEvent.click(screen.getByRole('button', { name: 'Propose alignment' }));
  await waitFor(() => expect(screen.getAllByTestId('link')).toHaveLength(3));
}

describe('AlignDocuments', () => {
  it('asks for the translation language when several others are set up, and sends it', async () => {
    languages = { es: 'Spanish', it: 'Italian', fr: 'French' };
    corpusStore.list = [...corpusStore.list, { id: 3, name: 'FR', lang: 'fr', project_id: null, is_reference: 0, docs: 0, tokens: 0 } as never];
    render(AlignDocuments);
    const pick = await screen.findByLabelText('Language of the translation');
    await fireEvent.change(pick, { target: { value: 'fr' } });
    const file = (n: string) => new File(['x'], n, { type: 'text/plain' });
    await fireEvent.change(screen.getByLabelText('Original document'), { target: { files: [file('a.txt')] } });
    await fireEvent.change(screen.getByLabelText('Translation'), { target: { files: [file('b.txt')] } });
    await fireEvent.click(screen.getByRole('button', { name: 'Propose alignment' }));
    await waitFor(() => expect(screen.getAllByTestId('link')).toHaveLength(3));
    expect(apiCalls()[0].search).toBe('?target_lang=fr');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm and import' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/corpora/1/align/confirm')).toBe(true));
    expect((calls.find((c) => c.path === '/api/corpora/1/align/confirm')!.body as { partner_corpus_id: number }).partner_corpus_id).toBe(3);
  });

  it('shows no language choice with exactly two languages', async () => {
    languages = { es: 'Spanish', it: 'Italian' };
    render(AlignDocuments);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/languages')).toBe(true));
    expect(screen.queryByLabelText('Language of the translation')).toBeNull();
  });

  it('asks for both files first', async () => {
    render(AlignDocuments);
    await fireEvent.click(screen.getByRole('button', { name: 'Propose alignment' }));
    expect(messages.current?.text ?? '').toContain('Choose both documents');
    expect(apiCalls()).toHaveLength(0);
  });

  it('shows the proposal with a text mark on low-confidence links and a report, and stores nothing yet', async () => {
    await propose();
    expect(apiCalls().map((c) => c.path)).toEqual(['/api/corpora/1/align/propose']);
    const rows = screen.getAllByTestId('link');
    expect(within(rows[0]).queryByText(/Check/)).toBeNull();
    expect(within(rows[1]).getByText(/Check/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('3 links: 1:1 ×1, 1:2 ×1, 1:0 ×1. 2 to check (67%).');
    expect(screen.getByRole('status')).toHaveTextContent('1 links have no text on one side');
  });

  it('deletes a pair, filters low-confidence links and confirms the edited links', async () => {
    await propose();
    await fireEvent.click(within(screen.getAllByTestId('link')[2]).getByRole('button', { name: 'Delete pair' }));
    expect(screen.getAllByTestId('link')).toHaveLength(2);
    await fireEvent.click(screen.getByRole('switch', { name: 'Only links to check' }));
    expect(screen.getAllByTestId('link')).toHaveLength(1);
    await fireEvent.click(screen.getByRole('switch', { name: 'Only links to check' }));
    await fireEvent.click(within(screen.getAllByTestId('link')[0]).getByRole('button', { name: 'Merge with next' }));
    expect(screen.getAllByTestId('link')).toHaveLength(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm and import' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/corpora/1/align/confirm')).toBe(true));
    const body = calls.find((c) => c.path === '/api/corpora/1/align/confirm')!.body as {
      links: { src: string[]; tgt: string[]; low: boolean }[]; partner_corpus_id: number; title: string;
    };
    expect(body.links).toEqual([{ src: ['Uno.', 'Dos.'], tgt: ['Uno it.', 'Dos a.', 'Dos b.'], low: false }]);
    expect(body.partner_corpus_id).toBe(2);
    expect(body.title).toBe('contrato');
    expect(screen.queryByTestId('link')).toBeNull();
  });

  it('splits a link at a chosen position', async () => {
    await propose();
    await fireEvent.click(within(screen.getAllByTestId('link')[1]).getByRole('button', { name: 'Split…' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    const rows = screen.getAllByTestId('link');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('Dos.');
    expect(rows[1]).toHaveTextContent('Dos a.');
    expect(rows[2]).toHaveTextContent('Dos b.');
  });
});
