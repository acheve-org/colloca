import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Projects from '../src/screens/Projects.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { loadLanguageNames } from '../src/lib/context.svelte';
import { messages } from '../src/lib/messages.svelte';
import { projectStore } from '../src/lib/projects.svelte';
import { __setViewportForTests } from '../src/lib/viewport.svelte';
import { setLang } from '../src/lib/i18n';

const corpus = (id: number, name: string, project_id: number | null) => ({
  id, name, lang: 'es', project_id, is_reference: 0, docs: 3, tokens: 1000 + id,
});

interface Call { method: string; path: string; body?: Record<string, unknown> }
let calls: Call[];
let projects: { id: number; name: string; corpora: number; trashed: number; terms: number }[];
let corpora: ReturnType<typeof corpus>[];
let failPatch: number | null;

const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });

beforeEach(() => {
  calls = [];
  failPatch = null;
  projects = [
    { id: 7, name: 'Acme', corpora: 2, trashed: 0, terms: 0 },
    { id: 8, name: 'Bolt', corpora: 1, trashed: 0, terms: 0 },
    { id: 9, name: 'Empty', corpora: 0, trashed: 0, terms: 0 },
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
    if (path === '/api/projects' && method === 'POST') {
      projects = [...projects, { id: 11, name: body.name, corpora: 0, trashed: 0, terms: 0 }];
      return res(201, { id: 11 });
    }
    if (path === '/api/corpora' && method === 'GET') return res(200, corpora);
    if (path === '/api/corpora' && method === 'POST') {
      corpora = [...corpora, corpus(4, body.name, body.project_id)];
      return res(201, { id: 4 });
    }
    if (/^\/api\/corpora\/\d+$/.test(path) && method === 'PATCH') {
      const id = Number(path.split('/').pop());
      if (id === failPatch) return res(500, { detail: 'patch failed' });
      corpora = corpora.map((c) => (c.id === id ? { ...c, ...body } : c));
      return res(200, {});
    }
    if (/\/parallel$/.test(path)) return res(200, { documents: 0, segments: 0, partners: [] });
    if (method === 'DELETE' || method === 'PATCH') return res(200, {});
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  __setViewportForTests({ stacked: false });
  setLang('en');
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
const openProjectMenu = async () => {
  await fireEvent.click(screen.getByRole('button', { name: 'Project actions' }));
  await tick();
  return screen.getByRole('menu', { name: 'Project actions' });
};
// The project's ⋯ menu: Delete opens the existing delete-project dialog.
const askDeleteProject = async () => {
  await fireEvent.click(within(await openProjectMenu()).getByRole('menuitem', { name: 'Delete' }));
  await tick();
};

describe('Projects screen empty states', () => {
  it('no projects: the first-run hint, and + New opens the dialog with the first-run placeholder', async () => {
    projects = [];
    corpora = [];
    corpusStore.list = [];
    corpusStore.currentId = null;
    render(Projects);
    await waitFor(() => expect(projectStore.loaded).toBe(true));
    await tick();
    expect(screen.getByText('Start your first project')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    await tick();
    const dlg = screen.getByRole('dialog', { name: 'New project' });
    expect(within(dlg).getByPlaceholderText('Contracts 2024')).toBeInTheDocument();
    await fireEvent.input(within(dlg).getByRole('textbox'), { target: { value: 'Acme' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/projects')).toBe(true));
  });

  it('a project without corpora: Create a corpus prompt next to the New corpus button', async () => {
    projects = [{ id: 9, name: 'Empty', corpora: 0, trashed: 0, terms: 0 }];
    corpora = [];
    corpusStore.list = [];
    corpusStore.currentId = null;
    render(Projects);
    await waitFor(() => expect(screen.getByText('Create a corpus')).toBeInTheDocument());
    // the toolbar button and the card's own button
    const buttons = screen.getAllByRole('button', { name: 'New corpus' });
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b).toBeEnabled();
  });
});

describe('Projects screen', () => {
  it('defaults to the working corpus project and shows only its corpora', async () => {
    await show();
    expect(rows()).toHaveLength(2);
    expect(screen.queryByText('B1')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /Bolt/ }));
    expect(screen.getByText('B1')).toBeInTheDocument();
    expect(screen.queryByText('A1')).toBeNull();
  });

  it('the list is a navigation landmark with the Projects heading, corpus counts and aria-pressed', async () => {
    await show();
    const nav = screen.getByRole('navigation', { name: 'Projects' });
    expect(within(nav).getByText('Projects')).toBeInTheDocument();
    const acme = within(nav).getByRole('button', { name: /^Acme/ });
    expect(acme).toHaveAttribute('aria-pressed', 'true');
    expect(acme).toHaveTextContent('2');
    expect(within(nav).getByRole('button', { name: /^Bolt/ })).toHaveAttribute('aria-pressed', 'false');
    expect(within(nav).queryByRole('button', { name: /No project/ })).toBeNull();
    expect(within(nav).queryByRole('textbox')).toBeNull();
  });

  it('"No project" comes last in the list when it has corpora', async () => {
    corpora = [...corpora, corpus(5, 'Loose', null)];
    corpusStore.list = [...corpora];
    await show();
    const names = within(screen.getByRole('navigation', { name: 'Projects' })).getAllByRole('button')
      .filter((b) => b.hasAttribute('aria-pressed'))
      .map((b) => b.textContent?.trim());
    expect(names).toHaveLength(4);
    expect(names.at(-1)).toMatch(/^No project/);
  });

  it('+ New opens the New project dialog; Create posts the name and selects the new project', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    await tick();
    const dlg = screen.getByRole('dialog', { name: 'New project' });
    const input = within(dlg).getByRole('textbox');
    expect(input).toHaveAttribute('maxlength', '120');
    expect(within(dlg).getByRole('button', { name: 'Create project' })).toBeDisabled();
    await fireEvent.input(input, { target: { value: ' Zed ' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Zed/ })).toHaveAttribute('aria-pressed', 'true'));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/projects')?.body).toEqual({ name: 'Zed' });
    expect(messages.current).toEqual({ text: 'Project created.', kind: 'ok' });
    expect(screen.getByRole('button', { name: /^Acme/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Open selects the corpus and the row then shows Current', async () => {
    await show();
    expect(within(rowOf('A1')).getByText('Current')).toBeInTheDocument();
    expect(within(rowOf('A1')).queryByRole('button', { name: /^Open/ })).toBeNull();
    await fireEvent.click(within(rowOf('A2')).getByRole('button', { name: /^Open/ }));
    await waitFor(() => expect(corpusStore.currentId).toBe(2));
    expect(within(rowOf('A2')).getByText('Current')).toBeInTheDocument();
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

  it('the panel heading is the project name, with ✎ and the project menu', async () => {
    await show();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^Acme$/);
    expect(screen.getByRole('table', { name: 'Corpora in Acme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename project' })).toBeInTheDocument();
    const menu = await openProjectMenu();
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['Delete']);
  });

  it('✎ swaps the heading for an input; Enter renames the project with PATCH', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: 'Rename project' }));
    await tick();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    const input = screen.getByLabelText('Name of project Acme');
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Acme');
    expect(input).toHaveAttribute('maxlength', '120');
    await fireEvent.input(input, { target: { value: ' Acme 2 ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.path === '/api/projects/7')?.body).toEqual({ name: 'Acme 2' }));
    expect(messages.current).toEqual({ text: 'Project renamed.', kind: 'ok' });
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename project' })).toHaveFocus());
  });

  it('Escape cancels the rename, sends nothing and refocuses ✎', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: 'Rename project' }));
    await tick();
    const input = screen.getByLabelText('Name of project Acme');
    await fireEvent.input(input, { target: { value: 'Draft' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    await tick();
    expect(screen.queryByLabelText('Name of project Acme')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^Acme$/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename project' })).toHaveFocus());
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('Enter on an unchanged name sends nothing', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: 'Rename project' }));
    await tick();
    await fireEvent.keyDown(screen.getByLabelText('Name of project Acme'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument());
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('rows show Current for the working corpus and Open for the others; no row has Rename, Move or Delete', async () => {
    await show();
    expect(within(rowOf('A1')).getByText('Current')).toBeInTheDocument();
    expect(rowOf('A1')).toHaveClass('cur');
    expect(within(rowOf('A2')).getByRole('button', { name: 'Open A2' })).toBeInTheDocument();
    expect(rowOf('A2')).not.toHaveClass('cur');
    for (const r of rows()) {
      expect(within(r).queryByRole('button', { name: /Rename|Delete/ })).toBeNull();
      expect(within(r).queryByRole('combobox')).toBeNull();
      expect(within(r).queryByRole('textbox')).toBeNull();
    }
    const src = import.meta.glob('../src/screens/Projects.svelte', { query: '?raw', import: 'default', eager: true });
    expect(Object.values(src)[0] as string).toMatch(/tr\.cur[^}]*background:\s*var\(--accent-soft\)/s);
  });

  it('clicking a row selects it; clicking Open does not', async () => {
    await show();
    for (const r of rows()) expect(r).toHaveAttribute('aria-selected', 'false');
    expect(rowOf('A2')).toHaveAttribute('tabindex', '0');
    await fireEvent.click(rowOf('A2'));
    expect(rowOf('A2')).toHaveAttribute('aria-selected', 'true');
    expect(rowOf('A1')).toHaveAttribute('aria-selected', 'false');
    await fireEvent.click(rowOf('A1'));
    expect(rowOf('A1')).toHaveAttribute('aria-selected', 'true');
    expect(rowOf('A2')).toHaveAttribute('aria-selected', 'false');
    await fireEvent.click(within(rowOf('A2')).getByRole('button', { name: 'Open A2' }));
    await waitFor(() => expect(corpusStore.currentId).toBe(2));
    expect(rowOf('A2')).toHaveAttribute('aria-selected', 'false');
    expect(rowOf('A1')).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter and Space on a row select it', async () => {
    await show();
    await fireEvent.keyDown(rowOf('A2'), { key: 'Enter' });
    expect(rowOf('A2')).toHaveAttribute('aria-selected', 'true');
    await fireEvent.keyDown(rowOf('A1'), { key: ' ' });
    expect(rowOf('A1')).toHaveAttribute('aria-selected', 'true');
    expect(rowOf('A2')).toHaveAttribute('aria-selected', 'false');
  });

  it('choosing another project clears the corpus selection', async () => {
    await show();
    await fireEvent.click(rowOf('A2'));
    await fireEvent.click(screen.getByRole('button', { name: /^Bolt/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^Acme/ }));
    await tick();
    for (const r of rows()) expect(r).toHaveAttribute('aria-selected', 'false');
  });

  it('deleting a project with corpora needs a target, moves them, then deletes', async () => {
    await show();
    await askDeleteProject();
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
    await askDeleteProject();
    const dlg = screen.getByRole('dialog', { name: 'Delete this project?' });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/projects/9')).toBe(true));
  });

  it('lists project-less corpora under "No project", without ✎ or the project menu', async () => {
    corpora = [...corpora, corpus(5, 'Loose', null)];
    corpusStore.list = [...corpora];
    await show();
    await fireEvent.click(screen.getByRole('button', { name: /No project/ }));
    expect(screen.getByText('Loose')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^No project$/);
    expect(screen.queryByRole('button', { name: 'Rename project' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Project actions' })).toBeNull();
    expect(within(rowOf('Loose')).queryByRole('combobox')).toBeNull();
  });

  it.each([
    ['trashed-only', { id: 9, name: 'Empty', corpora: 0, trashed: 2, terms: 0 }, 'Empty'],
    ['mixed', { id: 7, name: 'Acme', corpora: 2, trashed: 1, terms: 0 }, 'Acme'],
  ])('a %s project cannot be deleted: message and link, Delete disabled, nothing sent', async (_n, proj, name) => {
    projects = projects.map((p) => (p.id === proj.id ? proj : p));
    await show();
    await fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + name) }));
    await askDeleteProject();
    const dlg = screen.getByRole('dialog', { name: 'Delete this project?' });
    expect(dlg).toHaveTextContent(`${name} still has corpora in the Trash`);
    expect(within(dlg).getByRole('link')).toHaveAttribute('href', '#/trash');
    expect(within(dlg).queryByLabelText('Move corpora to…')).toBeNull();
    expect(within(dlg).getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(calls.some((c) => c.method === 'PATCH' || c.method === 'DELETE')).toBe(false);
  });

  it('uses the singular text when the project has one corpus', async () => {
    projects = projects.map((p) => (p.id === 8 ? { ...p, corpora: 1 } : p));
    await show();
    await fireEvent.click(screen.getByRole('button', { name: /Bolt/ }));
    await askDeleteProject();
    expect(screen.getByRole('dialog', { name: 'Delete this project?' })).toHaveTextContent('Bolt still has 1 corpus.');
  });

  it('after a failed move it shows the error, skips DELETE and reloads the lists', async () => {
    failPatch = 2;
    await show();
    await askDeleteProject();
    const dlg = screen.getByRole('dialog', { name: 'Delete this project?' });
    await fireEvent.change(within(dlg).getByLabelText('Move corpora to…'), { target: { value: '8' } });
    const before = calls.filter((c) => c.method === 'GET' && c.path === '/api/projects').length;
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(messages.current).toEqual({ text: 'patch failed', kind: 'err' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'GET' && c.path === '/api/projects').length).toBeGreaterThan(before));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await waitFor(() => expect(corpusStore.list.find((c) => c.id === 1)?.project_id).toBe(8));
  });

  it('the Language column shows the language name, the code when unknown', async () => {
    await loadLanguageNames();
    corpora = [...corpora, { ...corpus(6, 'Odd', 7), lang: 'xx' }];
    corpusStore.list = [...corpora];
    await show();
    expect(within(rowOf('A1')).getByText('Spanish')).toBeInTheDocument();
    expect(within(rowOf('Odd')).getByText('xx')).toBeInTheDocument();
  });

  it.each([
    ['empty project', 9, 'Empty'],
    ['project with corpora', 7, 'Acme'],
  ])('warns about permanent termbase loss for a %s with terms', async (_n, id, name) => {
    projects = projects.map((p) => (p.id === id ? { ...p, terms: 5 } : p));
    await show();
    await fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + name) }));
    await askDeleteProject();
    const dlg = screen.getByRole('dialog', { name: 'Delete this project?' });
    expect(dlg).toHaveTextContent(`Deleting ${name} also permanently deletes its 5 termbase entries.`);
  });

  it('shows no termbase warning when the project has no terms', async () => {
    await show();
    await askDeleteProject();
    expect(screen.getByRole('dialog', { name: 'Delete this project?' })).not.toHaveTextContent('termbase entries');
  });
});

describe('Projects screen stacked below 900px', () => {
  beforeEach(() => __setViewportForTests({ stacked: true }));

  it('arriving shows the list only', async () => {
    await show();
    expect(screen.getByRole('button', { name: /^Acme/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Bolt/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Empty/ })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });

  it('choosing a project shows its panel and Back, without the list', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: /^Bolt/ }));
    await tick();
    expect(screen.getByText('B1')).toBeInTheDocument();
    expect(screen.queryByText('A1')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Projects' })).toBeNull();
  });

  it('Back shows the list and focuses the chosen project', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: /^Bolt/ }));
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await tick();
    expect(screen.queryByRole('table')).toBeNull();
    const bolt = screen.getByRole('button', { name: /^Bolt/ });
    expect(bolt).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(document.activeElement).toBe(bolt));
  });

  it('Back from "No project" focuses the No project item', async () => {
    corpora = [...corpora, corpus(5, 'Loose', null)];
    corpusStore.list = [...corpora];
    await show();
    await fireEvent.click(screen.getByRole('button', { name: /No project/ }));
    await tick();
    expect(screen.getByText('Loose')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /No project/ })));
  });

  it('keeps the chosen project and its corpora when stacked is toggled', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: /^Bolt/ }));
    __setViewportForTests({ stacked: false });
    await tick();
    expect(screen.getByText('B1')).toBeInTheDocument();
    expect(screen.queryByText('A1')).toBeNull();
    expect(screen.getByRole('button', { name: /^Acme/ })).toBeInTheDocument();
    __setViewportForTests({ stacked: true });
    await tick();
    expect(screen.getByText('B1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Acme/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('New corpus and New project still work', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: /^Acme/ }));
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'New corpus' }));
    await tick();
    const dlg = screen.getByRole('dialog', { name: 'New corpus' });
    expect(within(dlg).getByLabelText('Project')).toHaveValue('7');
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    await tick();
    const pdlg = screen.getByRole('dialog', { name: 'New project' });
    await fireEvent.input(within(pdlg).getByRole('textbox'), { target: { value: 'Zed' } });
    await fireEvent.click(within(pdlg).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/projects')).toBe(true));
  });

  it('wide layout has no Back button and shows list and panel together', async () => {
    __setViewportForTests({ stacked: false });
    await show();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Bolt/ })).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
  });

  it('Back is translated', async () => {
    setLang('es');
    await show();
    await fireEvent.click(screen.getByRole('button', { name: /^Bolt/ }));
    await tick();
    expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();
    setLang('it');
    await tick();
    expect(screen.getByRole('button', { name: 'Indietro' })).toBeInTheDocument();
  });
});

describe('Projects screen corpora as cards below 640px', () => {
  beforeEach(() => __setViewportForTests({ narrow: true }));
  afterEach(() => __setViewportForTests({ narrow: false }));

  const cards = () => screen.getAllByRole('listitem').filter((li) => li.classList.contains('ccard'));
  const cardOf = (name: string) => cards().find((c) => within(c).queryByText(name))!;

  it('renders a card per corpus and no table', async () => {
    await show();
    expect(document.querySelector('table')).toBeNull();
    expect(cards()).toHaveLength(2);
    expect(cardOf('A1')).toHaveTextContent(/3/);
    expect(cardOf('A1')).toHaveTextContent('1,001');
    expect(cardOf('A2')).toHaveTextContent('1,002');
  });

  it('Open uses the same handler; the working corpus shows the badge instead', async () => {
    await show();
    expect(within(cardOf('A1')).getByText('Current')).toBeInTheDocument();
    expect(within(cardOf('A1')).queryByRole('button', { name: /^Open/ })).toBeNull();
    await fireEvent.click(within(cardOf('A2')).getByRole('button', { name: /^Open/ }));
    await waitFor(() => expect(corpusStore.currentId).toBe(2));
    expect(within(cardOf('A2')).getByText('Current')).toBeInTheDocument();
  });

  it('a 200-character unbroken name wraps', async () => {
    const long = 'x'.repeat(200);
    corpora = [...corpora, corpus(6, long, 7)];
    corpusStore.list = [...corpora];
    await show();
    expect(within(cardOf(long)).getByText(long)).toHaveClass('cname');
    const src = import.meta.glob('../src/screens/Projects.svelte', { query: '?raw', import: 'default', eager: true });
    expect(Object.values(src)[0] as string).toMatch(/\.cname[^}]*overflow-wrap:\s*anywhere/s);
  });

  it('cards have no ⋯ menu; the name is a button that selects the corpus', async () => {
    await show();
    for (const c of cards()) expect(within(c).queryByRole('button', { name: /actions/i })).toBeNull();
    const name = within(cardOf('A2')).getByRole('button', { name: 'A2' });
    expect(name).toHaveAttribute('aria-pressed', 'false');
    await fireEvent.click(name);
    expect(name).toHaveAttribute('aria-pressed', 'true');
    expect(within(cardOf('A1')).getByRole('button', { name: 'A1' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Open on a card does not select it', async () => {
    await show();
    await fireEvent.click(within(cardOf('A2')).getByRole('button', { name: 'Open A2' }));
    await waitFor(() => expect(corpusStore.currentId).toBe(2));
    expect(within(cardOf('A2')).getByRole('button', { name: 'A2' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('the project menu is still there, and its label is translated', async () => {
    await show();
    expect(screen.getByRole('button', { name: 'Project actions' })).toBeInTheDocument();
    setLang('es');
    await tick();
    expect(screen.getByRole('button', { name: 'Acciones del proyecto' })).toBeInTheDocument();
    expect(within(cardOf('A1')).getByText('Actual')).toBeInTheDocument();
    setLang('it');
    await tick();
    expect(screen.getByRole('button', { name: 'Azioni del progetto' })).toBeInTheDocument();
    expect(within(cardOf('A1')).getByText('Corrente')).toBeInTheDocument();
  });

  it('the pane overflow is visible so the menu overlays the page', async () => {
    await show();
    expect(document.querySelector('section.right')).toHaveClass('cardsOn');
    const src = import.meta.glob('../src/screens/Projects.svelte', { query: '?raw', import: 'default', eager: true });
    expect(Object.values(src)[0] as string).toMatch(/\.right\.cardsOn[^}]*overflow:\s*visible/s);
  });

  it('with no corpora the empty-state card is unchanged', async () => {
    projects = [{ id: 9, name: 'Empty', corpora: 0, trashed: 0, terms: 0 }];
    corpora = [];
    corpusStore.list = [];
    corpusStore.currentId = null;
    render(Projects);
    await waitFor(() => expect(screen.getByText('Create a corpus')).toBeInTheDocument());
    expect(screen.queryAllByRole('listitem').filter((li) => li.classList.contains('ccard'))).toHaveLength(0);
  });

});
