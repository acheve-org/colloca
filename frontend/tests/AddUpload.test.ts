import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddDocuments from '../src/screens/AddDocuments.svelte';
import { draft, resetDraft, work } from '../src/lib/addDocuments.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { jobs, stopAllJobs } from '../src/lib/jobs.svelte';
import { messages } from '../src/lib/messages.svelte';
import { go, route } from '../src/lib/router.svelte';
import type { Job } from '../src/lib/types';

const job = (id: number, status: string, over: Partial<Job> = {}): Job => ({
  id, corpus_id: 1, kind: 'import', label: `job${id}`, status, progress: 0.5, error: '', code: '', result: {}, ...over,
});

interface Call { method: string; path: string; params: URLSearchParams; body?: unknown }
let calls: Call[];
let jobList: Job[][];
let uploadReply: { status: number; body: unknown };
let previewFileReply: Record<string, unknown>;
let cleanReply: Record<string, unknown>;

const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });

beforeEach(() => {
  calls = [];
  jobList = [[]];
  uploadReply = { status: 202, body: [{ file: 'a.txt', ok: true, job_id: 7 }, { file: 'b.docx', ok: true, job_id: 8 }] };
  previewFileReply = { source: 'two.pdf', title: 'two', text: 'La primera columna\nLa segunda columna', warnings: [] };
  cleanReply = { text: 'Página 1\nUna columna', removed: [], repaired: {}, warnings: [] };
  corpusStore.list = [{ id: 1, name: 'Wind', lang: 'es', project_id: null, is_reference: 0, docs: 2, tokens: 10 }];
  corpusStore.currentId = 1;
  corpusStore.loaded = true;
  messages.clear();
  work.busy = null;
  resetDraft();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const u = new URL(url, 'http://x');
    const raw = init?.body;
    calls.push({ method, path: u.pathname, params: u.searchParams, body: typeof raw === 'string' ? JSON.parse(raw) : raw });
    const p = u.pathname;
    if (p === '/api/corpora/1/documents' && method === 'POST') return res(202, { job_id: 9 });
    if (p === '/api/corpora/1/documents') return res(200, []);
    if (p === '/api/corpora/1/facets') return res(200, { tags: [], text_types: [], date_min: '', date_max: '' });
    if (/^\/api\/corpora\/\d+\/jobs$/.test(p)) return res(200, jobList.length > 1 ? jobList.shift()! : jobList[0]);
    if (p === '/api/corpora/1/upload') return res(uploadReply.status, uploadReply.body);
    if (p === '/api/preview-file') return res(200, previewFileReply);
    if (p === '/api/clean') return res(200, cleanReply);
    if (p === '/api/corpora') return res(200, corpusStore.list);
    if (/\/parallel$/.test(p)) return res(200, { documents: 0, segments: 0, partners: [] });
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  stopAllJobs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  go('sources');
});

const open = () => {
  go('sources-add', { m: 'up' });
  return render(AddDocuments);
};
const jobCalls = () => calls.filter((c) => c.path === '/api/corpora/1/jobs');
const uploads = () => calls.filter((c) => c.path === '/api/corpora/1/upload');
const docPosts = () => calls.filter((c) => c.path === '/api/corpora/1/documents' && c.method === 'POST');
const choose = (...files: File[]) => fireEvent.change(screen.getByLabelText('Documents to upload'), { target: { files } });

describe('Upload files', () => {
  it('Upload is disabled and the summary asks for files until one is chosen', async () => {
    open();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
    expect(screen.getByText(/Choose files first/)).toBeInTheDocument();
    await choose(new File(['x'], 'a.txt'));
    expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
    expect(screen.getByText(/1 file/)).toBeInTheDocument();
  });

  it('keeps the chosen files when moving to Paste text and back', async () => {
    open();
    await choose(new File(['x'], 'keep.txt'));
    await fireEvent.click(screen.getByRole('tab', { name: 'Paste text' }));
    expect(screen.queryByLabelText('Documents to upload')).toBeNull();
    await fireEvent.click(screen.getByRole('tab', { name: 'Upload files' }));
    expect(draft.files.map((f) => f.name)).toEqual(['keep.txt']);
    expect(screen.getByText('keep.txt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
  });

  it('files dropped on the panel are chosen too', async () => {
    open();
    const zone = screen.getByTestId('dropzone');
    await fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'dropped.txt')] } });
    expect(draft.files.map((f) => f.name)).toEqual(['dropped.txt']);
  });

  it('previews one file with the quality of its text before anything is added', async () => {
    previewFileReply = {
      source: 'scan.pdf', title: 'scan', text: 'xqzt kjhs wvbn pfrm', warnings: ['The text of this PDF may be unreliable (quality 30/100, poor): garbled. Check the preview before adding it.'],
      quality: { score: 30, level: 'poor', issues: [{ code: 'garbled', message: 'Many words have no vowels: the text looks garbled.' }] },
    };
    open();
    expect(screen.getByRole('button', { name: 'Preview file' })).toBeDisabled();            // nothing chosen yet
    await choose(new File(['x'], 'scan.pdf'));
    await fireEvent.click(screen.getByRole('button', { name: 'Preview file' }));
    expect(await screen.findByText('Text quality: poor')).toBeInTheDocument();
    expect(screen.getByText('30 / 100')).toBeInTheDocument();
    expect(screen.getByText('Many words have no vowels: the text looks garbled.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Text quality: poor');
    const c = calls.find((x) => x.path === '/api/preview-file')!;
    expect(c.params.get('corpus_id')).toBe('1');
    expect((c.body as FormData).get('file')).toBeInstanceOf(File);
    expect(docPosts()).toHaveLength(0);   // nothing added
    // the text can be trimmed, then added as a file document (the bar's primary is now Add to corpus)
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
    await fireEvent.input(screen.getByLabelText('Text of the page'), { target: { value: 'texto limpio' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add to corpus' }));
    await waitFor(() => expect(docPosts()).toHaveLength(1));
    expect(docPosts()[0].body).toMatchObject({ title: 'scan', text: 'texto limpio', source: 'scan.pdf', kind: 'file' });
    await waitFor(() => expect(route.screen).toBe('sources'));
    expect(draft.preview).toBeNull();
    expect(draft.files).toEqual([]);
  });

  it('a good text shows the quality without raising an alert; preview needs exactly one file', async () => {
    previewFileReply = { source: 'two.pdf', title: 'two', text: 'Una columna', warnings: [], quality: { score: 96, level: 'good', issues: [] } };
    open();
    await choose(new File(['x'], 'a.pdf'), new File(['y'], 'b.pdf'));
    expect(screen.getByRole('button', { name: 'Preview file' })).toBeDisabled();
    await choose(new File(['x'], 'two.pdf'));
    await fireEvent.click(screen.getByRole('button', { name: 'Preview file' }));
    expect(await screen.findByText('Text quality: good')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a file preview puts back removed lines without a site and adds with its line hashes', async () => {
    previewFileReply = {
      source: 'two.pdf', title: 'two', text: 'Una columna', warnings: [],
      removed: [{ step: 'page_furniture', lines: ['Página 1'] }], repaired: {},
      raw: ['Página 1\nUna columna'], fmt: 'pdf', line_hashes: 'ff00',
    };
    open();
    await choose(new File(['x'], 'two.pdf'));
    await fireEvent.click(screen.getByRole('button', { name: 'Preview file' }));
    expect(await screen.findByText('Repeated on every page')).toBeInTheDocument();
    expect(screen.getByText('Removed while cleaning: 1 line')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Put back' }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/clean')).toHaveLength(1));
    expect(calls.find((c) => c.path === '/api/clean')!.body).toEqual({
      raw: ['Página 1\nUna columna'], fmt: 'pdf', corpus_id: 1, skip: ['page_furniture'],
    });
    await waitFor(() => expect((screen.getByLabelText('Text of the page') as HTMLTextAreaElement).value).toBe('Página 1\nUna columna'));
    await fireEvent.click(screen.getByRole('button', { name: 'Add to corpus' }));
    await waitFor(() => expect(docPosts()).toHaveLength(1));
    expect(docPosts()[0].body).toMatchObject({ text: 'Página 1\nUna columna', line_hashes: 'ff00' });
  });

  it('Put back on a PDF shows the quality of the new text', async () => {
    previewFileReply = {
      source: 'two.pdf', title: 'two', text: 'Una columna', warnings: [],
      quality: { score: 96, level: 'good', issues: [] },
      removed: [{ step: 'page_furniture', lines: ['Página 1'] }], repaired: {},
      raw: ['Página 1\nUna columna'], fmt: 'pdf', line_hashes: '',
    };
    cleanReply = { ...cleanReply, quality: { score: 70, level: 'fair', issues: [] } };
    open();
    await choose(new File(['x'], 'two.pdf'));
    await fireEvent.click(screen.getByRole('button', { name: 'Preview file' }));
    expect(await screen.findByText('Text quality: good')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Put back' }));
    expect(await screen.findByText('Text quality: fair')).toBeInTheDocument();
    expect(screen.getByText('70 / 100')).toBeInTheDocument();
  });

  it('Discard drops the file preview and the primary goes back to Upload', async () => {
    open();
    await choose(new File(['x'], 'two.pdf'));
    await fireEvent.click(screen.getByRole('button', { name: 'Preview file' }));
    await screen.findByLabelText('Title of the page');
    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByLabelText('Title of the page')).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
  });

  it('uploading two files calls /upload once with both, starts job polling and goes to the list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open();
    jobList = [[job(7, 'running'), job(8, 'queued')], [job(7, 'done'), job(8, 'done')]];
    const before = jobCalls().length;
    await choose(new File(['hola'], 'a.txt', { type: 'text/plain' }), new File(['x'], 'b.docx'));
    await fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(jobCalls().length).toBe(before + 1));
    expect(uploads().length).toBe(1);
    const fd = uploads()[0].body as FormData;
    expect(fd.getAll('files').map((f) => (f as File).name)).toEqual(['a.txt', 'b.docx']);
    expect(messages.current).toEqual({ text: '2 queued.', kind: 'ok' });
    await waitFor(() => expect(jobs.running).toBe(2));
    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => expect(jobs.running).toBe(0));
    await waitFor(() => expect(route.screen).toBe('sources'));
    expect(draft.files).toEqual([]);
  });

  it('sends the metadata and the spreadsheet columns, and keeps the metadata afterwards', async () => {
    open();
    await fireEvent.input(screen.getByLabelText('Tags'), { target: { value: 'law' } });
    await fireEvent.input(screen.getByLabelText('Spreadsheet columns to import (optional)'), { target: { value: '2,4' } });
    await choose(new File(['x'], 'a.txt'));
    await fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(uploads()).toHaveLength(1));
    expect(uploads()[0].params.get('tags')).toBe('law');
    expect(uploads()[0].params.get('columns')).toBe('2,4');
    await waitFor(() => expect(route.screen).toBe('sources'));
    expect(draft.meta.tags).toBe('law');
    expect(draft.textColumns).toBe('');
  });

  it('a failing upload shows the server detail message and keeps the files', async () => {
    open();
    uploadReply = { status: 413, body: { detail: 'Too many files in one upload (limit 50)' } };
    await choose(new File(['x'], 'a.txt'));
    await fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(messages.current).toEqual({ text: 'Too many files in one upload (limit 50)', kind: 'err' }));
    expect(route.screen).toBe('sources-add');
    expect(draft.files.map((f) => f.name)).toEqual(['a.txt']);
    expect(screen.getByText('a.txt')).toBeInTheDocument();
  });

  it('reports files the server rejected', async () => {
    open();
    uploadReply = { status: 202, body: [{ file: 'a.txt', ok: true, job_id: 7 }, { file: 'big.pdf', ok: false, error: 'File is larger than 25 MB' }] };
    await choose(new File(['x'], 'a.txt'));
    await fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(messages.current).toEqual({ text: '1 queued; rejected: big.pdf (File is larger than 25 MB)', kind: 'err' }));
  });
});
