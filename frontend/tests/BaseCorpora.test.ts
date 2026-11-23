import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BaseCorpora from '../src/screens/BaseCorpora.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { jobs, stopAllJobs } from '../src/lib/jobs.svelte';
import { messages } from '../src/lib/messages.svelte';
import type { Job } from '../src/lib/types';

const ref = (id: number, lang: string, over = {}) => ({
  id, name: `General ${lang}`, lang, project_id: null, is_reference: 1, docs: 3, tokens: 12345, ...over,
});
const job = (id: number, status: string, over: Partial<Job> = {}): Job => ({
  id, corpus_id: 10, kind: 'import', label: 'leipzig.txt', status, progress: 0.4, error: '', code: '', result: {}, ...over,
});

interface Call { method: string; path: string; params: URLSearchParams; body?: unknown }
let calls: Call[];
let refs: ReturnType<typeof ref>[];
let jobList: Job[][];
let uploadReply: { status: number; body: unknown };

const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });

beforeEach(() => {
  calls = [];
  refs = [ref(10, 'es')];
  jobList = [[]];
  uploadReply = { status: 202, body: [{ file: 'leipzig.txt', ok: true, job_id: 3 }] };
  corpusStore.list = [];
  corpusStore.currentId = null;
  corpusStore.loaded = true;
  messages.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const u = new URL(url, 'http://x');
    const raw = init?.body;
    calls.push({ method, path: u.pathname, params: u.searchParams, body: typeof raw === 'string' ? JSON.parse(raw) : raw });
    const p = u.pathname;
    if (p === '/api/languages') return res(200, { es: 'Spanish', it: 'Italian' });
    if (p === '/api/references' && method === 'GET') return res(200, refs);
    if (p === '/api/references' && method === 'POST') {
      refs = [...refs, ref(11, 'it', { docs: 0, tokens: 0 })];
      return res(201, { id: 11 });
    }
    if (p === '/api/corpora/10/jobs') return res(200, jobList.length > 1 ? jobList.shift()! : jobList[0]);
    if (/^\/api\/corpora\/\d+\/jobs$/.test(p)) return res(200, []);
    if (p === '/api/corpora/10/upload') return res(uploadReply.status, uploadReply.body);
    if (p === '/api/corpora/10' && method === 'DELETE') {
      refs = refs.filter((r) => r.id !== 10);
      return res(204, null);
    }
    if (p === '/api/corpora') return res(200, []);
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  stopAllJobs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const card = (name: string) => screen.getByRole('region', { name });

describe('BaseCorpora', () => {
  it('works without a corpus: one card per language', async () => {
    render(BaseCorpora);
    await waitFor(() => expect(within(card('Spanish')).getByText('General es')).toBeInTheDocument());
    expect(within(card('Spanish')).getByText('3 parts · 12,345 words')).toBeInTheDocument();
    expect(within(card('Italian')).getByText('No base corpus yet.')).toBeInTheDocument();
  });

  it('creates the base corpus of a language', async () => {
    render(BaseCorpora);
    const btn = await screen.findByRole('button', { name: 'Create Italian base corpus' });
    await fireEvent.click(btn);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/references' && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.path === '/api/references' && c.method === 'POST')!.body).toEqual({ lang: 'it' });
    await waitFor(() => expect(within(card('Italian')).getByText('General it')).toBeInTheDocument());
  });

  it('uploads sentence files, shows progress and reloads when the job finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(BaseCorpora);
    await waitFor(() => expect(within(card('Spanish')).getByText('General es')).toBeInTheDocument());
    jobList = [[job(3, 'running')], [job(3, 'done', { result: { documents: 2, tokens: 500 } })]];
    await fireEvent.change(within(card('Spanish')).getByLabelText('Sentence files'), {
      target: { files: [new File(['Una frase.\n'], 'leipzig.txt'), new File(['x'], 'b.tsv')] },
    });
    await fireEvent.click(within(card('Spanish')).getByRole('button', { name: 'Upload sentence files' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/corpora/10/upload')).toBe(true));
    const up = calls.find((c) => c.path === '/api/corpora/10/upload')!;
    expect(up.params.get('sentences')).toBe('true');
    expect(up.params.get('force_language')).toBe('false');
    expect((up.body as FormData).getAll('files').length).toBe(2);
    await waitFor(() => expect(within(card('Spanish')).getByText('40%')).toBeInTheDocument());
    expect(jobs.running).toBe(1);
    const before = calls.filter((c) => c.path === '/api/references').length;
    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => expect(within(card('Spanish')).getByText('done — 2 parts, 500 words')).toBeInTheDocument());
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/references').length).toBe(before + 1));
    expect(jobs.running).toBe(0);
  });

  it('a failing upload shows the server detail', async () => {
    uploadReply = { status: 413, body: { detail: 'Too many files in one upload (limit 50)' } };
    render(BaseCorpora);
    await waitFor(() => expect(within(card('Spanish')).getByText('General es')).toBeInTheDocument());
    await fireEvent.change(within(card('Spanish')).getByLabelText('Sentence files'), { target: { files: [new File(['x'], 'a.txt')] } });
    await fireEvent.click(within(card('Spanish')).getByRole('button', { name: 'Upload sentence files' }));
    await waitFor(() => expect(messages.current).toEqual({ text: 'Too many files in one upload (limit 50)', kind: 'err' }));
  });

  it('deletes only after confirmation', async () => {
    render(BaseCorpora);
    await waitFor(() => expect(within(card('Spanish')).getByText('General es')).toBeInTheDocument());
    await fireEvent.click(within(card('Spanish')).getByRole('button', { name: 'Delete' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const dlg = screen.getByRole('dialog', { name: 'Delete this base corpus?' });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/corpora/10')).toBe(true));
    await waitFor(() => expect(within(card('Spanish')).getByText('No base corpus yet.')).toBeInTheDocument());
  });

  it('keeps following an upload after unmount; stopping all tracking leaks no timer', async () => {
    vi.useFakeTimers();
    jobList = [[job(3, 'running')]];
    const r = render(BaseCorpora);
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
    expect(jobs.running).toBe(1);
    r.unmount();
    const n = calls.filter((c) => c.path === '/api/corpora/10/jobs').length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.filter((c) => c.path === '/api/corpora/10/jobs').length).toBe(n + 2);
    expect(jobs.running).toBe(1);
    stopAllJobs();
    expect(jobs.running).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
