import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContextBlock from '../src/lib/ui/ContextBlock.svelte';
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
    { id: 7, name: 'Acme', corpora: 2, trashed: 0 },
    { id: 8, name: 'Bolt', corpora: 1, trashed: 0 },
  ];
  corpusStore.list = [
    corpus(1, 'A1', 7), corpus(2, 'A2', 7), corpus(3, 'B1', 8), corpus(4, 'Loose', null), corpus(5, 'RefCorpus', null, 1),
  ];
  corpusStore.currentId = 1;
});
afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.currentId = null;
});

describe('ContextBlock', () => {
  it('shows corpus, project, language badge and a Change link', () => {
    render(ContextBlock);
    expect(screen.getByText('Working in')).toBeInTheDocument();
    expect(screen.getByText('A1', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Acme', { selector: '.project' })).toBeInTheDocument();
    expect(screen.getByText('ES')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '#/projects');
  });

  it('quick switch groups working corpora by project and never lists reference corpora', () => {
    render(ContextBlock);
    const sel = screen.getByRole('combobox', { name: 'Corpus' });
    const groups = within(sel).getAllByRole('group').map((g) => g.getAttribute('label'));
    expect(groups).toEqual(['Acme', 'Bolt', 'No project']);
    expect(within(sel).queryByRole('option', { name: /RefCorpus/ })).toBeNull();
    expect(within(sel).getAllByRole('option')).toHaveLength(4);
  });

  it('omits the "No project" group when every corpus has a project', () => {
    corpusStore.list = [corpus(1, 'A1', 7)];
    render(ContextBlock);
    expect(within(screen.getByRole('combobox')).getAllByRole('group')).toHaveLength(1);
  });

  it('selecting a corpus calls corpusStore.select', async () => {
    const spy = vi.spyOn(corpusStore, 'select').mockResolvedValue();
    render(ContextBlock);
    await fireEvent.change(screen.getByRole('combobox', { name: 'Corpus' }), { target: { value: '3' } });
    expect(spy).toHaveBeenCalledWith(3);
    spy.mockRestore();
  });

  it('shows the empty state once the working corpus is gone', async () => {
    render(ContextBlock);
    await corpusStore.select(null);
    await tick();
    expect(screen.getByText('No corpus selected')).toBeInTheDocument();
    expect(screen.queryByText('A1', { selector: 'strong' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Change' })).toBeInTheDocument();
  });
});
