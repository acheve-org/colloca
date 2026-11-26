import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Sources from '../src/screens/Sources.svelte';
import { CORPUS_CHANGED, corpusStore } from '../src/lib/corpus.svelte';
import { JOBS_DONE, jobs, stopAllJobs, trackJobs } from '../src/lib/jobs.svelte';
import { messages } from '../src/lib/messages.svelte';
import { __setViewportForTests } from '../src/lib/viewport.svelte';
import type { Doc, Job } from '../src/lib/types';

const doc = (id: number, over: Partial<Doc> = {}): Doc => ({
  id, title: `Doc ${id}`, source: `https://example.org/${id}`, kind: 'url', text_type: 'contract',
  doc_date: '2024', author: '', n_tokens: 1000 * id, pipeline: 'es_core_news_sm-3.8', lang_check: 'ok',
  added: '2026-01-01', segmented: 0, pair_doc_id: null, chars: 5000, tags: ['legal'], stale: false, ...over,
});
const job = (id: number, status: string, over: Partial<Job> = {}): Job => ({
  id, corpus_id: 1, kind: 'import', label: `job${id}`, status, progress: 0.5, error: '', code: '', result: {}, ...over,
});
const corpus = (id: number, lang = 'es', project_id: number | null = null) => ({
  id, name: `C${id}`, lang, project_id, is_reference: 0, docs: 2, tokens: 10,
});

interface Call { method: string; path: string; params: URLSearchParams; body?: unknown }
let calls: Call[];
let docs: { status: number; body: unknown };
let jobList: Job[][];
let uploadReply: { status: number; body: unknown };
let previewFileReply: Record<string, unknown>;
let partners: unknown[];
let docsGate: Promise<void> | null;
let discovered: { links: { url: string; text: string; same_host: boolean }[]; max_per_request: number; truncated: boolean };
let urlsReply: ((body: { urls: string[] }, n: number) => { status: number; body: unknown }) | null;

const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });

beforeEach(() => {
  calls = [];
  docsGate = null;
  partners = [{ id: 2, name: 'C2', lang: 'it', docs: 3 }];
  urlsReply = null;
  discovered = { links: [], max_per_request: 20, truncated: false };
  docs = { status: 200, body: [doc(1), doc(2, { tags: [], text_type: 'manual' })] };
  jobList = [[]];
  uploadReply = { status: 202, body: [{ file: 'a.txt', ok: true, job_id: 7 }, { file: 'b.docx', ok: true, job_id: 8 }] };
  previewFileReply = { source: 'two.pdf', title: 'two', text: 'La primera columna\nLa segunda columna', warnings: [] };
  corpusStore.list = [corpus(1), corpus(2, 'it')];
  corpusStore.currentId = 1;
  corpusStore.loaded = true;
  messages.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const u = new URL(url, 'http://x');
    const raw = init?.body;
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    calls.push({ method, path: u.pathname, params: u.searchParams, body });
    const p = u.pathname;
    if (p === '/api/corpora/1/documents' && method === 'GET') {
      if (docsGate) await docsGate;
      return res(docs.status, docs.body);
    }
    if (p === '/api/corpora/1/documents' && method === 'POST') return res(202, { job_id: 9 });
    if (p === '/api/corpora/1/facets') return res(200, { tags: [{ tag: 'legal', docs: 1 }], text_types: [{ text_type: 'contract', docs: 1 }], date_min: '', date_max: '' });
    if (/^\/api\/corpora\/\d+\/jobs$/.test(p)) {
      const b = jobList.length > 1 ? jobList.shift()! : jobList[0];
      return res(200, b);
    }
    if (p === '/api/corpora/1/upload') return res(uploadReply.status, uploadReply.body);
    if (p === '/api/discover-links') return res(200, { url: 'https://news.example/', title: 'News', ...discovered });
    if (p === '/api/corpora/1/urls' && urlsReply) {
      const r = urlsReply(body as { urls: string[] }, calls.filter((c) => c.path === '/api/corpora/1/urls').length);
      return res(r.status, r.body);
    }
    if (p === '/api/preview-file') return res(200, previewFileReply);
    if (p === '/api/corpora/1/urls') {
      return res(202, [
        { url: 'ftp://x.example/', ok: false, error: 'Not an http(s) address' },
        { url: 'https://a.example/1', ok: true, job_id: 31 },
      ]);
    }
    if (p === '/api/jobs/5/resolve') return res(202, { job_id: 20 });
    if (p === '/api/corpora/1/near-duplicates') {
      return res(200, {
        threshold: Number(u.searchParams.get('threshold')), documents: 2, fingerprinted_now: 0,
        pairs: [{ a: { id: 1, title: 'Doc 1', source: '', added: '2026-01-01', n_tokens: 1000 },
                  b: { id: 2, title: 'Doc 2', source: '', added: '2026-01-02', n_tokens: 990 }, similarity: 0.93 }],
      });
    }
    if (p === '/api/corpora/1/aligned-partners') return res(200, partners);
    if (p === '/api/corpora/1/reannotate') return res(202, { job_id: 12 });
    if (/^\/api\/documents\/\d+$/.test(p)) return method === 'DELETE' ? res(204, null) : res(200, { ok: true });
    if (p === '/api/corpora/1' && method === 'PATCH') return res(200, { ok: true });
    if (p === '/api/corpora/2/documents') return res(200, []);
    if (p === '/api/corpora/2/facets') return res(200, { tags: [], text_types: [], date_min: '', date_max: '' });
    if (p === '/api/corpora') return res(200, corpusStore.list);
    if (/\/parallel$/.test(p)) return res(200, { documents: 0, segments: 0, partners: [] });
    if (p === '/api/projects') return res(200, [{ id: 7, name: 'Acme', corpora: 0, trashed: 0, terms: 0 }]);
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  stopAllJobs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  corpusStore.list = [];
  corpusStore.currentId = null;
  corpusStore.aligned = false;
});

const bodyRows = () => screen.queryAllByRole('row').filter((r) => r.classList.contains('body'));
const docCalls = () => calls.filter((c) => c.path === '/api/corpora/1/documents' && c.method === 'GET');
const jobCalls = () => calls.filter((c) => c.path === '/api/corpora/1/jobs');

async function reload() {
  await fireEvent.click(screen.getByRole('button', { name: 'More' }));
  await fireEvent.click(screen.getByRole('menuitem', { name: 'Reload' }));
}

async function ready() {
  const r = render(Sources);
  await waitFor(() => expect(bodyRows().length).toBe(2));
  return r;
}

describe('Sources', () => {
  it('shows an empty state without a corpus', async () => {
    corpusStore.list = [];
    corpusStore.currentId = null;
    render(Sources);
    expect(screen.getByText('Create or select a corpus first.')).toBeInTheDocument();
    expect(docCalls().length).toBe(0);
  });

  it('lists the documents with the old columns', async () => {
    await ready();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers).toEqual(expect.arrayContaining(['Title', 'Type', 'Date', 'Tags', 'Words', 'Checks']));
    expect(within(bodyRows()[0]).getByText('legal')).toBeInTheDocument();
  });

  it('a job keeps being followed after the screen unmounts; the store reloads once when it ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const r = await ready();
    // a job started elsewhere (the Add documents page): the list follows it by the app-wide watcher
    jobList = [[job(7, 'running')], [job(7, 'running')], [job(7, 'done')]];
    trackJobs(1, true);
    await waitFor(() => expect(jobs.running).toBe(1));
    r.unmount();
    const before = jobCalls().length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(jobCalls().length).toBe(before + 1);
    expect(jobs.running).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/corpora').length).toBe(1));
    expect(jobs.running).toBe(0);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/corpora/1/parallel')).toBe(true));
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls.filter((c) => c.path === '/api/corpora').length).toBe(1);
  });

  it('is only the list: no add forms or metadata strip', async () => {
    await ready();
    expect(screen.queryByLabelText('Documents to upload')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Paste text' })).toBeNull();
    expect(screen.queryByText('Details for the documents I add next')).toBeNull();
    expect(screen.queryByText('Import even if the language looks wrong')).toBeNull();
  });

  it('offers + Add documents and Find near-duplicates in the toolbar', async () => {
    await ready();
    expect(screen.getByRole('link', { name: '+ Add documents' })).toHaveAttribute('href', '#/sources/add');
    expect(screen.getByRole('button', { name: 'Find near-duplicates' })).toBeEnabled();
    expect(screen.queryAllByRole('link', { name: /From the web/ }).length).toBe(0);
  });

  it('has a one-line toolbar: count, filter and More → Reload', async () => {
    await ready();
    expect(screen.getByRole('heading', { level: 2, name: 'Documents' })).toHaveClass('sr-only');
    expect(screen.getByText('2 documents')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Filter in results' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull(); // only in the More menu
    const before = docCalls().length;
    await reload();
    await waitFor(() => expect(docCalls().length).toBe(before + 1));
  });

  it('has no corpus settings: they live in Projects', async () => {
    await ready();
    expect(screen.queryByText('Corpus settings')).toBeNull();
    expect(screen.queryByLabelText('Corpus name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save corpus' })).toBeNull();
  });

  it('reloads the documents when the jobs of this corpus finish', async () => {
    await ready();
    const before = docCalls().length;
    window.dispatchEvent(new CustomEvent(JOBS_DONE, { detail: { id: 2 } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(docCalls().length).toBe(before);
    window.dispatchEvent(new CustomEvent(JOBS_DONE, { detail: { id: 1 } }));
    await waitFor(() => expect(docCalls().length).toBe(before + 1));
  });

  it('shows the four methods as tiles for an empty corpus', async () => {
    docs.body = [];
    render(Sources);
    const empty = await screen.findByText('No documents yet.');
    expect(empty.closest('.ready')).not.toBeNull(); // a quiet hint, not a card
    expect(screen.getByText('Choose how to add documents below.')).toBeInTheDocument();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    for (const m of ['web', 'up', 'paste', 'al']) expect(hrefs).toContain(`#/sources/add?m=${m}`);
    expect(screen.getByRole('button', { name: 'Find near-duplicates' })).toBeDisabled();
  });

  it('shows no Export TMX button for a corpus without aligned documents', async () => {
    await ready();
    expect(screen.queryByRole('button', { name: 'Export TMX' })).toBeNull();
    expect(screen.queryByText('Export aligned texts (TMX)')).toBeNull();
  });

  it('shows no Export TMX button for an aligned corpus without partners', async () => {
    corpusStore.aligned = true;
    partners = [];
    await ready();
    await waitFor(() => expect(calls.some((c) => c.path === '/api/corpora/1/aligned-partners')).toBe(true));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole('button', { name: 'Export TMX' })).toBeNull();
  });

  it('opens the TMX export in a dialog from the toolbar for an aligned corpus', async () => {
    corpusStore.aligned = true;
    await ready();
    const btn = await screen.findByRole('button', { name: 'Export TMX' });
    expect(screen.queryByRole('link', { name: 'Download TMX' })).toBeNull();
    await fireEvent.click(btn);
    const dlg = screen.getByRole('dialog', { name: 'Export aligned texts (TMX)' });
    expect(within(dlg).getByRole('link', { name: 'Download TMX' })).toBeInTheDocument();
  });

  describe('document side panel', () => {
    const panel = () => screen.getByRole('complementary', { name: 'Doc 1' });

    async function more(name = 'Doc 1') {
      await fireEvent.click(within(panel()).getByRole('button', { name: `More actions for ${name}` }));
    }

    it('opens beside the table when a row is selected, with the document fields', async () => {
      await ready();
      expect(screen.queryByRole('complementary')).toBeNull();
      await fireEvent.click(bodyRows()[0]);
      const p = panel();
      expect(within(p).getByText('Type')).toBeInTheDocument();
      expect(within(p).getByText('contract')).toBeInTheDocument();
      expect(within(p).getByText('Size')).toBeInTheDocument();
      expect(within(p).getByText('1,000 words · 5,000 characters')).toBeInTheDocument();
      expect(p.closest('.split')).not.toBeNull(); // a flex row beside the table, not a strip below it
    });

    it('Read links to the reader page of the document', async () => {
      await ready();
      await fireEvent.click(bodyRows()[1]);
      const p = screen.getByRole('complementary', { name: 'Doc 2' });
      expect(within(p).getByRole('link', { name: 'Read' })).toHaveAttribute('href', '#/sources/read?doc=2');
    });

    it('Esc closes the panel and clears the selection', async () => {
      await ready();
      await fireEvent.click(bodyRows()[0]);
      await fireEvent.keyDown(within(panel()).getByRole('link', { name: 'Read' }), { key: 'Escape' });
      expect(screen.queryByRole('complementary')).toBeNull();
      expect(bodyRows().some((r) => r.getAttribute('aria-selected') === 'true')).toBe(false);
    });

    it('the close button closes the panel', async () => {
      await ready();
      await fireEvent.click(bodyRows()[0]);
      await fireEvent.click(within(panel()).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('complementary')).toBeNull();
    });

    it('a corpus change closes the panel', async () => {
      await ready();
      await fireEvent.click(bodyRows()[0]);
      expect(panel()).toBeInTheDocument();
      corpusStore.currentId = 2;
      window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
      await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    });

    it('More → Remove asks for confirmation, DELETEs and closes the panel', async () => {
      await ready();
      await fireEvent.click(bodyRows()[0]);
      await more();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
      expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
      const dlg = screen.getByRole('dialog', { name: 'Remove this document?' });
      expect(dlg).toHaveTextContent('Doc 1');
      await fireEvent.click(within(dlg).getByRole('button', { name: 'Remove' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/documents/1')).toBe(true));
      await waitFor(() => expect(bodyRows().length).toBe(1));
      expect(screen.queryByRole('complementary')).toBeNull();
    });

    it('cancelling the delete confirmation removes nothing and keeps the panel', async () => {
      await ready();
      await fireEvent.click(bodyRows()[0]);
      await more();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
      await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
      expect(panel()).toBeInTheDocument();
    });

    it('offers Re-annotate in More only for an outdated document', async () => {
      docs.body = [doc(1, { stale: true }), doc(2)];
      await ready();
      await fireEvent.click(bodyRows()[1]);
      await fireEvent.click(screen.getByRole('button', { name: 'More actions for Doc 2' }));
      expect(screen.queryByRole('menuitem', { name: 'Re-annotate all outdated' })).toBeNull();
      expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeInTheDocument();
      await fireEvent.keyDown(document.body, { key: 'Escape' });
      await fireEvent.click(bodyRows()[0]);
      await more();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Re-annotate all outdated' }));
      await waitFor(() => expect(calls.some((c) => c.path === '/api/corpora/1/reannotate')).toBe(true));
      expect(calls.find((c) => c.path === '/api/corpora/1/reannotate')!.params.get('only_stale')).toBe('true');
    });

    it('editing metadata PATCHes only the changed fields', async () => {
      await ready();
      await fireEvent.click(bodyRows()[0]);
      await fireEvent.click(within(panel()).getByRole('button', { name: 'Edit details' }));
      const dlg = screen.getByRole('dialog', { name: 'Document details' });
      expect((within(dlg).getByLabelText('Title') as HTMLInputElement).value).toBe('Doc 1');
      await fireEvent.input(within(dlg).getByLabelText('Tags'), { target: { value: 'legal, 2023' } });
      await fireEvent.input(within(dlg).getByLabelText('Author'), { target: { value: 'Ana' } });
      await fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
      const c = calls.find((x) => x.method === 'PATCH')!;
      expect(c.path).toBe('/api/documents/1');
      expect(c.body).toEqual({ tags: 'legal, 2023', author: 'Ana' });
      await waitFor(() => expect(messages.current).toEqual({ text: 'Document updated.', kind: 'ok' }));
    });

    it('saving unchanged metadata sends nothing', async () => {
      await ready();
      await fireEvent.click(bodyRows()[0]);
      await fireEvent.click(within(panel()).getByRole('button', { name: 'Edit details' }));
      const dlg = screen.getByRole('dialog', { name: 'Document details' });
      await fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
      expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
      expect(dlg).not.toHaveAttribute('open');
    });

    it('the edit dialog suggests the corpus tags and text types', async () => {
      await ready();
      await fireEvent.click(bodyRows()[0]);
      await fireEvent.click(within(panel()).getByRole('button', { name: 'Edit details' }));
      const dlg = screen.getByRole('dialog', { name: 'Document details' });
      const tags = within(dlg).getByLabelText('Tags');
      const types = within(dlg).getByLabelText('Text type');
      await waitFor(() => expect(document.getElementById(tags.getAttribute('list')!)?.querySelector('option[value="legal"]')).not.toBeNull());
      expect(document.getElementById(types.getAttribute('list')!)?.querySelector('option[value="contract"]')).not.toBeNull();
    });

    it('from 640px, selecting with the keyboard opens the panel but keeps focus in the table, so Enter edits', async () => {
      await ready();
      const grid = screen.getByRole('grid');
      grid.focus();
      await fireEvent.keyDown(grid, { key: 'ArrowDown' });
      expect(panel()).toBeInTheDocument();
      expect(document.activeElement).toBe(grid);
      await fireEvent.keyDown(grid, { key: 'Enter' });
      const dlg = screen.getByRole('dialog', { name: 'Document details' });
      expect((within(dlg).getByLabelText('Title') as HTMLInputElement).value).toBe('Doc 1');
    });

    it('Esc in the documents grid clears the selection and closes the panel', async () => {
      await ready();
      const grid = screen.getByRole('grid');
      grid.focus();
      await fireEvent.keyDown(grid, { key: 'ArrowDown' });
      expect(panel()).toBeInTheDocument();
      await fireEvent.keyDown(grid, { key: 'Escape' });
      expect(screen.queryByRole('complementary')).toBeNull();
      expect(bodyRows().some((r) => r.getAttribute('aria-selected') === 'true')).toBe(false);
      expect(document.activeElement).toBe(grid);
    });

    it('below 640px the panel covers the page and takes focus', async () => {
      __setViewportForTests({ narrow: true });
      try {
        await ready();
        await fireEvent.click(bodyRows()[0]);
        expect(document.activeElement).toBe(within(panel()).getByRole('link', { name: 'Read' }));
      } finally {
        __setViewportForTests({ narrow: false });
      }
    });

    it('double-clicking a row still opens the edit dialog', async () => {
      await ready();
      await fireEvent.dblClick(bodyRows()[1]);
      const dlg = screen.getByRole('dialog', { name: 'Document details' });
      expect((within(dlg).getByLabelText('Title') as HTMLInputElement).value).toBe('Doc 2');
    });
  });

  it('document titles with HTML render as text', async () => {
    docs.body = [doc(1, { title: '<script>x</script>', source: '<img src=x onerror=alert(1)>', author: '<b>A</b>' })];
    render(Sources);
    await waitFor(() => expect(bodyRows().length).toBe(1));
    expect(within(bodyRows()[0]).getByText('<script>x</script>')).toBeInTheDocument();
    expect(document.body.querySelector('script, img')).toBeNull();
    await fireEvent.click(bodyRows()[0]);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('re-annotates outdated documents', async () => {
    docs.body = [doc(1, { stale: true }), doc(2)];
    await ready();
    expect(screen.getByText('1 document annotated with an older NLP model.')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Re-annotate with current model' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/corpora/1/reannotate')).toBe(true));
    expect(calls.find((c) => c.path === '/api/corpora/1/reannotate')!.params.get('only_stale')).toBe('true');
  });

  it('keeps the previous rows and reports the error when a reload fails', async () => {
    await ready();
    docs = { status: 500, body: { detail: 'boom' } };
    await reload();
    await waitFor(() => expect(messages.current).toEqual({ text: 'boom', kind: 'err' }));
    expect(bodyRows().length).toBe(2);
  });

  it('clears and reloads on corpus-changed, ignoring a stale response', async () => {
    await ready();
    let release: () => void = () => {};
    docsGate = new Promise<void>((r) => (release = r));
    docs = { status: 200, body: [doc(5, { title: 'old corpus' })] };
    await reload();
    corpusStore.currentId = 2;
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
    await waitFor(() => expect(bodyRows().length).toBe(0));
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText('old corpus')).not.toBeInTheDocument();
  });

  describe('near-duplicates', () => {
    const held = job(5, 'error', {
      code: 'near_duplicate', error: 'Very similar', progress: 1,
      result: { matches: [{ id: 1, title: 'Contract v1', source: '', added: '2026-01-01', similarity: 0.93, units: 12, shared_units: 11,
                            changed: ['A new clause replaces the old one.'] }] },
    });

    it('shows what overlaps in a held import and sends the decision', async () => {
      jobList = [[held]];   // the job log of the list shows the held import found on load
      await ready();
      expect(await screen.findByText('“Contract v1” — 93% alike')).toBeInTheDocument();
      expect(screen.getByText('11 of 12 paragraphs also appear there.')).toBeInTheDocument();
      expect(screen.getByText('A new clause replaces the old one.')).toBeInTheDocument();
      await fireEvent.click(screen.getByRole('button', { name: 'Replace “Contract v1”' }));
      await waitFor(() => expect(calls.some((c) => c.path === '/api/jobs/5/resolve')).toBe(true));
      expect(calls.find((c) => c.path === '/api/jobs/5/resolve')?.body).toEqual({ action: 'replace' });
    });

    it('the report lists pairs at the chosen threshold and can remove one document', async () => {
      await ready();
      await fireEvent.click(screen.getByRole('button', { name: 'Find near-duplicates' }));
      expect(await screen.findByText('93% alike')).toBeInTheDocument();
      expect(calls.find((c) => c.path === '/api/corpora/1/near-duplicates')?.params.get('threshold')).toBe('0.85');
      await fireEvent.click(screen.getByRole('button', { name: 'Remove “Doc 2”' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/documents/2')).toBe(true));
    });
  });
});
