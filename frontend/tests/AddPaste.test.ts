import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddDocuments from '../src/screens/AddDocuments.svelte';
import { addPaste, draft, resetDraft, work } from '../src/lib/addDocuments.svelte';
import { CORPUS_CHANGED, corpusStore } from '../src/lib/corpus.svelte';
import { stopAllJobs } from '../src/lib/jobs.svelte';
import { messages } from '../src/lib/messages.svelte';
import { go, route } from '../src/lib/router.svelte';

interface Call { method: string; path: string; params: URLSearchParams; body?: unknown }
let calls: Call[];
let documentsStatus: number;
let documentsGate: Promise<void> | null;

const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });

beforeEach(() => {
  calls = [];
  documentsStatus = 202;
  documentsGate = null;
  corpusStore.list = [
    { id: 1, name: 'Wind', lang: 'es', project_id: null, is_reference: 0, docs: 0, tokens: 0 },
    { id: 2, name: 'Sun', lang: 'es', project_id: null, is_reference: 0, docs: 0, tokens: 0 },
  ];
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
    if (u.pathname === '/api/corpora/1/documents' && method === 'POST') {
      if (documentsGate) await documentsGate;
      return documentsStatus < 400 ? res(202, { job_id: 9 }) : res(documentsStatus, { detail: 'boom' });
    }
    if (/^\/api\/corpora\/\d+\/jobs$/.test(u.pathname)) return res(200, []);
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  stopAllJobs();
  vi.unstubAllGlobals();
  go('sources');
});

const open = () => {
  go('sources-add', { m: 'paste' });
  return render(AddDocuments);
};
const docPosts = () => calls.filter((c) => c.path === '/api/corpora/1/documents' && c.method === 'POST');

describe('Paste text', () => {
  it('the primary is disabled and the summary asks for text until there is some', async () => {
    open();
    expect(screen.getByRole('button', { name: 'Add text' })).toBeDisabled();
    expect(screen.getByText(/Paste the text first/)).toBeInTheDocument();
    await fireEvent.input(screen.getByLabelText('Pasted text'), { target: { value: 'hola' } });
    expect(screen.getByRole('button', { name: 'Add text' })).toBeEnabled();
  });

  it('pastes text with a default title, then goes to the list', async () => {
    open();
    await fireEvent.input(screen.getByLabelText('Tags'), { target: { value: 'law' } });
    await fireEvent.input(screen.getByLabelText('Pasted text'), { target: { value: 'hola mundo' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    await waitFor(() => expect(docPosts()).toHaveLength(1));
    expect(docPosts()[0].body).toMatchObject({ title: 'Pasted text', text: 'hola mundo', kind: 'paste', tags: 'law' });
    await waitFor(() => expect(route.screen).toBe('sources'));
    expect(draft.pasteText).toBe('');
    expect(draft.meta.tags).toBe('law');
  });

  it('uses the typed title', async () => {
    open();
    await fireEvent.input(screen.getByLabelText('Title of the pasted text'), { target: { value: 'Mi nota' } });
    await fireEvent.input(screen.getByLabelText('Pasted text'), { target: { value: 'hola' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    await waitFor(() => expect(docPosts()).toHaveLength(1));
    expect(docPosts()[0].body).toMatchObject({ title: 'Mi nota' });
  });

  it('keeps the text and stays on the page when adding fails', async () => {
    documentsStatus = 500;
    open();
    await fireEvent.input(screen.getByLabelText('Pasted text'), { target: { value: 'hola mundo' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    await waitFor(() => expect(messages.current?.kind).toBe('err'));
    expect(route.screen).toBe('sources-add');
    expect((screen.getByLabelText('Pasted text') as HTMLTextAreaElement).value).toBe('hola mundo');
  });

  it('the text survives moving to another method and back', async () => {
    open();
    await fireEvent.input(screen.getByLabelText('Pasted text'), { target: { value: 'hola mundo' } });
    await fireEvent.click(screen.getByRole('tab', { name: 'Upload files' }));
    await fireEvent.click(screen.getByRole('tab', { name: 'Paste text' }));
    expect((screen.getByLabelText('Pasted text') as HTMLTextAreaElement).value).toBe('hola mundo');
  });
});

describe('addPaste when the corpus changes meanwhile', () => {
  it('returns false and leaves the new corpus draft alone', async () => {
    let release: () => void = () => {};
    documentsGate = new Promise<void>((r) => (release = r));
    draft.pasteText = 'for the old corpus';
    const pending = addPaste();
    await waitFor(() => expect(docPosts()).toHaveLength(1));
    corpusStore.currentId = 2;
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
    draft.pasteText = 'typed for the new corpus';
    draft.pasteTitle = 'New title';
    release();
    expect(await pending).toBe(false);
    expect(draft.pasteText).toBe('typed for the new corpus');
    expect(draft.pasteTitle).toBe('New title');
    expect(work.busy).toBeNull();
  });
});
