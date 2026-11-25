import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CorpusPicker from '../src/lib/ui/CorpusPicker.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { projectStore } from '../src/lib/projects.svelte';
import { loadLanguageNames } from '../src/lib/context.svelte';

const corpus = (id: number, name: string, project_id: number | null, is_reference = 0) => ({
  id, name, lang: 'es', project_id, is_reference, docs: 1, tokens: 1,
});

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => ({
    ok: true, status: 200, statusText: 'OK',
    json: async () => (String(u).includes('/parallel') ? { documents: 0, segments: 0, partners: [] } : { es: 'Spanish' }),
  })));
  await loadLanguageNames();
  projectStore.list = [
    { id: 7, name: 'Acme', corpora: 2, trashed: 0, terms: 0 },
    { id: 8, name: 'Bolt', corpora: 1, trashed: 0, terms: 0 },
  ];
  corpusStore.list = [
    corpus(1, 'A1', 7), corpus(2, 'A2', 7), corpus(3, 'B1', 8), corpus(4, 'Loose', null), corpus(5, 'RefCorpus', null, 1),
  ];
  corpusStore.currentId = 1;
  corpusStore.aligned = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.currentId = null;
  corpusStore.aligned = false;
});

const trigger = () => screen.getByRole('button', { expanded: false });
const open = async () => {
  await fireEvent.click(trigger());
  return screen.getByRole('menu');
};

describe('CorpusPicker', () => {
  it('shows the corpus name, language code and its project', () => {
    render(CorpusPicker);
    const group = screen.getByRole('group', { name: 'Working in' });
    const btn = within(group).getByRole('button');
    expect(btn).toHaveTextContent('A1');
    expect(btn).toHaveTextContent('ES');
    expect(within(group).getByText('Acme')).toBeInTheDocument();
  });

  it('lists corpora grouped by project, without base corpora', async () => {
    render(CorpusPicker);
    const menu = await open();
    for (const h of ['Acme', 'Bolt', 'No project']) expect(within(menu).getByText(h, { selector: '.heading' })).toBeInTheDocument();
    for (const n of ['A1', 'A2', 'B1', 'Loose']) expect(within(menu).getByRole('menuitem', { name: new RegExp(n) })).toBeInTheDocument();
    expect(within(menu).queryByText('RefCorpus')).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /A1/ })).toHaveAttribute('aria-current', 'true');
    expect(within(menu).getByRole('menuitem', { name: /A2/ })).not.toHaveAttribute('aria-current');
  });

  it('choosing a corpus selects it and closes the menu', async () => {
    render(CorpusPicker);
    const menu = await open();
    await fireEvent.click(within(menu).getByRole('menuitem', { name: /B1/ }));
    await tick();
    expect(corpusStore.currentId).toBe(3);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Manage projects goes to Projects', async () => {
    render(CorpusPicker);
    const menu = await open();
    expect(within(menu).getByRole('link', { name: 'Manage projects…' })).toHaveAttribute('href', '#/projects');
  });

  it('shows an aligned badge only when the current corpus is aligned', async () => {
    corpusStore.aligned = true;
    render(CorpusPicker);
    expect(within(trigger()).getByText('aligned')).toBeInTheDocument();
    const menu = await open();
    expect(within(menu).queryByText('aligned')).toBeNull();
  });

  it('shows the empty state once the working corpus is gone', async () => {
    render(CorpusPicker);
    await corpusStore.select(null);
    await tick();
    expect(screen.getByRole('button')).toHaveTextContent('No corpus selected');
    const menu = await open();
    expect(within(menu).getByRole('link', { name: 'Manage projects…' })).toBeInTheDocument();
  });

  it('long names do not grow the header', () => {
    const long = 'x'.repeat(120);
    corpusStore.list = [corpus(1, long, 7)];
    render(CorpusPicker);
    const name = within(trigger()).getByText(long);
    expect(name).toHaveAttribute('title', long);
    expect(name).toHaveClass('name');
  });

  it('Escape closes the menu and focuses the trigger', async () => {
    render(CorpusPicker);
    await open();
    await fireEvent.keyDown(document, { key: 'Escape' });
    await tick();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button')).toHaveFocus();
  });

  it('a click outside closes it', async () => {
    render(CorpusPicker);
    await open();
    await fireEvent.pointerDown(document.body);
    await tick();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
