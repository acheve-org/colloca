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
    if (/^\/api\/terms\/\d+$/.test(p) && method === 'PATCH') {
      if (patchGate) await patchGate;
      return res(patchStatus, patchStatus < 400 ? { ok: true } : { detail: 'An approved term needs a translation' });
    }
    if (p === '/api/terms' && method === 'PATCH') return res(patchStatus, patchStatus < 400 ? { updated: 2 } : { detail: '1 selected entries have no translation' });
    if (p === '/api/terms/delete' && method === 'POST') return res(200, { deleted: 2 });
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

const busyDone = () => !(screen.getByLabelText('Status of term1') as HTMLSelectElement).disabled;
const listCalls = () => calls.filter((c) => c.path === '/api/terms' && c.method === 'GET');
const bodyRows = () => screen.queryAllByRole('row').filter((r) => r.classList.contains('body'));
const firstCells = () => bodyRows().map((r) => within(r).getAllByRole('gridcell')[1].textContent ?? '');

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
    const statusOf = (i: number) => within(rows[i]).getByRole('combobox', { name: /^Status of/ }) as HTMLSelectElement;
    expect(statusOf(0).value).toBe('candidate');
    expect(statusOf(0).selectedOptions[0].textContent).toBe('Candidate');
    expect(statusOf(1)).toHaveClass('approved');
    expect(statusOf(1).selectedOptions[0].textContent).toBe('Approved');
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
    await waitFor(() =>
      expect((within(bodyRows()[0]).getByRole('combobox', { name: /^Status of/ }) as HTMLSelectElement).value).toBe('approved'),
    );
    expect(listCalls().length).toBe(1);
  });

  it('Mark forbidden PATCHes forbidden; a server error keeps the row and shows the message', async () => {
    patchStatus = 400;
    await ready();
    await fireEvent.click(bodyRows()[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Mark forbidden' }));
    await waitFor(() => expect(messages.current?.text).toBe('An approved term needs a translation'));
    expect(calls.find((x) => x.method === 'PATCH')!.body).toEqual({ status: 'forbidden' });
    expect((within(bodyRows()[0]).getByRole('combobox', { name: /^Status of/ }) as HTMLSelectElement).value).toBe('candidate');
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
      expect(u.searchParams.get('status')).toBe('approved,admitted');
      expect(u.searchParams.get('project')).toBe('none');
    }
    await fireEvent.click(screen.getByRole('switch', { name: 'Include candidates' }));
    expect(href('CSV').searchParams.get('status')).toBe('approved,admitted,candidate');
  });

  it('sends the new filters and the sort to the server', async () => {
    await ready();
    await fireEvent.input(screen.getByLabelText('Modified since'), { target: { value: '2026-01-31' } });
    await fireEvent.change(screen.getByLabelText('Modified since'));
    await waitFor(() => expect(listCalls().length).toBe(2));
    expect(listCalls()[1].params.get('modified_since')).toBe('2026-01-31');
    await fireEvent.change(screen.getByLabelText('Part of speech'), { target: { value: 'verb' } });
    await waitFor(() => expect(listCalls().length).toBe(3));
    expect(listCalls()[2].params.get('pos')).toBe('verb');
    await fireEvent.click(screen.getByRole('columnheader', { name: /Source/ }));
    await waitFor(() => expect(listCalls().length).toBe(4));
    expect([listCalls()[3].params.get('sort'), listCalls()[3].params.get('dir')]).toEqual(['src_term', 'asc']);
    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(listCalls().length).toBe(5));
    expect(listCalls()[4].params.get('pos')).toBeNull();
  });

  it('edits the translation and the status inline with PATCH, and puts the value back on error', async () => {
    await ready();
    const input = screen.getByLabelText('Translation of term1') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'nuevo' } });
    await fireEvent.change(input);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/api/terms/1', body: { tgt_term: 'nuevo' } });
    await waitFor(() => expect(busyDone()).toBe(true));
    patchStatus = 400;
    const sel = screen.getByLabelText('Status of term1') as HTMLSelectElement;
    await fireEvent.change(sel, { target: { value: 'admitted' } });
    await waitFor(() => expect(messages.current?.text).toBe('An approved term needs a translation'));
    expect(sel.value).toBe('candidate');
  });

  it('applies a status to the ticked rows and deletes them after confirmation', async () => {
    await ready();
    expect(screen.queryByRole('group', { name: 'Bulk actions' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByLabelText('Select all rows shown'));
    const bar = screen.getByRole('group', { name: 'Bulk actions' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    await fireEvent.change(within(bar).getByLabelText('Set status…'), { target: { value: 'admitted' } });
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/api/terms', body: { ids: [1, 2], status: 'admitted' } });
    await waitFor(() => expect(messages.current?.text).toBe('2 entries updated.'));
    await fireEvent.click(within(screen.getByRole('group', { name: 'Bulk actions' })).getByRole('button', { name: 'Delete selected' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete selected' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/api/terms/delete', body: { ids: [1, 2] } });
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

  it('Edit offers "Find examples" in the current corpus when it has the source language (old dialog)', async () => {
    terms.body = [term(1)];
    type Fetch = (url: string, init?: RequestInit) => Promise<unknown>;
    const fetchMock = vi.mocked(globalThis.fetch as unknown as Fetch);
    const inner = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (new URL(url, 'http://x').pathname === '/api/corpora/1/examples') {
        calls.push({ method: 'GET', path: '/api/corpora/1/examples', params: new URL(url, 'http://x').searchParams });
        return res(200, [{ sentence: 'Un term1 aquí.', doc: 'Doc A' }]);
      }
      return inner(url, init);
    });
    render(Termbase);
    render(TermDialog);
    await waitFor(() => expect(bodyRows().length).toBe(1));
    await fireEvent.click(bodyRows()[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dlg = screen.getByRole('dialog');
    // nothing is searched until asked: the entry keeps its own example
    expect(calls.some((c) => c.path.endsWith('/examples'))).toBe(false);
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Find examples in this corpus' }));
    const ex = await within(dlg).findByRole('button', { name: /Un term1 aquí/ });
    expect(calls.find((c) => c.path.endsWith('/examples'))!.params.get('q')).toBe('term1');
    await fireEvent.click(ex);
    expect((within(dlg).getByLabelText('Example sentence') as HTMLTextAreaElement).value).toBe('Un term1 aquí.');
    expect((within(dlg).getByLabelText('Example source') as HTMLInputElement).value).toBe('Doc A');
  });

  it('Edit hides "Find examples" when the current corpus is in another language than the entry', async () => {
    terms.body = [term(1, { src_lang: 'it', tgt_lang: 'es' })];
    render(Termbase);
    render(TermDialog);
    await waitFor(() => expect(bodyRows().length).toBe(1));
    await fireEvent.click(bodyRows()[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).queryByRole('button', { name: 'Find examples in this corpus' })).toBeNull();
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

describe('Termbase concepts', () => {
  const concept = () => [
    term(1, { src_term: 'vivienda', tgt_term: 'abitazione', status: 'approved', concept_id: 5, project_id: 7, src_gender: 'feminine',
              tgt_gender: 'feminine', tgt_number: 'plural', src_note: 'Uso general.' }),
    term(2, { src_term: 'vivienda', tgt_term: 'casa', status: 'admitted', concept_id: 5, project_id: 7 }),
    term(3, { src_term: 'domicilio', tgt_term: 'abitazione', status: 'approved', concept_id: 5, project_id: 7, src_gender: 'masculine' }),
    term(4, { src_term: 'contrato', tgt_term: 'contratto', status: 'approved', concept_id: 6, project_id: 7 }),
  ];
  // rows in the order of `concept()`: vivienda/abitazione, vivienda/casa, domicilio/abitazione, contrato/contratto
  const select = async (index: number) => {
    await ready();
    await fireEvent.click(bodyRows()[index]);
  };

  it('shows the gender, number and notes of the selected term and its synonyms in the same concept', async () => {
    terms = { status: 200, body: concept() };
    await select(0);
    const strip = screen.getByRole('region', { name: 'Entry' });
    expect(within(strip).getByText('feminine')).toBeInTheDocument();
    expect(within(strip).getByText('feminine, plural')).toBeInTheDocument();
    expect(within(strip).getByText('Uso general.')).toBeInTheDocument();
    const same = within(strip).getByText('Same concept').nextElementSibling!;
    expect(same.textContent).toContain('vivienda → casa');
    expect(same.textContent).toContain('domicilio → abitazione');
    expect(same.textContent).not.toContain('contrato');
  });

  it('adds a translation to the concept: same source term, the concept id sent on save', async () => {
    terms = { status: 200, body: concept() };
    await select(3);
    await fireEvent.click(screen.getByRole('button', { name: 'Add translation' }));
    expect(termStore.open).toBe(true);
    expect(termStore.draft.src_term).toBe('contrato');
    expect(termStore.draft.tgt_term).toBe('');
    expect(termStore.ctx).toMatchObject({ concept_id: 6, project_id: 7, src_lang: 'es', tgt_lang: 'it' });
  });

  it('adds a source synonym: empty source term, the translation prefilled, no corpus needed', async () => {
    corpusStore.list = [];
    corpusStore.currentId = null;
    terms = { status: 200, body: concept() };
    await select(0);
    await fireEvent.click(screen.getByRole('button', { name: 'Add source synonym' }));
    expect(termStore.open).toBe(true);
    expect(termStore.draft.src_term).toBe('');
    expect(termStore.draft.tgt_term).toBe('abitazione');
    expect(termStore.draft.src_gender).toBe('');
    expect(termStore.draft.tgt_gender).toBe('feminine');
    expect(termStore.ctx?.concept_id).toBe(5);
  });

  it('the synonym buttons are off for a row without a concept', async () => {
    await ready();
    await fireEvent.click(bodyRows()[0]);
    expect(screen.getByRole('button', { name: 'Add translation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add source synonym' })).toBeDisabled();
  });

  it('editing opens the dialog with the stored gender, number and notes', async () => {
    terms = { status: 200, body: concept() };
    await select(0);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(termStore.draft).toMatchObject({ src_gender: 'feminine', tgt_gender: 'feminine', tgt_number: 'plural', src_note: 'Uso general.' });
  });
});

describe('Term dialog data', () => {
  it('saves gender, number and notes, and joins the concept when adding a synonym', async () => {
    calls.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, path: new URL(url, 'http://x').pathname, params: new URL(url, 'http://x').searchParams, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/languages') return res(200, { es: 'Spanish', it: 'Italian' });
      return res(201, { id: 9, concept_id: 5 });
    }));
    render(TermDialog);
    const { openTerm } = await import('../src/lib/term.svelte');
    openTerm({ source: 'domicilio', target: 'abitazione', conceptId: 5, projectId: 7, srcLang: 'es', tgtLang: 'it', status: 'approved' });
    await screen.findByRole('dialog');
    await fireEvent.change(screen.getByLabelText('Gender (source)'), { target: { value: 'masculine' } });
    await fireEvent.change(screen.getByLabelText('Number (target)'), { target: { value: 'plural' } });
    await fireEvent.input(screen.getByLabelText('Usage note (target)'), { target: { value: 'Più formale.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/terms')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      src_term: 'domicilio', tgt_term: 'abitazione', concept_id: 5, project_id: 7, src_lang: 'es', tgt_lang: 'it',
      src_gender: 'masculine', tgt_number: 'plural', tgt_note: 'Più formale.',
    });
  });
});
