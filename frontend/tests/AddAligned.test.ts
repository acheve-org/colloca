import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddDocuments from '../src/screens/AddDocuments.svelte';
import { draft, resetDraft, work } from '../src/lib/addDocuments.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { stopAllJobs } from '../src/lib/jobs.svelte';
import { messages } from '../src/lib/messages.svelte';
import { go, route } from '../src/lib/router.svelte';

interface Call { method: string; path: string; params: URLSearchParams; body?: unknown }
let calls: Call[];
let langsReply: Record<string, string> | null;
let pairsReply: { status: number; body: unknown };

const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });
const corpus = (id: number, lang = 'es') => ({ id, name: `C${id}`, lang, project_id: null, is_reference: 0, docs: 2, tokens: 10 });

beforeEach(() => {
  calls = [];
  langsReply = null;
  pairsReply = { status: 202, body: [{ file: 'tm.tmx', ok: true, job_id: 11, partner_corpus_id: 2 }] };
  corpusStore.list = [corpus(1), corpus(2, 'it')];
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
    if (u.pathname === '/api/languages' && langsReply) return res(200, langsReply);
    if (u.pathname === '/api/corpora/1/upload-pairs') return res(pairsReply.status, pairsReply.body);
    if (/^\/api\/corpora\/\d+\/jobs$/.test(u.pathname)) return res(200, []);
    if (u.pathname === '/api/corpora') return res(200, corpusStore.list);
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  stopAllJobs();
  vi.unstubAllGlobals();
  go('sources');
});

const open = (sub = 'tm') => {
  go('sources-add', { m: 'al', sub });
  return render(AddDocuments);
};
const pairCalls = () => calls.filter((c) => c.path === '/api/corpora/1/upload-pairs');
const chooseFile = (name = 'tm.tmx') =>
  fireEvent.change(screen.getByLabelText('Aligned file'), { target: { files: [new File(['<tmx/>'], name)] } });

describe('Aligned texts', () => {
  it('the chips pick the sub-choice and are pressed buttons in a named group', async () => {
    open();
    expect(screen.getByRole('group', { name: 'Aligned texts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Translation memory (TMX / two columns)' })).toHaveAttribute('aria-pressed', 'true');
    await fireEvent.click(screen.getByRole('button', { name: 'Align two documents' }));
    expect(route.params.sub).toBe('two');
  });

  it('imports aligned pairs into the chosen partner corpus with the metadata', async () => {
    open();
    await fireEvent.input(screen.getByLabelText('Type'), { target: { value: 'manual' } });
    await chooseFile();
    expect((screen.getByLabelText('Translations go to') as HTMLSelectElement).value).toBe('2');
    await fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(pairCalls()).toHaveLength(1));
    const c = pairCalls()[0];
    expect(c.params.get('partner_corpus_id')).toBe('2');
    expect(c.params.get('swap')).toBe('false');
    expect(c.params.get('text_type')).toBe('manual');
    expect((c.body as FormData).getAll('files').length).toBe(1);
    await waitFor(() => expect(route.screen).toBe('sources'));
  });

  it('sets the first partner in the draft when the form mounts', async () => {
    open();
    await waitFor(() => expect(draft.partner).toBe('2'));
  });

  it('asks for a name when the translations go to a new corpus', async () => {
    open();
    await chooseFile();
    await fireEvent.change(screen.getByLabelText('Translations go to'), { target: { value: 'new' } });
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    expect(screen.getByText(/Name the new corpus first/)).toBeInTheDocument();
    await fireEvent.input(screen.getByLabelText('Name of the new corpus'), { target: { value: 'Traduzioni' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(pairCalls()).toHaveLength(1));
    expect(pairCalls()[0].params.get('partner_name')).toBe('Traduzioni');
  });

  it('a new partner corpus gets the chosen language when several are set up', async () => {
    langsReply = { es: 'Spanish', it: 'Italian', fr: 'French' };
    open();
    await chooseFile();
    await fireEvent.change(screen.getByLabelText('Translations go to'), { target: { value: 'new' } });
    await fireEvent.input(screen.getByLabelText('Name of the new corpus'), { target: { value: 'Traductions' } });
    await fireEvent.change(await screen.findByLabelText('Language of the new corpus'), { target: { value: 'fr' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(pairCalls()).toHaveLength(1));
    expect(pairCalls()[0].params.get('partner_lang')).toBe('fr');
  });

  it('Import is disabled until a file is chosen', async () => {
    open();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    expect(screen.getByText(/Choose a file first/)).toBeInTheDocument();
    await chooseFile();
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
  });

  it('a rejected import stays on the page with the message and keeps the file', async () => {
    pairsReply = { status: 202, body: [{ file: 'tm.tmx', ok: false, error: 'bad tmx' }] };
    open();
    await chooseFile();
    await fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(messages.current?.text).toBe('Rejected: bad tmx'));
    expect(route.screen).toBe('sources-add');
    expect(draft.pairFile).not.toBeNull();
  });

  it('Align two documents shows its card and neither the About card nor the bar', async () => {
    open('two');
    expect(screen.getByRole('heading', { name: 'Align two documents' })).toBeInTheDocument();
    expect(screen.queryByText('About these documents')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });
});
