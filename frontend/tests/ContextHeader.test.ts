import { render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContextHeader from '../src/lib/ui/ContextHeader.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { projectStore } from '../src/lib/projects.svelte';
import { loadLanguageNames } from '../src/lib/context.svelte';
import { go } from '../src/lib/router.svelte';

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
  go('sources');
});
afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.currentId = null;
  corpusStore.aligned = false;
  go('sources');
});

const gear = () => screen.getByRole('link', { name: 'Change corpus or project' });

describe('ContextHeader', () => {
  it('shows the corpus name, language code and its project', () => {
    render(ContextHeader);
    const group = screen.getByRole('group', { name: 'Working in' });
    expect(group).toHaveTextContent('A1');
    expect(group).toHaveTextContent('ES');
    expect(within(group).getByText('Acme')).toBeInTheDocument();
  });

  it('has no dropdown', () => {
    render(ContextHeader);
    expect(document.querySelector('button[aria-expanded]')).toBeNull();
  });

  it('the gear goes to Projects', () => {
    render(ContextHeader);
    expect(gear()).toHaveAttribute('href', '#/projects');
    expect(gear()).not.toHaveAttribute('aria-current');
  });

  it('the gear is the current page on Projects', async () => {
    render(ContextHeader);
    go('projects');
    await tick();
    expect(gear()).toHaveAttribute('aria-current', 'page');
  });

  it('shows an aligned badge only when the corpus is aligned', async () => {
    render(ContextHeader);
    expect(screen.queryByText(/^aligned$/i)).toBeNull();
    corpusStore.aligned = true;
    await tick();
    expect(screen.getByText(/^aligned$/i)).toBeInTheDocument();
  });

  it('names a corpus without a project', () => {
    corpusStore.currentId = 4;
    render(ContextHeader);
    expect(screen.getByText('No project')).toBeInTheDocument();
    expect(screen.getByText('Loose')).toBeInTheDocument();
  });

  it('offers to choose a corpus when none is selected', () => {
    corpusStore.currentId = null;
    render(ContextHeader);
    expect(screen.getByText('No corpus selected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose a corpus' })).toHaveAttribute('href', '#/projects');
    expect(screen.queryByRole('link', { name: 'Change corpus or project' })).toBeNull();
  });

  it('renders its children', () => {
    const children = createRawSnippet(() => ({ render: () => '<span>scope here</span>' }));
    render(ContextHeader, { props: { children } });
    expect(screen.getByText('scope here')).toBeInTheDocument();
  });

  it('long names keep their full text in a title', () => {
    const long = 'x'.repeat(120);
    corpusStore.list = [corpus(1, long, 7)];
    render(ContextHeader);
    expect(screen.getByText(long)).toHaveAttribute('title', long);
  });
});
