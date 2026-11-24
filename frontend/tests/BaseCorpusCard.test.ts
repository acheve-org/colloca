import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BaseCorpusCard from '../src/lib/ui/BaseCorpusCard.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { jobs, stopAllJobs } from '../src/lib/jobs.svelte';
import { messages } from '../src/lib/messages.svelte';
import type { Corpus, Job } from '../src/lib/types';

const ref = (id: number, lang: string, over = {}) => ({
  id, name: `General ${lang}`, lang, project_id: null, is_reference: 1, docs: 3, tokens: 12345, ...over,
});
const job = (id: number, status: string, over: Partial<Job> = {}): Job => ({
  id, corpus_id: 10, kind: 'import', label: 'leipzig.txt', status, progress: 0.4, error: '', code: '', result: {}, ...over,
});

interface Call { method: string; path: string; params: URLSearchParams; body?: unknown }
let calls: Call[];
let current: ReturnType<typeof ref> | null;
let changed: number;
let jobList: Job[][];
let uploadReply: { status: number; body: unknown };

const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });

beforeEach(() => {
  calls = [];
  current = ref(10, 'es');
  changed = 0;
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
    if (p === '/api/references' && method === 'POST') return res(201, { id: 11 });
    if (p === '/api/corpora/10/jobs') return res(200, jobList.length > 1 ? jobList.shift()! : jobList[0]);
    if (/^\/api\/corpora\/\d+\/jobs$/.test(p)) return res(200, []);
    if (p === '/api/corpora/10/upload') return res(uploadReply.status, uploadReply.body);
    if (p === '/api/corpora/10' && method === 'DELETE') return res(204, null);
    if (p === '/api/corpora') return res(200, []);
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  stopAllJobs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mount = (lang = 'es', name = 'Spanish', reference: Corpus | null = current as unknown as Corpus) =>
  render(BaseCorpusCard, { lang, name, reference, force: false, onchange: () => void changed++ });

describe('BaseCorpusCard', () => {
  it('shows the base corpus with its size', () => {
    mount();
    expect(screen.getByText('General es')).toBeInTheDocument();
    expect(screen.getByText('3 parts · 12,345 words')).toBeInTheDocument();
  });

  it('offers to create it when there is none', async () => {
    mount('it', 'Italian', null);
    expect(screen.getByText('No base corpus yet.')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Create Italian base corpus' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/references' && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.path === '/api/references' && c.method === 'POST')!.body).toEqual({ lang: 'it' });
    await waitFor(() => expect(changed).toBe(1));
  });

  it('uploads sentence files, shows progress and tells the parent when the job finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    jobList = [[job(3, 'running')], [job(3, 'done', { result: { documents: 2, tokens: 500 } })]];
    await fireEvent.change(screen.getByLabelText('Sentence files'), {
      target: { files: [new File(['Una frase.\n'], 'leipzig.txt'), new File(['x'], 'b.tsv')] },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Upload sentence files' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/corpora/10/upload')).toBe(true));
    const up = calls.find((c) => c.path === '/api/corpora/10/upload')!;
    expect(up.params.get('sentences')).toBe('true');
    expect(up.params.get('force_language')).toBe('false');
    expect((up.body as FormData).getAll('files').length).toBe(2);
    await waitFor(() => expect(screen.getByText('40%')).toBeInTheDocument());
    expect(jobs.running).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    await waitFor(() => expect(screen.getByText('done — 2 parts, 500 words')).toBeInTheDocument());
    await waitFor(() => expect(changed).toBe(1));
    expect(jobs.running).toBe(0);
  });

  it('a failing upload shows the server detail', async () => {
    uploadReply = { status: 413, body: { detail: 'Too many files in one upload (limit 50)' } };
    mount();
    await fireEvent.change(screen.getByLabelText('Sentence files'), { target: { files: [new File(['x'], 'a.txt')] } });
    await fireEvent.click(screen.getByRole('button', { name: 'Upload sentence files' }));
    await waitFor(() => expect(messages.current).toEqual({ text: 'Too many files in one upload (limit 50)', kind: 'err' }));
  });

  it('deletes only after confirmation', async () => {
    mount();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const dlg = screen.getByRole('dialog', { name: 'Delete this base corpus?' });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/corpora/10')).toBe(true));
    await waitFor(() => expect(changed).toBe(1));
  });

  it('keeps following an upload after unmount; stopping all tracking leaks no timer', async () => {
    vi.useFakeTimers();
    jobList = [[job(3, 'running')]];
    const r = mount();
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
