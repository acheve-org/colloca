import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CorpusSwitcher from '../src/lib/ui/CorpusSwitcher.svelte';
import ProjectsDialog from '../src/lib/ui/ProjectsDialog.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { messages } from '../src/lib/messages.svelte';
import { projectStore } from '../src/lib/projects.svelte';

const corpus = (id: number, project_id: number | null) => ({
  id, name: `C${id}`, lang: 'es', project_id, is_reference: 0, docs: 1, tokens: 10,
});

interface Call { method: string; path: string; body?: unknown }
let calls: Call[];
let projects: { id: number; name: string; corpora: number }[];
let conflict: boolean;

const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });

beforeEach(() => {
  calls = [];
  conflict = false;
  projects = [{ id: 7, name: 'Acme', corpora: 1 }, { id: 8, name: '<b>Bolt</b>', corpora: 0 }];
  corpusStore.list = [corpus(1, null), corpus(2, 7), corpus(3, 7)];
  corpusStore.currentId = 1;
  corpusStore.loaded = true;
  projectStore.list = [];
  projectStore.filter = '';
  messages.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const u = new URL(url, 'http://x');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: u.pathname, body });
    const p = u.pathname;
    if (p === '/api/projects' && method === 'GET') return res(200, projects);
    if (p === '/api/projects' && method === 'POST') {
      if (conflict) return res(409, { detail: "A project called 'Acme' already exists" });
      projects = [...projects, { id: 9, name: body.name, corpora: 0 }];
      return res(201, { id: 9 });
    }
    if (/^\/api\/projects\/\d+$/.test(p) && method === 'PATCH') {
      projects = projects.map((x) => (p.endsWith(`/${x.id}`) ? { ...x, name: body.name } : x));
      return res(200, { ok: true });
    }
    if (/^\/api\/projects\/\d+$/.test(p) && method === 'DELETE') {
      projects = projects.filter((x) => !p.endsWith(`/${x.id}`));
      return res(204, null);
    }
    if (p === '/api/corpora' && method === 'POST') return res(201, { id: 4 });
    if (p === '/api/corpora') return res(200, corpusStore.list);
    if (p === '/api/languages') return res(200, { es: 'Spanish' });
    if (/\/parallel$/.test(p)) return res(200, { documents: 0, segments: 0, partners: [] });
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.list = [];
  corpusStore.currentId = null;
  projectStore.filter = '';
});

async function openDialog() {
  render(ProjectsDialog, { props: { open: true } });
  const dlg = screen.getByRole('dialog', { name: 'Projects' });
  await waitFor(() => expect(within(dlg).getByDisplayValue('Acme')).toBeInTheDocument());
  return dlg;
}

describe('ProjectsDialog', () => {
  it('lists the projects with their corpus counts, names as text', async () => {
    const dlg = await openDialog();
    expect(within(dlg).getByDisplayValue('<b>Bolt</b>')).toBeInTheDocument();
    expect(within(dlg).getByText('1 corpus')).toBeInTheDocument();
    expect(within(dlg).getByText('0 corpora')).toBeInTheDocument();
    expect(dlg.querySelector('b')).toBeNull();
  });

  it('creates a project', async () => {
    const dlg = await openDialog();
    await fireEvent.input(within(dlg).getByLabelText('New project'), { target: { value: ' Zeta ' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/projects')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Zeta' });
    await waitFor(() => expect(within(dlg).getByDisplayValue('Zeta')).toBeInTheDocument());
    expect((within(dlg).getByLabelText('New project') as HTMLInputElement).value).toBe('');
  });

  it('shows the server detail when the name is taken', async () => {
    conflict = true;
    const dlg = await openDialog();
    await fireEvent.input(within(dlg).getByLabelText('New project'), { target: { value: 'Acme' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(messages.current).toEqual({ text: "A project called 'Acme' already exists", kind: 'err' }));
  });

  it('renames a project', async () => {
    const dlg = await openDialog();
    await fireEvent.input(within(dlg).getByLabelText('Name of project Acme'), { target: { value: 'Acme Ltd' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Rename Acme' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const c = calls.find((x) => x.method === 'PATCH')!;
    expect(c.path).toBe('/api/projects/7');
    expect(c.body).toEqual({ name: 'Acme Ltd' });
  });

  it('deletes a project after confirmation and clears a filter on it', async () => {
    projectStore.filter = '7';
    const dlg = await openDialog();
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Delete Acme' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const confirm = screen.getByRole('dialog', { name: 'Delete this project?' });
    await fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/projects/7')).toBe(true));
    await waitFor(() => expect(within(dlg).queryByDisplayValue('Acme')).not.toBeInTheDocument());
    expect(projectStore.filter).toBe('');
  });
});

describe('CorpusSwitcher project filter', () => {
  const corpusSelect = () => screen.getByLabelText('Corpus') as HTMLSelectElement;
  const corpusOptions = () => [...corpusSelect().querySelectorAll('option')].map((o) => o.textContent);

  it('groups the corpora by project when no project is chosen', async () => {
    render(CorpusSwitcher);
    await waitFor(() => expect(corpusSelect().querySelectorAll('optgroup').length).toBe(2));
    const groups = [...corpusSelect().querySelectorAll('optgroup')].map((g) => g.getAttribute('label'));
    expect(groups).toEqual(['Acme', 'No project']);
  });

  it('narrows the corpora to the chosen project and selects one of them', async () => {
    render(CorpusSwitcher);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Acme (1)' })).toBeInTheDocument());
    await fireEvent.change(screen.getByLabelText('Project'), { target: { value: '7' } });
    await waitFor(() => expect(corpusStore.currentId).toBe(2));
    expect(corpusOptions()).toEqual(['C2 [es]', 'C3 [es]']);
    await fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'none' } });
    await waitFor(() => expect(corpusStore.currentId).toBe(1));
    expect(corpusOptions()).toEqual(['C1 [es]']);
  });

  it('creates a corpus in the filtered project by default', async () => {
    render(CorpusSwitcher);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Acme (1)' })).toBeInTheDocument());
    await fireEvent.change(screen.getByLabelText('Project'), { target: { value: '7' } });
    await fireEvent.click(screen.getByRole('button', { name: 'New corpus' }));
    await tick();
    const dlg = screen.getByRole('dialog', { name: 'New corpus' });
    expect((within(dlg).getByLabelText('Project of the new corpus') as HTMLSelectElement).value).toBe('7');
    await fireEvent.input(within(dlg).getByLabelText('Name'), { target: { value: 'New' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/corpora')).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/corpora')!.body).toEqual({ name: 'New', lang: 'es', project_id: 7 });
  });

  it('opens the projects dialog', async () => {
    render(CorpusSwitcher);
    await fireEvent.click(screen.getByRole('button', { name: 'Manage projects' }));
    expect(screen.getByRole('dialog', { name: 'Projects' })).toHaveAttribute('open');
  });
});
