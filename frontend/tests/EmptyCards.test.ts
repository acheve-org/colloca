import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { corpusStore } from '../src/lib/corpus.svelte';
import { setLang } from '../src/lib/i18n';
import { messages } from '../src/lib/messages.svelte';
import { basket, syncBasket } from '../src/lib/candidates.svelte';
import { projectStore } from '../src/lib/projects.svelte';
import { go, route } from '../src/lib/router.svelte';
import { scopeView } from '../src/lib/scope.svelte';
import Candidates from '../src/screens/Candidates.svelte';
import Concordance from '../src/screens/Concordance.svelte';
import Projects from '../src/screens/Projects.svelte';
import Termbase from '../src/screens/Termbase.svelte';
import WordCloud from '../src/screens/WordCloud.svelte';

interface Call { path: string; params: URLSearchParams }
let calls: Call[];

const res = (body: unknown) => ({ ok: true, status: 200, statusText: 'ok', json: async () => body });

beforeEach(() => {
  setLang('en');
  calls = [];
  localStorage.clear();
  route.params = {};
  corpusStore.list = [{ id: 1, name: 'C1', lang: 'es', project_id: 9, is_reference: 0, docs: 2, tokens: 100 } as never];
  corpusStore.currentId = 1;
  corpusStore.aligned = false;
  corpusStore.loaded = true;
  corpusStore.clearScope();
  scopeView.info = null;
  messages.clear();
  basket.key = '';
  basket.items = [];
  syncBasket();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = new URL(url, 'http://x');
    calls.push({ path: u.pathname, params: u.searchParams });
    const p = u.pathname;
    if (p.endsWith('/concordance')) return res({ total: 0, lines: [] });
    if (p.endsWith('/frequency')) return res([]);
    if (p.endsWith('/facets')) return res({ tags: [], text_types: [], date_min: '', date_max: '' });
    if (p.endsWith('/scope')) return res({ filtered: false, docs: 2, words: 100, total_docs: 2, total_words: 100 });
    if (p === '/api/terms') return res([]);
    if (p === '/api/projects') return res(projects);
    if (p === '/api/corpora') return res(corpusStore.list);
    if (p === '/api/languages') return res({ es: 'Spanish' });
    return res([]);
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  corpusStore.clearScope();
  scopeView.info = null;
  corpusStore.list = [];
  corpusStore.currentId = null;
  route.params = {};
});

let projects: unknown[] = [];
const searches = () => calls.filter((c) => c.path.endsWith('/concordance'));

async function search(q: string) {
  await fireEvent.input(document.getElementById('cc-query') as HTMLInputElement, { target: { value: q } });
  await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByText(`No hits for “${q}”`);
}

describe('Concordance no hits', () => {
  it('a lemma search without a filter offers only the exact-form button, and it re-searches by form', async () => {
    render(Concordance);
    await search('ráfaga');
    const card = screen.getByRole('status');
    expect(within(card).getByText('You searched by lemma: try the exact form.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear the filter and search' })).toBeNull();
    expect(within(card).getAllByRole('button')).toHaveLength(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Search the exact form' }));
    await waitFor(() => expect(searches()).toHaveLength(2));
    expect(searches()[1].params.get('unit')).toBe('form');
    expect(searches()[1].params.get('q')).toBe('ráfaga');
    await waitFor(() => expect(route.params.unit).toBe('form'));
  });

  it('with a filter it names the filter and a button clears it and re-runs the same query', async () => {
    corpusStore.scope.tags = 'wind';
    scopeView.info = { filtered: true, docs: 1, total_docs: 2, words: 10, total_words: 100 };
    render(Concordance);
    await search('ráfaga');
    const card = screen.getByRole('status');
    expect(
      within(card).getByText('The document filter (Tags: wind) limits this search to 1 of 2 documents.'),
    ).toBeInTheDocument();
    expect(searches()[0].params.get('tags')).toBe('wind');
    await fireEvent.click(screen.getByRole('button', { name: 'Clear the filter and search' }));
    expect(corpusStore.scope.tags).toBe('');
    await waitFor(() => expect(searches()).toHaveLength(2));
    expect(searches()[1].params.get('q')).toBe('ráfaga');
    expect(searches()[1].params.get('tags') ?? '').toBe('');
  });

  it('with unit form and no filter there are no buttons, and the card is a live region', async () => {
    go('concordance', { unit: 'form' });
    render(Concordance);
    await search('ráfaga');
    const card = screen.getByRole('status');
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
    expect(within(card).getByText('Check the spelling or try another word.')).toBeInTheDocument();
  });

  it('a filter known only by its parts still gets the plain sentence when counts are unknown', async () => {
    corpusStore.scope.tags = 'wind';
    go('concordance', { unit: 'form' });
    render(Concordance);
    await search('ráfaga');
    expect(screen.getByText('A document filter is active.')).toBeInTheDocument();
  });
});

describe('Word cloud nothing to draw', () => {
  it('with a filter, a button clears it and redraws; the filter is not cleared on its own', async () => {
    corpusStore.scope.tags = 'wind';
    render(WordCloud);
    await fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
    await screen.findByText('Nothing to draw.');
    expect(corpusStore.scope.tags).toBe('wind');
    const before = calls.filter((c) => c.path.endsWith('/frequency')).length;
    await fireEvent.click(screen.getByRole('button', { name: 'Clear the filter' }));
    expect(corpusStore.scope.tags).toBe('');
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/frequency'))).toHaveLength(before + 1));
  });

  it('without a filter there is no button', async () => {
    render(WordCloud);
    await fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
    await screen.findByText('Nothing to draw.');
    expect(screen.queryByRole('button', { name: 'Clear the filter' })).toBeNull();
  });
});

describe('Termbase empty', () => {
  it('Import a glossary opens the import dialog; the other action links to the Concordance', async () => {
    render(Termbase);
    await screen.findByText('No entries here yet.');
    expect(screen.getByRole('link', { name: 'Add terms from the Concordance' })).toHaveAttribute('href', '#/concordance');
    await fireEvent.click(screen.getByRole('button', { name: 'Import a glossary' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('Candidates empty', () => {
  it('links to the Frequency list', async () => {
    render(Candidates);
    expect(screen.getByText('No candidates yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the Frequency list' })).toHaveAttribute('href', '#/frequency');
  });
});

describe('Project without corpora', () => {
  it('New corpus in the card opens the new-corpus dialog', async () => {
    projects = [{ id: 9, name: 'Empty', corpora: 0, trashed: 0, terms: 0 }];
    corpusStore.list = [];
    corpusStore.currentId = null;
    projectStore.list = [];
    render(Projects);
    await screen.findByText('Create a corpus');
    const buttons = screen.getAllByRole('button', { name: 'New corpus' });
    expect(buttons).toHaveLength(2);
    await fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
