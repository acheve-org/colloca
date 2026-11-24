import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Sources from '../src/screens/Sources.svelte';
import { CORPUS_CHANGED, corpusStore } from '../src/lib/corpus.svelte';
import { jobs, stopAllJobs } from '../src/lib/jobs.svelte';
import { messages } from '../src/lib/messages.svelte';
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
let docsGate: Promise<void> | null;
let previewGate: Promise<void> | null;

const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });

beforeEach(() => {
  calls = [];
  docsGate = null;
  previewGate = null;
  docs = { status: 200, body: [doc(1), doc(2, { tags: [], text_type: 'manual' })] };
  jobList = [[]];
  uploadReply = { status: 202, body: [{ file: 'a.txt', ok: true, job_id: 7 }, { file: 'b.docx', ok: true, job_id: 8 }] };
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
    if (p === '/api/preview-url' && previewGate) await previewGate;
    if (p === '/api/preview-url') return res(200, { url: 'https://example.org/final', title: 'Fetched title', text: 'one two three' });
    if (p === '/api/corpora/1/upload') return res(uploadReply.status, uploadReply.body);
    if (p === '/api/corpora/1/upload-pairs') return res(202, [{ file: 'tm.tmx', ok: true, job_id: 11, partner_corpus_id: 2 }]);
    if (p === '/api/jobs/5/resolve') return res(202, { job_id: 20 });
    if (p === '/api/corpora/1/near-duplicates') {
      return res(200, {
        threshold: Number(u.searchParams.get('threshold')), documents: 2, fingerprinted_now: 0,
        pairs: [{ a: { id: 1, title: 'Doc 1', source: '', added: '2026-01-01', n_tokens: 1000 },
                  b: { id: 2, title: 'Doc 2', source: '', added: '2026-01-02', n_tokens: 990 }, similarity: 0.93 }],
      });
    }
    if (p === '/api/corpora/1/reannotate') return res(202, { job_id: 12 });
    if (/^\/api\/documents\/\d+$/.test(p)) return method === 'DELETE' ? res(204, null) : res(200, { ok: true });
    if (p === '/api/corpora/1' && method === 'PATCH') return res(200, { ok: true });
    if (p === '/api/corpora/2/documents') return res(200, []);
    if (p === '/api/corpora/2/facets') return res(200, { tags: [], text_types: [], date_min: '', date_max: '' });
    if (p === '/api/corpora') return res(200, corpusStore.list);
    if (/\/parallel$/.test(p)) return res(200, { documents: 0, segments: 0, partners: [] });
    if (p === '/api/projects') return res(200, [{ id: 7, name: 'Acme', corpora: 0 }]);
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  stopAllJobs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  corpusStore.list = [];
  corpusStore.currentId = null;
});

const bodyRows = () => screen.queryAllByRole('row').filter((r) => r.classList.contains('body'));
const docCalls = () => calls.filter((c) => c.path === '/api/corpora/1/documents' && c.method === 'GET');
const jobCalls = () => calls.filter((c) => c.path === '/api/corpora/1/jobs');

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

  it('URL preview shows an editable title and text and "Add to corpus" posts them', async () => {
    await ready();
    await fireEvent.input(screen.getByLabelText('Web address'), { target: { value: ' https://example.org/a ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Fetch & preview' }));
    const title = (await screen.findByLabelText('Title of the page')) as HTMLInputElement;
    expect(calls.find((c) => c.path === '/api/preview-url')!.body).toEqual({ url: 'https://example.org/a' });
    expect(title.value).toBe('Fetched title');
    const text = screen.getByLabelText('Text of the page') as HTMLTextAreaElement;
    expect(text.value).toBe('one two three');
    expect(screen.getByText('3 words')).toBeInTheDocument();
    await fireEvent.input(title, { target: { value: 'Edited' } });
    await fireEvent.input(text, { target: { value: 'one two' } });
    await fireEvent.input(screen.getByLabelText('Tags'), { target: { value: 'law' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add to corpus' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/corpora/1/documents' && c.method === 'POST')).toBe(true));
    const c = calls.find((x) => x.path === '/api/corpora/1/documents' && x.method === 'POST')!;
    expect(c.params.get('background')).toBe('true');
    expect(c.body).toEqual({
      title: 'Edited', text: 'one two', source: 'https://example.org/final', kind: 'url',
      tags: 'law', text_type: '', doc_date: '', author: '',
    });
    await waitFor(() => expect(screen.queryByLabelText('Title of the page')).not.toBeInTheDocument());
  });

  it('uploading two files calls /upload once with both and then starts job polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await ready();
    const before = jobCalls().length;
    jobList = [[job(7, 'running'), job(8, 'queued')], [job(7, 'done'), job(8, 'done')]];
    const a = new File(['hola'], 'a.txt', { type: 'text/plain' });
    const b = new File(['x'], 'b.docx');
    await fireEvent.change(screen.getByLabelText('Documents to upload'), { target: { files: [a, b] } });
    await fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(jobCalls().length).toBe(before + 1));
    const ups = calls.filter((c) => c.path === '/api/corpora/1/upload');
    expect(ups.length).toBe(1);
    const fd = ups[0].body as FormData;
    expect(fd.getAll('files').map((f) => (f as File).name)).toEqual(['a.txt', 'b.docx']);
    expect(messages.current).toEqual({ text: '2 queued.', kind: 'ok' });
    await waitFor(() => expect(jobs.running).toBe(2));
    const docsBefore = docCalls().length;
    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => expect(docCalls().length).toBe(docsBefore + 1));
    expect(jobs.running).toBe(0);
  });

  it('a job keeps being followed after the screen unmounts; the store reloads once when it ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const r = await ready();
    jobList = [[job(7, 'running')], [job(7, 'running')], [job(7, 'done')]];
    await fireEvent.change(screen.getByLabelText('Documents to upload'), { target: { files: [new File(['x'], 'a.txt')] } });
    await fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
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

  it('a failing upload shows the server detail message', async () => {
    await ready();
    uploadReply = { status: 413, body: { detail: 'Too many files in one upload (limit 50)' } };
    await fireEvent.change(screen.getByLabelText('Documents to upload'), { target: { files: [new File(['x'], 'a.txt')] } });
    await fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(messages.current).toEqual({ text: 'Too many files in one upload (limit 50)', kind: 'err' }));
  });

  it('reports files the server rejected', async () => {
    await ready();
    uploadReply = { status: 202, body: [{ file: 'a.txt', ok: true, job_id: 7 }, { file: 'big.pdf', ok: false, error: 'File is larger than 25 MB' }] };
    await fireEvent.change(screen.getByLabelText('Documents to upload'), { target: { files: [new File(['x'], 'a.txt')] } });
    await fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(messages.current).toEqual({ text: '1 queued; rejected: big.pdf (File is larger than 25 MB)', kind: 'err' }));
  });

  it('imports aligned pairs into the chosen partner corpus with the metadata', async () => {
    await ready();
    await fireEvent.input(screen.getByLabelText('Type'), { target: { value: 'manual' } });
    await fireEvent.change(screen.getByLabelText('Aligned file'), { target: { files: [new File(['<tmx/>'], 'tm.tmx')] } });
    expect((screen.getByLabelText('Translations go to') as HTMLSelectElement).value).toBe('2');
    await fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/corpora/1/upload-pairs')).toBe(true));
    const c = calls.find((x) => x.path === '/api/corpora/1/upload-pairs')!;
    expect(c.params.get('partner_corpus_id')).toBe('2');
    expect(c.params.get('swap')).toBe('false');
    expect(c.params.get('text_type')).toBe('manual');
    expect((c.body as FormData).getAll('files').length).toBe(1);
  });

  it('asks for a name when the translations go to a new corpus', async () => {
    await ready();
    await fireEvent.change(screen.getByLabelText('Aligned file'), { target: { files: [new File(['x'], 'tm.tmx')] } });
    await fireEvent.change(screen.getByLabelText('Translations go to'), { target: { value: 'new' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(messages.current?.kind).toBe('err');
    expect(calls.some((c) => c.path === '/api/corpora/1/upload-pairs')).toBe(false);
    await fireEvent.input(screen.getByLabelText('Name of the new corpus'), { target: { value: 'Traduzioni' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/corpora/1/upload-pairs')).toBe(true));
    expect(calls.find((x) => x.path === '/api/corpora/1/upload-pairs')!.params.get('partner_name')).toBe('Traduzioni');
  });

  it('pastes text with a default title', async () => {
    await ready();
    await fireEvent.input(screen.getByLabelText('Pasted text'), { target: { value: 'hola mundo' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/corpora/1/documents')).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/corpora/1/documents')!.body).toMatchObject({
      title: 'Pasted text', text: 'hola mundo', kind: 'paste',
    });
  });

  it('deleting a document asks for confirmation', async () => {
    await ready();
    await fireEvent.click(bodyRows()[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const dlg = screen.getByRole('dialog', { name: 'Remove this document?' });
    expect(dlg).toHaveTextContent('Doc 1');
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/documents/1')).toBe(true));
    await waitFor(() => expect(bodyRows().length).toBe(1));
  });

  it('cancelling the delete confirmation removes nothing', async () => {
    await ready();
    await fireEvent.click(bodyRows()[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('editing metadata PATCHes only the changed fields', async () => {
    await ready();
    await fireEvent.click(bodyRows()[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const dlg = screen.getByRole('dialog', { name: 'Document details' });
    expect((within(dlg).getByLabelText('Title') as HTMLInputElement).value).toBe('Doc 1');
    await fireEvent.input(within(dlg).getByLabelText('Tags'), { target: { value: 'legal, 2023' } });
    await fireEvent.input(within(dlg).getByLabelText('Author'), { target: { value: 'Ana' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const c = calls.find((x) => x.method === 'PATCH')!;
    expect(c.path).toBe('/api/documents/1');
    expect(c.body).toEqual({ tags: 'legal, 2023', author: 'Ana' });
  });

  it('saving unchanged metadata sends nothing', async () => {
    await ready();
    await fireEvent.click(bodyRows()[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const dlg = screen.getByRole('dialog', { name: 'Document details' });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(dlg).not.toHaveAttribute('open');
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
    await fireEvent.click(bodyRows()[0]);
    expect(screen.getByRole('button', { name: 'Re-annotate all outdated' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Re-annotate with current model' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/corpora/1/reannotate')).toBe(true));
    expect(calls.find((c) => c.path === '/api/corpora/1/reannotate')!.params.get('only_stale')).toBe('true');
  });

  it('saves the corpus name and project', async () => {
    await ready();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Acme' })).toBeInTheDocument());
    await fireEvent.input(screen.getByLabelText('Corpus name'), { target: { value: 'Renamed' } });
    await fireEvent.change(screen.getByLabelText('Project'), { target: { value: '7' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save corpus' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/corpora/1' && c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.path === '/api/corpora/1' && c.method === 'PATCH')!.body).toEqual({ name: 'Renamed', project_id: 7 });
  });

  it('keeps the previous rows and reports the error when a reload fails', async () => {
    await ready();
    docs = { status: 500, body: { detail: 'boom' } };
    await fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(messages.current).toEqual({ text: 'boom', kind: 'err' }));
    expect(bodyRows().length).toBe(2);
  });

  it('clears and reloads on corpus-changed, ignoring a stale response', async () => {
    await ready();
    let release: () => void = () => {};
    docsGate = new Promise<void>((r) => (release = r));
    docs = { status: 200, body: [doc(5, { title: 'old corpus' })] };
    await fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    corpusStore.currentId = 2;
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
    await waitFor(() => expect(bodyRows().length).toBe(0));
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText('old corpus')).not.toBeInTheDocument();
  });

  it('clears the "Working…" status when an action ends after the corpus changed', async () => {
    await ready();
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

  describe('near-duplicates', () => {
    const held = job(5, 'error', {
      code: 'near_duplicate', error: 'Very similar', progress: 1,
      result: { matches: [{ id: 1, title: 'Contract v1', source: '', added: '2026-01-01', similarity: 0.93, units: 12, shared_units: 11,
                            changed: ['A new clause replaces the old one.'] }] },
    });

    it('shows what overlaps in a held import and sends the decision', async () => {
      await ready();
      jobList = [[held]];
      await fireEvent.change(screen.getByLabelText('Documents to upload'), { target: { files: [new File(['x'], 'v2.txt')] } });
      await fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
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
