import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Termbase from '../src/screens/Termbase.svelte';
import TermDialog from '../src/screens/TermDialog.svelte';
import { CORPUS_CHANGED, corpusStore } from '../src/lib/corpus.svelte';
import { messages } from '../src/lib/messages.svelte';
import { go } from '../src/lib/router.svelte';
import { termStore } from '../src/lib/term.svelte';
import type { Term } from '../src/lib/types';

const term = (id: number, over: Partial<Term> = {}): Term => ({
  id, project_id: null, project: null, src_lang: 'es', tgt_lang: 'it', src_term: `term${id}`,
  tgt_term: `tr${id}`, pos: 'noun', status: 'candidate', domain: '', definition: '', notes: '',
  context: '', context_source: '', origin: 'manual', ...over,
});

interface Call { method: string; path: string; params: URLSearchParams; body?: Record<string, unknown> }
let calls: Call[];
let terms: { status: number; body: unknown };
let gate: Promise<void> | null;
let patchStatus: number;
let patchGate: Promise<void> | null;

const res = (status: number, body: unknown) => ({
  ok: status < 400, status, statusText: 'x', json: async () => body,
});

const corpus = (id: number, project_id: number | null) => ({
  id, name: `C${id}`, lang: 'es', project_id, is_reference: 0, docs: 1, tokens: 10,
});

beforeEach(() => {
  calls = [];
  gate = null;
  patchStatus = 200;
  patchGate = null;
  terms = { status: 200, body: [term(1), term(2, { status: 'approved' })] };
  corpusStore.list = [corpus(1, null), corpus(2, 7)];
  corpusStore.currentId = 1;
  corpusStore.loaded = true;
  messages.clear();
  termStore.open = false;
  go('termbase');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const u = new URL(url, 'http://x');
    calls.push({ method, path: u.pathname, params: u.searchParams, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const p = u.pathname;
    if (p === '/api/terms' && method === 'GET') {
      if (gate) await gate;
      return res(terms.status, terms.body);
    }
    if (/^\/api\/terms\/\d+$/.test(p) && method === 'PATCH') { if (patchGate) await patchGate; }
    if (/^\/api\/terms\/\d+$/.test(p) && method === 'PATCH') return res(patchStatus, patchStatus < 400 ? { ok: true } : { detail: 'An approved term needs a translation' });
    if (/^\/api\/terms\/\d+$/.test(p) && method === 'DELETE') return { ok: true, status: 204, statusText: '', json: async () => null };
    if (p === '/api/projects') return res(200, [{ id: 7, name: 'Acme', corpora: 1 }]);
    if (p === '/api/languages') return res(200, { es: 'Spanish', it: 'Italian' });
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.list = [];
  corpusStore.currentId = null;
  go('termbase');
});

const listCalls = () => calls.filter((c) => c.path === '/api/terms' && c.method === 'GET');
const bodyRows = () => screen.queryAllByRole('row').filter((r) => r.classList.contains('body'));
const firstCells = () => bodyRows().map((r) => within(r).getAllByRole('gridcell')[0].textContent ?? '');

async function ready() {
  render(Termbase);
  await waitFor(() => expect(bodyRows().length).toBeGreaterThan(0));
}

describe('Termbase', () => {
  it('loads the list scoped to the corpus project, with the status filter param', async () => {
    await ready();
    expect(listCalls()[0].params.get('project')).toBe('none');
    expect(listCalls()[0].params.get('status')).toBeNull();
    await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'approved' } });
    await waitFor(() => expect(listCalls().length).toBe(2));
    expect(listCalls()[1].params.get('status')).toBe('approved');
    expect(listCalls()[1].params.get('project')).toBe('none');
  });

  it('works with no corpus selected', async () => {
    corpusStore.list = [];
    corpusStore.currentId = null;
    await ready();
    expect(listCalls()[0].params.get('project')).toBeNull();
    expect(screen.queryByText('Select or create a corpus first.')).not.toBeInTheDocument();
  });

  it('searches the text with q and keeps a pinned scope across corpus changes', async () => {
    await ready();
    await fireEvent.input(screen.getByLabelText('Search terms'), { target: { value: 'ab' } });
    await waitFor(() => expect(listCalls().length).toBe(2));
    expect(listCalls()[1].params.get('q')).toBe('ab');
    await fireEvent.change(screen.getByLabelText('Termbase of'), { target: { value: '7' } });
    await waitFor(() => expect(listCalls().length).toBe(3));
    expect(listCalls()[2].params.get('project')).toBe('7');
    corpusStore.currentId = 2;
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED));
    await waitFor(() => expect(listCalls().length).toBe(4));
    expect(listCalls()[3].params.get('project')).toBe('7');
  });

  it('follows the corpus project when the scope was not pinned', async () => {
    await ready();
    corpusStore.currentId = 2;
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED));
    await waitFor(() => expect(listCalls().length).toBe(2));
    expect(listCalls()[1].params.get('project')).toBe('7');
  });

  it('restores filters from the route and loads once the corpus store has loaded', async () => {
    corpusStore.loaded = false;
    go('termbase', { project: 'all', status: 'forbidden', q: 'xy' });
    render(Termbase);
    await Promise.resolve();
    expect(listCalls().length).toBe(0);
    corpusStore.loaded = true;
    await waitFor(() => expect(listCalls().length).toBe(1));
    const p = listCalls()[0].params;
    expect([p.get('project'), p.get('status'), p.get('q')]).toEqual([null, 'forbidden', 'xy']);
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('forbidden');
  });

  it('shows the status label next to the colour', async () => {
    await ready();
    const rows = bodyRows();
    expect(within(rows[0]).getByText('Candidate')).toHaveClass('badge', 'candidate');
    expect(within(rows[1]).getByText('Approved')).toHaveClass('badge', 'approved');
  });

  it('sorts by source ignoring accents and case', async () => {
    terms.body = [term(1, { src_term: 'zebra' }), term(2, { src_term: 'abeja' }), term(3, { src_term: 'Ábaco' })];
    await ready();
    await fireEvent.click(screen.getByRole('columnheader', { name: /Source/ }));
    await waitFor(() => expect(firstCells().map((s) => s.split('es→')[0].trim())).toEqual(['Ábaco', 'abeja', 'zebra']));
  });

  it('Approve PATCHes {status:"approved"} and updates the row', async () => {
    await ready();
    await fireEvent.click(bodyRows()[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const c = calls.find((x) => x.method === 'PATCH')!;
    expect(c.path).toBe('/api/terms/1');
    expect(c.body).toEqual({ status: 'approved' });
    await waitFor(() => expect(within(bodyRows()[0]).getByText('Approved')).toBeInTheDocument());
    expect(listCalls().length).toBe(1);
  });

  it('Mark forbidden PATCHes forbidden; a server error keeps the row and shows the message', async () => {
    patchStatus = 400;
    await ready();
    await fireEvent.click(bodyRows()[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Mark forbidden' }));
    await waitFor(() => expect(messages.current?.text).toBe('An approved term needs a translation'));
    expect(calls.find((x) => x.method === 'PATCH')!.body).toEqual({ status: 'forbidden' });
    expect(within(bodyRows()[0]).getByText('Candidate')).toBeInTheDocument();
  });

  it('Delete asks for confirmation, then DELETEs and removes the row', async () => {
    await ready();
    await fireEvent.click(bodyRows()[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const dlg = screen.getByRole('dialog');
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')!.path).toBe('/api/terms/1');
    await waitFor(() => expect(bodyRows().length).toBe(1));
    expect(screen.queryByRole('region', { name: 'Entry' })).not.toBeInTheDocument();
    expect(screen.getByRole('grid')).toHaveFocus();
  });

  it('cancelling the confirmation deletes nothing', async () => {
    await ready();
    await fireEvent.click(bodyRows()[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(bodyRows().length).toBe(2);
  });

  it('export links carry the format, the project and the approved-only flag', async () => {
    await ready();
    const href = (name: string) => new URL(screen.getByRole('link', { name }).getAttribute('href')!, 'http://x');
    for (const [name, fmt] of [['TBX (ISO 2019)', 'tbx'], ['TBX 2008 (most CAT tools)', 'tbx2'], ['Excel', 'xlsx'], ['CSV', 'csv']]) {
      const u = href(name);
      expect(u.pathname).toBe('/api/terms/export');
      expect(u.searchParams.get('format')).toBe(fmt);
      expect(u.searchParams.get('status')).toBe('approved');
      expect(u.searchParams.get('project')).toBe('none');
    }
    await fireEvent.click(screen.getByRole('switch', { name: 'Include candidates' }));
    expect(href('CSV').searchParams.get('status')).toBe('approved,candidate');
  });

  it('keeps the previous rows and reports the error when a reload fails', async () => {
    await ready();
    terms = { status: 500, body: { detail: 'boom' } };
    await fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(messages.current?.text).toBe('boom'));
    expect(bodyRows().length).toBe(2);
  });

  it('ignores a stale response', async () => {
    await ready();
    let release: () => void = () => {};
    gate = new Promise<void>((r) => (release = r));
    terms = { status: 200, body: [term(8, { src_term: 'old' })] };
    await fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    gate = null;
    terms = { status: 200, body: [term(9, { src_term: 'new' })] };
    await fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(firstCells()[0]).toContain('new'));
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(firstCells()[0]).toContain('new');
  });

  it('Edit opens the dialog prefilled and saves with PATCH, then reloads', async () => {
    terms.body = [term(1, { definition: 'a def', domain: 'law' })];
    render(Termbase);
    render(TermDialog);
    await waitFor(() => expect(bodyRows().length).toBe(1));
    await fireEvent.click(bodyRows()[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByRole('heading', { name: 'Edit term' })).toBeInTheDocument();
    expect((within(dlg).getByLabelText('Source term') as HTMLInputElement).value).toBe('term1');
    expect((within(dlg).getByLabelText('Domain') as HTMLInputElement).value).toBe('law');
    await fireEvent.input(within(dlg).getByLabelText('Translation'), { target: { value: 'nuevo' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const c = calls.find((x) => x.method === 'PATCH')!;
    expect(c.path).toBe('/api/terms/1');
    expect(c.body).toMatchObject({ src_term: 'term1', tgt_term: 'nuevo', domain: 'law', definition: 'a def' });
    expect(calls.some((x) => x.method === 'POST')).toBe(false);
    await waitFor(() => expect(listCalls().length).toBe(2));
  });

  it('shows an empty state when there are no entries', async () => {
    terms.body = [];
    render(Termbase);
    await waitFor(() => expect(screen.getByText('No entries here yet.')).toBeInTheDocument());
  });

  it('disables the row actions while a status change is in flight, then Edit sees the new status', async () => {
    render(Termbase);
    render(TermDialog);
    await waitFor(() => expect(bodyRows().length).toBe(2));
    await fireEvent.click(bodyRows()[0]);
    let release: () => void = () => {};
    patchGate = new Promise<void>((r) => (release = r));
    await fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    for (const n of ['Edit', 'Approve', 'Mark forbidden', 'Delete']) {
      await waitFor(() => expect(screen.getByRole('button', { name: n })).toBeDisabled());
    }
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled());
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(termStore.draft.status).toBe('approved');
  });

  it('a list response in flight cannot overwrite a status change or bring back a deleted row', async () => {
    await ready();
    await fireEvent.click(bodyRows()[0]);
    let release: () => void = () => {};
    gate = new Promise<void>((r) => (release = r));
    terms = { status: 200, body: [term(1), term(2, { status: 'approved' })] };
    await fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(within(bodyRows()[0]).getByText('Approved')).toBeInTheDocument());
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(within(bodyRows()[0]).getByText('Approved')).toBeInTheDocument();
    gate = null;
    gate = new Promise<void>((r) => (release = r));
    await fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(bodyRows().length).toBe(1));
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(bodyRows().length).toBe(1);
  });

  it('offers the distinct loaded domains as suggestions in the dialog', async () => {
    terms.body = [term(1, { domain: 'law' }), term(2, { domain: 'law' }), term(3, { domain: 'tech' })];
    render(Termbase);
    render(TermDialog);
    await waitFor(() => expect(bodyRows().length).toBe(3));
    expect(termStore.domains).toEqual(['law', 'tech']);
    await fireEvent.click(bodyRows()[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const input = within(screen.getByRole('dialog')).getByLabelText('Domain') as HTMLInputElement;
    const list = document.getElementById(input.getAttribute('list')!)!;
    expect([...list.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['law', 'tech']);
  });
});
