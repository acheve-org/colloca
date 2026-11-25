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

describe('Projects screen empty states', () => {
  it('no projects: first-project prompt with a single field and Create project', async () => {
    projects = [];
    corpora = [];
    corpusStore.list = [];
    corpusStore.currentId = null;
    render(Projects);
    await waitFor(() => expect(projectStore.loaded).toBe(true));
    await tick();
    expect(screen.getByText('Start your first project')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Contracts 2024')).toBeInTheDocument();
    await fireEvent.input(screen.getByLabelText('New project'), { target: { value: 'Acme' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
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
    await fireEvent.change(within(row).getByLabelText(/^Move /), { target: { value: '8' } });
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
    expect(within(rowOf('Loose')).getByLabelText(/^Move /)).toBeInTheDocument();
  });

  it.each([
    ['trashed-only', { id: 9, name: 'Empty', corpora: 0, trashed: 2, terms: 0 }, 'Empty'],
    ['mixed', { id: 7, name: 'Acme', corpora: 2, trashed: 1, terms: 0 }, 'Acme'],
  ])('a %s project cannot be deleted: message and link, Delete disabled, nothing sent', async (_n, proj, name) => {
    projects = projects.map((p) => (p.id === proj.id ? proj : p));
    await show();
    await fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + name) }));
    await fireEvent.click(screen.getByRole('button', { name: `Delete ${name}` }));
    await tick();
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
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Bolt' }));
    await tick();
    expect(screen.getByRole('dialog', { name: 'Delete this project?' })).toHaveTextContent('Bolt still has 1 corpus.');
  });

  it('after a failed move it shows the error, skips DELETE and reloads the lists', async () => {
    failPatch = 2;
    await show();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Acme' }));
    await tick();
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

  it('after a failed Move the select goes back to its placeholder', async () => {
    failPatch = 2;
    await show();
    const sel = within(rowOf('A2')).getByLabelText(/^Move /) as HTMLSelectElement;
    await fireEvent.change(sel, { target: { value: '8' } });
    await waitFor(() => expect(messages.current).toEqual({ text: 'patch failed', kind: 'err' }));
    await waitFor(() => expect(sel.value).toBe(''));
  });

  it('the Language column shows the language name, the code when unknown', async () => {
    await loadLanguageNames();
    corpora = [...corpora, { ...corpus(6, 'Odd', 7), lang: 'xx' }];
    corpusStore.list = [...corpora];
    await show();
    expect(within(rowOf('A1')).getByText('Spanish')).toBeInTheDocument();
    expect(within(rowOf('Odd')).getByText('xx')).toBeInTheDocument();
  });

  it('starting a corpus rename focuses the field', async () => {
    await show();
    await fireEvent.click(within(rowOf('A2')).getByRole('button', { name: 'Rename A2' }));
    await tick();
    expect(screen.getByLabelText('Name of project A2')).toHaveFocus();
  });

  it.each([
    ['empty project', 9, 'Empty'],
    ['project with corpora', 7, 'Acme'],
  ])('warns about permanent termbase loss for a %s with terms', async (_n, id, name) => {
    projects = projects.map((p) => (p.id === id ? { ...p, terms: 5 } : p));
    await show();
    await fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + name) }));
    await fireEvent.click(screen.getByRole('button', { name: `Delete ${name}` }));
    await tick();
    const dlg = screen.getByRole('dialog', { name: 'Delete this project?' });
    expect(dlg).toHaveTextContent(`Deleting ${name} also permanently deletes its 5 termbase entries.`);
  });

  it('shows no termbase warning when the project has no terms', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Acme' }));
    await tick();
    expect(screen.getByRole('dialog', { name: 'Delete this project?' })).not.toHaveTextContent('termbase entries');
  });
});

describe('Projects screen stacked below 900px', () => {
  beforeEach(() => __setViewportForTests({ stacked: true }));

  it('shows only the selected project with a Change button', async () => {
    await show();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Acme/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Bolt/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Empty/ })).toBeNull();
    expect(rows()).toHaveLength(2);
  });

  it('Change reveals the list; choosing a project selects it and collapses the list', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('button', { name: /^Bolt/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Empty/ })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^Bolt/ }));
    await tick();
    expect(screen.queryByRole('button', { name: /^Acme/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Empty/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Bolt/ })).toBeInTheDocument();
    expect(screen.getByText('B1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
  });

  it('Change is a toggle: aria-expanded, stays mounted, closes the list without picking', async () => {
    await show();
    const change = screen.getByRole('button', { name: 'Change' });
    expect(change).toHaveAttribute('aria-expanded', 'false');
    expect(change).toHaveAttribute('aria-controls', 'proj-list');
    await fireEvent.click(change);
    expect(screen.getByRole('button', { name: 'Change' })).toBe(change);
    expect(change).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Bolt/ })).toBeInTheDocument();
    await fireEvent.click(change);
    expect(change).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /^Bolt/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Acme/ })).toBeInTheDocument();
  });

  it('returns focus to Change after choosing a project', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await fireEvent.click(screen.getByRole('button', { name: /^Bolt/ }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change' })));
  });

  it('keeps the chosen project and its corpora when stacked is toggled', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: 'Change' }));
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
    expect(screen.getByRole('button', { name: /^Bolt/ })).toBeInTheDocument();
  });

  it('New corpus and New project still work', async () => {
    await show();
    await fireEvent.click(screen.getByRole('button', { name: 'New corpus' }));
    await tick();
    const dlg = screen.getByRole('dialog', { name: 'New corpus' });
    expect(within(dlg).getByLabelText('Project')).toHaveValue('7');
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await fireEvent.input(screen.getByLabelText('New project'), { target: { value: 'Zed' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/projects')).toBe(true));
  });

  it('wide layout has no Change button', async () => {
    __setViewportForTests({ stacked: false });
    await show();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Bolt/ })).toBeInTheDocument();
  });

  it('Change is translated', async () => {
    setLang('es');
    await show();
    expect(screen.getByRole('button', { name: 'Cambiar' })).toBeInTheDocument();
    setLang('it');
    await tick();
    expect(screen.getByRole('button', { name: 'Cambia' })).toBeInTheDocument();
  });
});

describe('Projects screen corpora as cards below 640px', () => {
  beforeEach(() => __setViewportForTests({ narrow: true }));
  afterEach(() => __setViewportForTests({ narrow: false }));

  const cards = () => screen.getAllByRole('listitem').filter((li) => li.classList.contains('ccard'));
  const cardOf = (name: string) => cards().find((c) => within(c).queryByText(name))!;
  const more = (name: string) => within(cardOf(name)).getByRole('button', { name: /^More actions/ });
  const openMenu = async (name: string) => {
    await fireEvent.click(more(name));
    await tick();
    return screen.getByRole('menu');
  };

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
    expect(within(cardOf('A1')).getByText('Working')).toBeInTheDocument();
    expect(within(cardOf('A1')).queryByRole('button', { name: /^Open/ })).toBeNull();
    await fireEvent.click(within(cardOf('A2')).getByRole('button', { name: /^Open/ }));
    await waitFor(() => expect(corpusStore.currentId).toBe(2));
    expect(within(cardOf('A2')).getByText('Working')).toBeInTheDocument();
  });

  it('the ⋯ button opens a menu: Rename, a Move item per other project, Delete', async () => {
    await show();
    const btn = more('A2');
    expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    const menu = await openMenu('A2');
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    const items = within(menu).getAllByRole('menuitem').map((i) => i.textContent?.trim());
    expect(items).toEqual(['Rename', 'Move: Bolt', 'Move: Empty', 'Delete']);
  });

  it('Rename swaps the card to the input; Enter saves, Escape cancels', async () => {
    await show();
    const menu = await openMenu('A2');
    await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
    await tick();
    const input = screen.getByLabelText('Name of project A2');
    expect(input).toHaveFocus();
    await fireEvent.keyDown(input, { key: 'Escape' });
    await tick();
    expect(screen.queryByLabelText('Name of project A2')).toBeNull();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);

    const menu2 = await openMenu('A2');
    await fireEvent.click(within(menu2).getByRole('menuitem', { name: 'Rename' }));
    await tick();
    const input2 = screen.getByLabelText('Name of project A2');
    await fireEvent.input(input2, { target: { value: 'A2 new' } });
    await fireEvent.keyDown(input2, { key: 'Enter' });
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.path === '/api/corpora/2')?.body).toEqual({ name: 'A2 new' }));
  });

  it('while renaming the menu offers Save', async () => {
    await show();
    let menu = await openMenu('A2');
    await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
    await tick();
    await fireEvent.input(screen.getByLabelText('Name of project A2'), { target: { value: 'Zed' } });
    // the name is an input now: reach the card through it
    await fireEvent.click(within(screen.getByLabelText('Name of project A2').closest('li')!).getByRole('button', { name: /^More actions/ }));
    await tick();
    menu = screen.getByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Rename' })).toBeNull();
    await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.path === '/api/corpora/2')?.body).toEqual({ name: 'Zed' }));
  });

  it('Move patches the corpus with the chosen project', async () => {
    await show();
    const menu = await openMenu('A2');
    await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move: Bolt' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.path === '/api/corpora/2')?.body).toEqual({ project_id: 8 }));
    await waitFor(() => expect(screen.queryByText('A2')).toBeNull());
  });

  it('Delete opens the confirmation; nothing is deleted before confirming', async () => {
    await show();
    const menu = await openMenu('A2');
    await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    await tick();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const dlg = screen.getByRole('dialog', { name: 'Delete corpus' });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/corpora/2')).toBe(true));
  });

  it('Delete then Cancel returns focus to the ⋯ trigger', async () => {
    await show();
    const btn = more('A2');
    const menu = await openMenu('A2');
    await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    await tick();
    const dlg = screen.getByRole('dialog', { name: 'Delete corpus' });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(btn));
  });

  it('keyboard: Enter opens on the first item, arrows move, Escape closes and refocuses ⋯', async () => {
    await show();
    const btn = more('A2');
    btn.focus();
    await fireEvent.click(btn); // Enter and Space on a button arrive as click
    await tick();
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    await fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    await fireEvent.keyDown(items[1], { key: 'ArrowUp' });
    expect(items[0]).toHaveFocus();
    await fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    expect(items[items.length - 1]).toHaveFocus();
    await fireEvent.keyDown(items[items.length - 1], { key: 'ArrowDown' });
    expect(items[0]).toHaveFocus();
    await fireEvent.keyDown(items[0], { key: 'Escape' });
    await tick();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(btn).toHaveFocus();
    expect(btn).toHaveAttribute('aria-expanded', 'false');
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

  it('the trigger names its corpus and duplicate project names do not break the menu', async () => {
    projects = [...projects, { id: 10, name: 'Bolt', corpora: 0, trashed: 0, terms: 0 }];
    render(Projects);
    await waitFor(() => expect(projectStore.list).toHaveLength(4));
    await tick();
    expect(more('A2')).toHaveAccessibleName('More actions: A2');
    const menu = await openMenu('A2');
    expect(within(menu).getAllByRole('menuitem', { name: 'Move: Bolt' })).toHaveLength(2);
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

  it('crossing 640px keeps a rename in progress', async () => {
    await show();
    const menu = await openMenu('A2');
    await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
    await tick();
    await fireEvent.input(screen.getByLabelText('Name of project A2'), { target: { value: 'Draft' } });
    __setViewportForTests({ narrow: false });
    await tick();
    expect(document.querySelector('table')).not.toBeNull();
    expect(screen.getByLabelText('Name of project A2')).toHaveValue('Draft');
    __setViewportForTests({ narrow: true });
    await tick();
    expect(document.querySelector('table')).toBeNull();
    expect(screen.getByLabelText('Name of project A2')).toHaveValue('Draft');
  });

  it('the menu label is translated', async () => {
    setLang('es');
    await show();
    expect(within(cardOf('A2')).getByRole('button', { name: /^Más acciones/ })).toBeInTheDocument();
    setLang('it');
    await tick();
    expect(within(cardOf('A2')).getByRole('button', { name: /^Altre azioni/ })).toBeInTheDocument();
  });
});
