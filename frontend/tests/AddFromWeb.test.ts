import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddDocuments from '../src/screens/AddDocuments.svelte';
import { addUrlList, draft, importSelected, resetDraft, work } from '../src/lib/addDocuments.svelte';
import { CORPUS_CHANGED, corpusStore } from '../src/lib/corpus.svelte';
import { stopAllJobs } from '../src/lib/jobs.svelte';
import { messages } from '../src/lib/messages.svelte';
import { go, route } from '../src/lib/router.svelte';

interface Call { method: string; path: string; params: URLSearchParams; body?: unknown }
let calls: Call[];
let discovered: { links: { url: string; text: string; same_host: boolean }[]; max_per_request: number; truncated: boolean };
let urlsReply: ((body: { urls: string[] }, n: number) => { status: number; body: unknown }) | null;
let documentsStatus: number;
let previewGate: Promise<void> | null;
let previewReply: Record<string, unknown>;
let cleanReply: Record<string, unknown>;

const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });

beforeEach(() => {
  calls = [];
  previewGate = null;
  urlsReply = null;
  documentsStatus = 202;
  previewReply = { url: 'https://example.org/final', title: 'Fetched title', text: 'one two three' };
  cleanReply = { text: 'Inicio\none two three\nCompartir', removed: [], repaired: {}, warnings: [] };
  discovered = { links: [], max_per_request: 20, truncated: false };
  corpusStore.list = [{ id: 1, name: 'Wind', lang: 'es', project_id: null, is_reference: 0, docs: 0, tokens: 0 }];
  corpusStore.currentId = 1;
  corpusStore.loaded = true;
  messages.clear();
  work.busy = null;
  resetDraft();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const u = new URL(url, 'http://x');
    const raw = init?.body;
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    calls.push({ method, path: u.pathname, params: u.searchParams, body });
    const p = u.pathname;
    if (p === '/api/corpora/1/facets') return res(200, { tags: [], text_types: [], date_min: '', date_max: '' });
    if (p === '/api/preview-url' && previewGate) await previewGate;
    if (p === '/api/preview-url') return res(200, previewReply);
    if (p === '/api/clean') return res(200, cleanReply);
    if (p === '/api/corpora/1/documents' && method === 'POST') {
      return documentsStatus < 400 ? res(202, { job_id: 9 }) : res(documentsStatus, { detail: 'boom' });
    }
    if (p === '/api/discover-links') return res(200, { url: 'https://news.example/', title: 'News', ...discovered });
    if (p === '/api/corpora/1/urls' && urlsReply) {
      const r = urlsReply(body as { urls: string[] }, calls.filter((c) => c.path === '/api/corpora/1/urls').length);
      return res(r.status, r.body);
    }
    if (p === '/api/corpora/1/urls') {
      return res(202, [
        { url: 'ftp://x.example/', ok: false, error: 'Not an http(s) address' },
        { url: 'https://a.example/1', ok: true, job_id: 31 },
      ]);
    }
    if (/^\/api\/corpora\/\d+\/jobs$/.test(p)) return res(200, []);
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  stopAllJobs();
  vi.unstubAllGlobals();
  go('sources');
});

const open = (params: Record<string, string> = {}) => {
  go('sources-add', { m: 'web', ...params });
  return render(AddDocuments);
};
const urlCalls = () => calls.filter((c) => c.path === '/api/corpora/1/urls');
const docPosts = () => calls.filter((c) => c.path === '/api/corpora/1/documents' && c.method === 'POST');

describe('From the web: one page', () => {
  async function fetchPage() {
    open();
    await fireEvent.input(screen.getByLabelText('Web address'), { target: { value: ' https://example.org/a ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Fetch & preview' }));
    return (await screen.findByLabelText('Title of the page')) as HTMLInputElement;
  }

  it('shows the three choices, with One page selected', () => {
    open();
    expect(screen.getByRole('button', { name: 'One page' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Several addresses' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'From an index page' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('the choices change the address', async () => {
    open();
    await fireEvent.click(screen.getByRole('button', { name: 'Several addresses' }));
    expect(route.params.sub).toBe('list');
    expect(screen.getByLabelText('Addresses, one per line')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'From an index page' }));
    expect(route.params.sub).toBe('index');
    expect(route.params.m).toBe('web');
  });

  it('the preview shows an editable title and text and the bar adds them, then goes to the list', async () => {
    const title = await fetchPage();
    expect(calls.find((c) => c.path === '/api/preview-url')!.body).toEqual({ url: 'https://example.org/a', corpus_id: 1 });
    expect(title.value).toBe('Fetched title');
    const text = screen.getByLabelText('Text of the page') as HTMLTextAreaElement;
    expect(text.value).toBe('one two three');
    expect(screen.getByText('3 words')).toBeInTheDocument();
    await fireEvent.input(title, { target: { value: 'Edited' } });
    await fireEvent.input(text, { target: { value: 'one two' } });
    await fireEvent.input(screen.getByLabelText('Tags'), { target: { value: 'law' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add to corpus' }));
    await waitFor(() => expect(docPosts()).toHaveLength(1));
    const c = docPosts()[0];
    expect(c.params.get('background')).toBe('true');
    expect(c.body).toEqual({
      title: 'Edited', text: 'one two', source: 'https://example.org/final', kind: 'url',
      tags: 'law', text_type: '', doc_date: '', author: '', line_hashes: '',
    });
    await waitFor(() => expect(route.screen).toBe('sources'));
    expect(window.location.hash).toBe('#/sources');
    expect(draft.preview).toBeNull();
  });

  it('Discard removes the preview and disables the primary again', async () => {
    await fetchPage();
    expect(screen.getByRole('button', { name: 'Add to corpus' })).toBeEnabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByLabelText('Title of the page')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add to corpus' })).toBeDisabled();
  });

  it('a failing add keeps the preview text and stays on the page', async () => {
    documentsStatus = 500;
    const title = await fetchPage();
    await fireEvent.input(title, { target: { value: 'Mine' } });
    await fireEvent.input(screen.getByLabelText('Text of the page'), { target: { value: 'my edited text' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add to corpus' }));
    await waitFor(() => expect(messages.current?.kind).toBe('err'));
    expect(route.screen).toBe('sources-add');
    expect((screen.getByLabelText('Text of the page') as HTMLTextAreaElement).value).toBe('my edited text');
    expect((screen.getByLabelText('Title of the page') as HTMLInputElement).value).toBe('Mine');
  });

  it('shows the quality of a PDF-like preview with an alert when it is poor', async () => {
    previewReply = {
      ...previewReply, warnings: [],
      quality: { score: 30, level: 'poor', issues: [{ code: 'garbled', message: 'Many words have no vowels: the text looks garbled.' }] },
    };
    await fetchPage();
    expect(screen.getByText('Text quality: poor')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Text quality: poor');
    expect(screen.getByText('Many words have no vowels: the text looks garbled.')).toBeInTheDocument();
  });
});

describe('From the web: what cleaning removed', () => {
  const cleaned = () => ({
    url: 'https://example.org/final', title: 'Fetched title', text: 'one two three', warnings: [],
    removed: [{ step: 'edges', lines: ['Inicio', 'Compartir'] }], repaired: {},
    raw: ['Inicio\none two three\nCompartir'], fmt: 'html', line_hashes: 'ab12cd34',
  });
  async function fetchPage() {
    open();
    await fireEvent.input(screen.getByLabelText('Web address'), { target: { value: 'https://example.org/a' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Fetch & preview' }));
    await screen.findByLabelText('Title of the page');
  }
  const cleanCalls = () => calls.filter((c) => c.path === '/api/clean');
  const textArea = () => screen.getByLabelText('Text of the page') as HTMLTextAreaElement;

  it('lists removed lines grouped by step', async () => {
    previewReply = cleaned();
    await fetchPage();
    expect(screen.getByText('Removed while cleaning: 2 lines')).toBeInTheDocument();
    expect(screen.getByText('Menus and links at the start or end')).toBeInTheDocument();
    expect(screen.getByText('Inicio')).toBeInTheDocument();
    expect(screen.getByText('Compartir')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Put back' })).toBeInTheDocument();
  });

  it('shows nothing about cleaning when nothing was removed', async () => {
    await fetchPage();
    expect(screen.queryByText(/Removed while cleaning/)).toBeNull();
  });

  it('shows at most 50 lines of a group and how many more there are', async () => {
    previewReply = { ...cleaned(), removed: [{ step: 'noise', lines: Array.from({ length: 53 }, (_, i) => `--- ${i}`) }] };
    await fetchPage();
    expect(screen.getByText('Removed while cleaning: 53 lines')).toBeInTheDocument();
    expect(screen.getByText('Lines without words')).toBeInTheDocument();
    expect(screen.getByText('--- 49')).toBeInTheDocument();
    expect(screen.queryByText('--- 50')).toBeNull();
    expect(screen.getByText('and 3 more')).toBeInTheDocument();
  });

  it('put back re-cleans with the step skipped', async () => {
    previewReply = cleaned();
    cleanReply = { text: 'Inicio\none two three\nCompartir', removed: [], repaired: {}, warnings: ['Kept as extracted.'] };
    await fetchPage();
    await fireEvent.click(screen.getByRole('button', { name: 'Put back' }));
    await waitFor(() => expect(cleanCalls()).toHaveLength(1));
    expect(cleanCalls()[0].body).toEqual({
      raw: ['Inicio\none two three\nCompartir'], fmt: 'html', corpus_id: 1, source: 'https://example.org/final', skip: ['edges'],
    });
    await waitFor(() => expect(textArea().value).toBe('Inicio\none two three\nCompartir'));
    expect(screen.queryByText('Menus and links at the start or end')).toBeNull();
    expect(screen.queryByText(/Removed while cleaning/)).toBeNull();
    expect(screen.getByText('Kept as extracted.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(draft.preview?.skipped).toEqual(['edges']);
  });

  it('a second put back keeps the steps already skipped', async () => {
    previewReply = { ...cleaned(), removed: [{ step: 'edges', lines: ['Inicio'] }, { step: 'noise', lines: ['***'] }] };
    cleanReply = { text: 'Inicio\none two three', removed: [{ step: 'noise', lines: ['***'] }], repaired: {}, warnings: [] };
    await fetchPage();
    const groups = screen.getAllByRole('button', { name: 'Put back' });
    await fireEvent.click(groups[0]);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Put back' })).toHaveLength(1));
    await fireEvent.click(screen.getByRole('button', { name: 'Put back' }));
    await waitFor(() => expect(cleanCalls()).toHaveLength(2));
    expect((cleanCalls()[1].body as { skip: string[] }).skip).toEqual(['edges', 'noise']);
  });

  it('put back after an edit asks first and cancel keeps the edit', async () => {
    previewReply = cleaned();
    await fetchPage();
    await fireEvent.input(textArea(), { target: { value: 'my edit' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Put back' }));
    const dlg = screen.getByRole('dialog');
    expect(dlg).toHaveTextContent('Putting these lines back discards your edits to the text. Continue?');
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(cleanCalls()).toHaveLength(0);
    expect(textArea().value).toBe('my edit');
    expect(screen.getByText('Menus and links at the start or end')).toBeInTheDocument();
  });

  it('put back after an edit, confirmed, replaces the edited text', async () => {
    previewReply = cleaned();
    await fetchPage();
    await fireEvent.input(textArea(), { target: { value: 'my edit' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Put back' }));
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Put back' }));
    await waitFor(() => expect(cleanCalls()).toHaveLength(1));
    await waitFor(() => expect(textArea().value).toBe('Inicio\none two three\nCompartir'));
  });

  it('says "1 line" when one line was removed', async () => {
    previewReply = { ...cleaned(), removed: [{ step: 'edges', lines: ['Inicio'] }] };
    await fetchPage();
    expect(screen.getByText('Removed while cleaning: 1 line')).toBeInTheDocument();
  });

  it('put back shows the kept-as-extracted note only when the latest clean returned it', async () => {
    const guard = 'Cleaning would have removed almost everything, so the text is kept as extracted: check it.';
    previewReply = { ...cleaned(), warnings: ['Fetched over a slow link.', guard] };
    await fetchPage();
    expect(screen.getByText(guard)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Put back' }));
    await waitFor(() => expect(cleanCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(guard)).toBeNull());
    expect(screen.getByText('Fetched over a slow link.')).toBeInTheDocument();
  });

  it('put back keeps the kept-as-extracted note when the new clean returns it again', async () => {
    const guard = 'Cleaning would have removed almost everything, so the text is kept as extracted: check it.';
    previewReply = { ...cleaned(), warnings: [guard] };
    cleanReply = { text: 'x', removed: [], repaired: {}, warnings: [guard] };
    await fetchPage();
    await fireEvent.click(screen.getByRole('button', { name: 'Put back' }));
    await waitFor(() => expect(textArea().value).toBe('x'));
    expect(screen.getAllByText(guard)).toHaveLength(1);
  });

  it('sends line hashes when adding the preview', async () => {
    previewReply = cleaned();
    await fetchPage();
    await fireEvent.click(screen.getByRole('button', { name: 'Add to corpus' }));
    await waitFor(() => expect(docPosts()).toHaveLength(1));
    expect((docPosts()[0].body as { line_hashes: string }).line_hashes).toBe('ab12cd34');
  });
});

describe('From the web: stale replies', () => {
  it('clears the "Working…" status when an action ends after the corpus changed', async () => {
    open();
    let release: () => void = () => {};
    previewGate = new Promise<void>((r) => (release = r));
    await fireEvent.input(screen.getByLabelText('Web address'), { target: { value: 'https://example.org/a' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Fetch & preview' }));
    await waitFor(() => expect(messages.current?.text).toBe('Working…'));
    corpusStore.currentId = 2;
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
    release();
    await waitFor(() => expect(messages.current).toBeNull());
  });
});

describe('From the web: several addresses', () => {
  it('sends the list as one request with the metadata, reports rejected lines, then goes to the list', async () => {
    open({ sub: 'list' });
    await fireEvent.input(screen.getByLabelText('Tags'), { target: { value: 'law' } });
    await fireEvent.input(screen.getByLabelText('Addresses, one per line'), {
      target: { value: 'ftp://x.example/\n\n  https://a.example/1  \n' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add all' }));
    await waitFor(() => expect(urlCalls()).toHaveLength(1));
    const c = urlCalls()[0];
    expect(c.method).toBe('POST');
    expect(c.body).toMatchObject({ urls: ['ftp://x.example/', 'https://a.example/1'], tags: 'law', force_language: false });
    await waitFor(() => expect(messages.current?.text).toBe('1 queued; rejected: ftp://x.example/ (Not an http(s) address)'));
    expect(draft.urlList).toBe('');
    await waitFor(() => expect(route.screen).toBe('sources'));
  });

  it('an empty list sends nothing', async () => {
    open({ sub: 'list' });
    expect(screen.getByRole('button', { name: 'Add all' })).toBeDisabled();
    expect(await addUrlList()).toBe(false);
    await waitFor(() => expect(messages.current?.text).toBe('Type or paste at least one address.'));
    expect(urlCalls()).toHaveLength(0);
  });
});

describe('From the web: an index page', () => {
  const links = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ url: `https://news.example/2026/${i + 1}`, text: `Story ${i + 1}`, same_host: true }));
  async function find(list: ReturnType<typeof links>, extra: Partial<typeof discovered> = {}) {
    discovered = { links: list, max_per_request: 20, truncated: false, ...extra };
    open({ sub: 'index' });
    await fireEvent.input(screen.getByLabelText('Index page address'), { target: { value: 'https://news.example/' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Find links' }));
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^Story/ }).length).toBeGreaterThan(0));
  }

  it('shows the index form for ?sub=index and asks to find the links first', () => {
    open({ sub: 'index' });
    expect(screen.getByRole('button', { name: 'From an index page' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Index page address')).toBeInTheDocument();
    expect(screen.getByText(/Find the links first/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import selected' })).toBeDisabled();
  });

  it('lists the links found, all selected, and counts them in the bar', async () => {
    await find(links(3));
    expect(screen.getAllByRole('checkbox', { name: /^Story/ }).every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect(screen.getAllByText('3 of 3 selected').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Import 3 pages' })).toBeEnabled();
    await fireEvent.click(screen.getByRole('checkbox', { name: /^Story 1/ }));
    expect(screen.getByRole('button', { name: 'Import 2 pages' })).toBeEnabled();
  });

  it('the filter hides rows and "Select all" applies only to the visible ones', async () => {
    await find([...links(2), { url: 'https://news.example/blog/x', text: 'Story blog', same_host: true }]);
    await fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    await fireEvent.input(screen.getByLabelText('Filter links'), { target: { value: '/2026/' } });
    expect(screen.getAllByRole('checkbox', { name: /^Story/ })).toHaveLength(2);
    await fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getAllByText('2 of 3 selected').length).toBeGreaterThan(0);
  });

  it('sends a long selection in requests of max_per_request addresses, in order, with the metadata', async () => {
    await find(links(45));
    await fireEvent.input(screen.getByLabelText('Tags'), { target: { value: 'news' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Import 45 pages' }));
    await waitFor(() => expect(urlCalls()).toHaveLength(3));
    const sent = urlCalls().map((c) => (c.body as { urls: string[] }).urls);
    expect(sent.map((u) => u.length)).toEqual([20, 20, 5]);
    expect(sent.flat()).toEqual(links(45).map((l) => l.url));
    expect(urlCalls()[0].body).toMatchObject({ tags: 'news', force_language: false });
    await waitFor(() => expect(route.screen).toBe('sources'));
  });

  it('a failing request is reported and the next ones are still sent', async () => {
    urlsReply = (body, n) =>
      n === 2 ? { status: 500, body: { detail: 'server down' } } : { status: 202, body: body.urls.map((u) => ({ url: u, ok: true, job_id: 1 })) };
    await find(links(45));
    await fireEvent.click(screen.getByRole('button', { name: 'Import 45 pages' }));
    await waitFor(() => expect(urlCalls()).toHaveLength(3));
    await waitFor(() => expect(messages.current?.text).toMatch(/^25 queued; rejected: .*server down/));
  });

  it('nothing selected sends nothing and says so', async () => {
    await find(links(2));
    await fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    expect(screen.getByRole('button', { name: 'Import 0 pages' })).toBeDisabled();
    expect(await importSelected()).toBe(false);
    await waitFor(() => expect(messages.current?.text).toBe('Select at least one link.'));
    expect(urlCalls()).toHaveLength(0);
  });

  it('says when the page has more links than are listed', async () => {
    await find(links(2), { truncated: true });
    expect(screen.getByText('The page has more links than are listed here.')).toBeInTheDocument();
  });
});
