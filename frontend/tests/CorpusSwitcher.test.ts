import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CorpusSwitcher from '../src/lib/ui/CorpusSwitcher.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { messages } from '../src/lib/messages.svelte';

const corpus = (id: number, name: string) => ({
  id, name, lang: 'es', project_id: null, is_reference: 0, docs: 3, tokens: 10,
});

interface Call { method: string; url: string; body?: unknown }
let calls: Call[];
let corpora: ReturnType<typeof corpus>[];
let languages: Record<string, string>;
let failPost: string | null;

function res(status: number, body: unknown) {
  return { ok: status < 400, status, statusText: 'x', json: async () => body };
}

beforeEach(() => {
  calls = [];
  corpora = [corpus(1, 'Alpha')];
  languages = { es: 'Spanish', it: 'Italian' };
  failPost = null;
  corpusStore.list = [...corpora];
  corpusStore.currentId = 1;
  messages.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/languages') return res(200, languages);
    if (url === '/api/corpora' && method === 'POST') {
      if (failPost) return res(400, { detail: failPost });
      corpora = [...corpora, corpus(2, 'Beta')];
      return res(201, { id: 2 });
    }
    if (url === '/api/corpora') return res(200, corpora);
    if (/\/parallel$/.test(url)) return res(200, { documents: 0, segments: 0, partners: [] });
    if (method === 'DELETE') {
      corpora = corpora.filter((c) => c.id !== 1);
      return res(204, null);
    }
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.list = [];
  corpusStore.currentId = null;
});

async function openNew() {
  render(CorpusSwitcher);
  await waitFor(() => expect(calls.some((c) => c.url === '/api/languages')).toBe(true));
  await tick();
  await fireEvent.click(screen.getByRole('button', { name: 'New corpus' }));
  await tick();
  return screen.getByRole('dialog', { name: 'New corpus' });
}

describe('CorpusSwitcher', () => {
  it('creates with the trimmed name and selects the new corpus', async () => {
    const dlg = await openNew();
    await fireEvent.input(within(dlg).getByRole('textbox'), { target: { value: '  Beta  ' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(corpusStore.currentId).toBe(2));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Beta', lang: 'es' });
    expect(dlg).not.toHaveAttribute('open');
  });

  it('keeps Create disabled for a whitespace-only name', async () => {
    const dlg = await openNew();
    const create = within(dlg).getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    await fireEvent.input(within(dlg).getByRole('textbox'), { target: { value: '   ' } });
    expect(create).toBeDisabled();
    await fireEvent.input(within(dlg).getByRole('textbox'), { target: { value: 'x' } });
    expect(create).toBeEnabled();
  });

  it('keeps Create disabled when languages fail to load', async () => {
    languages = {};
    const dlg = await openNew();
    await fireEvent.input(within(dlg).getByRole('textbox'), { target: { value: 'x' } });
    expect(within(dlg).getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('surfaces an API error through messages', async () => {
    failPost = 'boom';
    const dlg = await openNew();
    await fireEvent.input(within(dlg).getByRole('textbox'), { target: { value: 'x' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(messages.current).toEqual({ text: 'boom', kind: 'err' }));
  });

  it('deletes only after confirmation, then reloads', async () => {
    render(CorpusSwitcher);
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await tick();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const dlg = screen.getByRole('dialog', { name: 'Delete corpus' });
    expect(dlg).toHaveTextContent('Alpha');
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/corpora/1')).toBe(true));
    await waitFor(() => expect(corpusStore.list).toHaveLength(0));
  });

  it('disables Delete when there is no corpus', async () => {
    corpusStore.list = [];
    corpusStore.currentId = null;
    render(CorpusSwitcher);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});
