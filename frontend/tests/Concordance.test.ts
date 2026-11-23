import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.svelte';
import Concordance from '../src/screens/Concordance.svelte';
import TermDialog from '../src/screens/TermDialog.svelte';
import StatusLine from '../src/lib/ui/StatusLine.svelte';
import { CORPUS_CHANGED, corpusStore } from '../src/lib/corpus.svelte';
import { messages } from '../src/lib/messages.svelte';
import { go } from '../src/lib/router.svelte';
import { setPlatform } from '../src/lib/shortcuts.svelte';
import { termStore } from '../src/lib/term.svelte';
import type { ConcLine } from '../src/lib/types';

const corpus = (id: number) => ({
  id, name: `C${id}`, lang: 'es', project_id: null, is_reference: 0, docs: 2, tokens: 100,
});

const line = (i: number, over: Partial<ConcLine> = {}): ConcLine => ({
  doc_id: i % 2 ? 1 : 2,
  doc: `doc${i % 2 ? 1 : 2}`,
  pos: i * 10,
  left: `left ${i}`,
  node: 'casa',
  right: `right ${i}`,
  ...over,
});

interface Call { method: string; url: string; path: string; params: URLSearchParams; body?: unknown }
let calls: Call[];
let conc: { status: number; body: unknown };
let bi: { status: number; body: unknown };
let gate: Promise<void> | null;

/** Holds /concordance responses until the returned function is called. */
function holdConcordance(): () => void {
  let release: () => void = () => {};
  gate = new Promise<void>((r) => (release = r));
  return release;
}

const res = (status: number, body: unknown) => ({
  ok: status < 400, status, statusText: 'x', json: async () => body,
});

beforeEach(() => {
  calls = [];
  gate = null;
  conc = { status: 200, body: { total: 2, lines: [line(1), line(2)] } };
  bi = { status: 200, body: { total: 0, lines: [] } };
  corpusStore.list = [corpus(1), corpus(2)];
  corpusStore.currentId = 1;
  corpusStore.aligned = false;
  corpusStore.loaded = true;
  corpusStore.clearScope();
  messages.clear();
  termStore.open = false;
  go('concordance');
  setPlatform('other');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const u = new URL(url, 'http://x');
    calls.push({
      method, url, path: u.pathname, params: u.searchParams,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const p = u.pathname;
    if (p === '/api/corpora') return res(200, corpusStore.list);
    if (p.endsWith('/concordance')) {
      if (gate) await gate;
      return res(conc.status, conc.body);
    }
    if (p.endsWith('/bilingual')) return res(bi.status, bi.body);
    if (p.endsWith('/parallel')) return res(200, { documents: corpusStore.aligned ? 1 : 0, segments: 0, partners: [] });
    if (p.endsWith('/facets')) return res(200, { tags: [], text_types: [], date_min: '', date_max: '' });
    if (p.endsWith('/scope')) return res(200, { filtered: false, docs: 2, words: 100, total_docs: 2, total_words: 100 });
    if (p.endsWith('/examples')) return res(200, []);
    if (p === '/api/projects') return res(200, []);
    if (p === '/api/languages') return res(200, { es: 'Spanish', it: 'Italian' });
    if (p === '/api/terms' && method === 'POST') return res(201, { id: 9 });
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.list = [];
  corpusStore.currentId = null;
  corpusStore.aligned = false;
  go('concordance');
});

const queryInput = () => document.getElementById('cc-query') as HTMLInputElement;
const searches = () => calls.filter((c) => /\/(concordance|bilingual)$/.test(c.path));
const bodyRows = () => screen.queryAllByRole('row').filter((r) => r.classList.contains('body'));

async function search(q: string) {
  await fireEvent.input(queryInput(), { target: { value: q } });
  await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(screen.queryByText(/hits ·/)).toBeInTheDocument());
}

describe('Concordance', () => {
  it('searches /concordance with q, unit, width, sort and scope params', async () => {
    render(Concordance);
    corpusStore.scope.tags = 'law';
    corpusStore.scope.type = 'contract';
    corpusStore.scope.from = '2020';
    await search('casa');
    const c = searches()[0];
    expect(c.path).toBe('/api/corpora/1/concordance');
    expect(c.params.get('q')).toBe('casa');
    expect(c.params.get('unit')).toBe('lemma');
    expect(c.params.get('width')).toBe('8');
    expect(c.params.get('sort')).toBe('doc');
    expect(c.params.get('limit')).toBe('300');
    expect(c.params.get('tags')).toBe('law');
    expect(c.params.get('text_type')).toBe('contract');
    expect(c.params.get('date_from')).toBe('2020');
  });

  it('renders results in order with the node highlighted and counts', async () => {
    render(Concordance);
    await search('casa');
    const rows = bodyRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('left 1');
    expect(rows[1]).toHaveTextContent('left 2');
    expect(within(rows[0]).getByText('casa')).toHaveClass('hit-query');
    expect(screen.getByText('2 hits · 2 documents')).toBeInTheDocument();
  });

  it('shows a hit containing a script tag literally', async () => {
    const evil = '<script>alert(1)</script>';
    conc.body = { total: 1, lines: [line(1, { right: evil })] };
    const { container } = render(Concordance);
    await search('casa');
    expect(screen.getAllByText(evil).length).toBeGreaterThan(0);
    expect(container.querySelector('script')).toBeNull();
  });

  it('hides "Source + target" when the corpus is not aligned', () => {
    render(Concordance);
    expect(screen.queryByRole('switch', { name: 'Source + target' })).toBeNull();
  });

  it('calls /bilingual when "Source + target" is on', async () => {
    corpusStore.aligned = true;
    bi.body = { total: 1, lines: [line(1, { source: 'La casa', target: 'La casa' })] };
    render(Concordance);
    await fireEvent.click(screen.getByRole('switch', { name: 'Source + target' }));
    await search('casa');
    expect(searches()[0].path).toBe('/api/corpora/1/bilingual');
    expect(screen.getByRole('columnheader', { name: 'Source segment' })).toBeInTheDocument();
  });

  it('shows the empty state with the query on zero hits', async () => {
    conc.body = { total: 0, lines: [] };
    render(Concordance);
    await search('zzz');
    expect(screen.getByText('No hits for “zzz”')).toBeInTheDocument();
  });

  it('drops the selection when a new search returns zero hits', async () => {
    render(Concordance);
    await search('casa');
    await fireEvent.click(bodyRows()[0]);
    expect(screen.getByRole('region', { name: 'Selected hit' })).toBeInTheDocument();
    conc.body = { total: 0, lines: [] };
    await fireEvent.input(queryInput(), { target: { value: 'zzz' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByText('No hits for “zzz”')).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Selected hit' })).toBeNull();
  });

  it('on an API 400 shows the message and keeps previous results and form values', async () => {
    render(StatusLine);
    render(Concordance);
    await search('casa');
    conc = { status: 400, body: { detail: 'Bad query' } };
    await fireEvent.input(queryInput(), { target: { value: 'ca(' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Status' })).toHaveTextContent('Bad query'));
    expect(messages.current?.kind).toBe('err');
    expect(bodyRows()).toHaveLength(2);
    expect(queryInput().value).toBe('ca(');
    expect(screen.getByText('2 hits · 2 documents')).toBeInTheDocument();
  });

  it('with no corpus selected shows EmptyState and makes no request', async () => {
    corpusStore.currentId = null;
    corpusStore.list = [];
    go('concordance', { q: 'casa' });
    render(Concordance);
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('Create or select a corpus first.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('clears results and selection when the corpus changes', async () => {
    render(Concordance);
    await search('casa');
    await fireEvent.click(bodyRows()[0]);
    expect(screen.getByRole('region', { name: 'Selected hit' })).toBeInTheDocument();
    corpusStore.currentId = 2;
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
    await tick();
    expect(bodyRows()).toHaveLength(0);
    expect(screen.queryByText(/hits ·/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Selected hit' })).toBeNull();
  });

  it('Mod+E on a selected row opens TermDialog prefilled with the node and the segment', async () => {
    render(TermDialog);
    render(Concordance);
    await search('casa');
    const grid = screen.getByRole('grid');
    grid.focus();
    await fireEvent.keyDown(grid, { key: 'ArrowDown' });
    await fireEvent.keyDown(grid, { key: 'ArrowDown' });
    await fireEvent.keyDown(grid, { key: 'e', ctrlKey: true });
    await tick();
    const dlg = screen.getByRole('dialog', { name: 'Add term' });
    expect(dlg).toHaveAttribute('open');
    expect(within(dlg).getByLabelText('Source term')).toHaveValue('casa');
    expect(within(dlg).getByLabelText('Example sentence')).toHaveValue('left 2 casa right 2');
    expect(within(dlg).getByLabelText('Example source')).toHaveValue('doc2');
  });

  it('saving the term posts to /api/terms and closes with a success message', async () => {
    render(TermDialog);
    render(Concordance);
    await search('casa');
    await fireEvent.click(bodyRows()[0]);
    await fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    await tick();
    const dlg = screen.getByRole('dialog', { name: 'Add term' });
    await fireEvent.input(within(dlg).getByLabelText('Translation'), { target: { value: 'casa' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dlg).not.toHaveAttribute('open'));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/terms');
    expect(post?.body).toMatchObject({
      src_term: 'casa', tgt_term: 'casa', src_lang: 'es', tgt_lang: 'it', status: 'candidate',
      context: 'left 1 casa right 1', context_source: 'doc1', origin: 'concordance', project_id: null,
    });
    expect(messages.current?.kind).toBe('ok');
  });

  it('Mod+K focuses the query input', async () => {
    render(App);
    await waitFor(() => expect(queryInput()).toBeInTheDocument());
    queryInput().blur();
    await fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(document.activeElement).toBe(queryInput()));
  });

  it('restores the query and options from route params and runs the search', async () => {
    go('concordance', { q: 'perro', unit: 'form', width: '5', sort: 'left' });
    render(Concordance);
    await waitFor(() => expect(searches()).toHaveLength(1));
    expect(queryInput().value).toBe('perro');
    const c = searches()[0];
    expect(c.params.get('q')).toBe('perro');
    expect(c.params.get('unit')).toBe('form');
    expect(c.params.get('width')).toBe('5');
    expect(c.params.get('sort')).toBe('left');
  });

  it('keeps the previous rows and selection while a new search is loading', async () => {
    render(Concordance);
    await search('casa');
    await fireEvent.click(bodyRows()[1]);
    const release = holdConcordance();
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await tick();
    expect(screen.getByRole('grid')).toHaveAttribute('aria-busy', 'true');
    expect(bodyRows()).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Selected hit' })).toHaveTextContent('left 2');
    release();
    await waitFor(() => expect(screen.getByRole('grid')).toHaveAttribute('aria-busy', 'false'));
    // same keys come back: the selection survives the refetch
    expect(screen.getByRole('region', { name: 'Selected hit' })).toHaveTextContent('left 2');
  });

  it('ignores a response that arrives after the corpus changed', async () => {
    render(Concordance);
    const release = holdConcordance();
    await fireEvent.input(queryInput(), { target: { value: 'casa' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    corpusStore.currentId = 2;
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
    release();
    await new Promise((r) => setTimeout(r, 0));
    await tick();
    expect(bodyRows()).toHaveLength(0);
    expect(screen.queryByText(/hits ·/)).toBeNull();
  });

  it('persists the query and options in route params when searching', async () => {
    render(Concordance);
    await search('casa');
    expect(window.location.hash).toContain('q=casa');
    expect(window.location.hash).toContain('unit=lemma');
  });
});
