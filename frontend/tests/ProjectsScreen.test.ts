import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Projects from '../src/screens/Projects.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { messages } from '../src/lib/messages.svelte';
import { projectStore } from '../src/lib/projects.svelte';

const corpus = (id: number, name: string, project_id: number | null) => ({
  id, name, lang: 'es', project_id, is_reference: 0, docs: 3, tokens: 1000 + id,
});

interface Call { method: string; path: string; body?: Record<string, unknown> }
let calls: Call[];
let projects: { id: number; name: string; corpora: number; trashed: number }[];
let corpora: ReturnType<typeof corpus>[];

const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });

beforeEach(() => {
  calls = [];
  projects = [
    { id: 7, name: 'Acme', corpora: 2, trashed: 0 },
    { id: 8, name: 'Bolt', corpora: 1, trashed: 0 },
    { id: 9, name: 'Empty', corpora: 0, trashed: 0 },
  ];
  corpora = [corpus(1, 'A1', 7), corpus(2, 'A2', 7), corpus(3, 'B1', 8)];
  corpusStore.list = [...corpora];
  corpusStore.currentId = 1;
  corpusStore.loaded = true;
  projectStore.list = [];
  messages.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(url, 'http://x').pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    if (path === '/api/languages') return res(200, { es: 'Spanish', it: 'Italian' });
    if (path === '/api/projects' && method === 'GET') return res(200, projects);
    if (path === '/api/corpora' && method === 'GET') return res(200, corpora);
    if (path === '/api/corpora' && method === 'POST') {
      corpora = [...corpora, corpus(4, body.name, body.project_id)];
      return res(201, { id: 4 });
    }
    if (/^\/api\/corpora\/\d+$/.test(path) && method === 'PATCH') {
      const id = Number(path.split('/').pop());
      corpora = corpora.map((c) => (c.id === id ? { ...c, ...body } : c));
      return res(200, {});
    }
    if (/\/parallel$/.test(path)) return res(200, { documents: 0, segments: 0, partners: [] });
    if (method === 'DELETE' || method === 'PATCH') return res(200, {});
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.list = [];
  corpusStore.currentId = null;
  projectStore.list = [];
});

async function show() {
  render(Projects);
  await waitFor(() => expect(projectStore.list).toHaveLength(3));
  await tick();
}
const rows = () => screen.getAllByRole('row').slice(1);
const rowOf = (name: string) => rows().find((r) => within(r).queryByText(name))!;

describe('Projects screen', () => {
  it('defaults to the working corpus project and shows only its corpora', async () => {
    await show();
    expect(rows()).toHaveLength(2);
    expect(screen.queryByText('B1')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /Bolt/ }));
    expect(screen.getByText('B1')).toBeInTheDocument();
    expect(screen.queryByText('A1')).toBeNull();
  });

  it('Open selects the corpus and the row then shows Working', async () => {
    await show();
    expect(within(rowOf('A1')).getByText('Working')).toBeInTheDocument();
    expect(within(rowOf('A1')).queryByRole('button', { name: /^Open/ })).toBeNull();
    await fireEvent.click(within(rowOf('A2')).getByRole('button', { name: /^Open/ }));
    await waitFor(() => expect(corpusStore.currentId).toBe(2));
    expect(within(rowOf('A2')).getByText('Working')).toBeInTheDocument();
    expect(within(rowOf('A1')).getByRole('button', { name: /^Open/ })).toBeInTheDocument();
  });

  it('New corpus posts the selected project and opens the new corpus', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: /Bolt/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'New corpus' }));
    await tick();
    const dlg = screen.getByRole('dialog', { name: 'New corpus' });
    await waitFor(() => expect(within(dlg).getByLabelText('Language')).toHaveValue('es'));
    expect(within(dlg).getByLabelText('Project')).toHaveValue('8');
    await fireEvent.input(within(dlg).getByRole('textbox'), { target: { value: ' Neu ' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(corpusStore.currentId).toBe(4));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/corpora')?.body)
      .toEqual({ name: 'Neu', lang: 'es', project_id: 8 });
  });

  it('Move patches the corpus with the new project_id', async () => {
    await show();
    const row = rowOf('A2');
    await fireEvent.change(within(row).getByLabelText('Move'), { target: { value: '8' } });
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.path === '/api/corpora/2')).toBe(true));
    expect(calls.find((c) => c.path === '/api/corpora/2' && c.method === 'PATCH')?.body).toEqual({ project_id: 8 });
    await waitFor(() => expect(screen.queryByText('A2')).toBeNull());
  });

  it('deletes a corpus only after confirmation', async () => {
    await show();
    await fireEvent.click(within(rowOf('A2')).getByRole('button', { name: 'Delete A2' }));
    await tick();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const dlg = screen.getByRole('dialog', { name: 'Delete corpus' });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/corpora/2')).toBe(true));
  });

  it('renames a project with PATCH', async () => {
    await show();
    const input = screen.getByLabelText('Name of project Acme');
    await fireEvent.input(input, { target: { value: 'Acme 2' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Rename Acme' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.path === '/api/projects/7')).toBe(true));
    expect(calls.find((c) => c.path === '/api/projects/7')?.body).toEqual({ name: 'Acme 2' });
  });

  it('deleting a project with corpora needs a target, moves them, then deletes', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Acme' }));
    await tick();
    const dlg = screen.getByRole('dialog', { name: 'Delete this project?' });
    expect(dlg).toHaveTextContent('Acme still has 2 corpora');
    const del = within(dlg).getByRole('button', { name: 'Delete' });
    expect(del).toBeDisabled();
    await fireEvent.change(within(dlg).getByLabelText('Move corpora to…'), { target: { value: '8' } });
    expect(del).toBeEnabled();
    await fireEvent.click(del);
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/projects/7')).toBe(true));
    const seq = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);
    expect(seq.slice(0, 3)).toEqual(['PATCH /api/corpora/1', 'PATCH /api/corpora/2', 'DELETE /api/projects/7']);
    expect(calls.find((c) => c.path === '/api/corpora/1')?.body).toEqual({ project_id: 8 });
  });

  it('deleting an empty project only asks for confirmation', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: /Empty/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Empty' }));
    await tick();
    const dlg = screen.getByRole('dialog', { name: 'Delete this project?' });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/projects/9')).toBe(true));
  });

  it('lists project-less corpora under "No project" and offers Move', async () => {
    corpora = [...corpora, corpus(5, 'Loose', null)];
    corpusStore.list = [...corpora];
    await show();
    await fireEvent.click(screen.getByRole('button', { name: /No project/ }));
    expect(screen.getByText('Loose')).toBeInTheDocument();
    expect(within(rowOf('Loose')).getByLabelText('Move')).toBeInTheDocument();
  });
});
