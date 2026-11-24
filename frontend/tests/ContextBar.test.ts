import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContextBar from '../src/lib/ui/ContextBar.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { projectStore } from '../src/lib/projects.svelte';
import { loadLanguageNames } from '../src/lib/context.svelte';
import { go } from '../src/lib/router.svelte';

const corpus = (id: number, project_id: number | null) => ({
  id, name: `Corpus ${id}`, lang: 'es', project_id, is_reference: 0, docs: 1, tokens: 1,
});

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, statusText: 'OK', json: async () => ({ es: 'Spanish' }),
  })));
  await loadLanguageNames();
  projectStore.list = [{ id: 7, name: 'Acme', corpora: 1, trashed: 0 }];
  corpusStore.list = [corpus(1, 7), corpus(2, null)];
  corpusStore.currentId = 1;
  go('concordance');
});
afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.currentId = null;
  go('sources');
});

describe('ContextBar', () => {
  it('shows language, project and corpus in order, the first two as links', () => {
    render(ContextBar);
    const nav = screen.getByRole('navigation', { name: 'Working context' });
    expect(nav.textContent?.replace(/\s+/g, ' ').trim()).toBe('Spanish › Acme › Corpus 1');
    expect(screen.getByRole('link', { name: 'Spanish' })).toHaveAttribute('href', '#/languages');
    expect(screen.getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '#/projects');
    expect(screen.queryByRole('link', { name: 'Corpus 1' })).toBeNull();
    expect(screen.getByText('Corpus 1').tagName).toBe('STRONG');
  });

  it('says "No project" for a corpus without one', () => {
    corpusStore.currentId = 2;
    render(ContextBar);
    expect(screen.getByRole('link', { name: 'No project' })).toHaveAttribute('href', '#/projects');
  });

  it('says "No corpus selected" without a corpus', () => {
    corpusStore.currentId = null;
    render(ContextBar);
    expect(screen.getByText('No corpus selected')).toBeInTheDocument();
  });

  it.each(['projects', 'languages'] as const)('is absent on the %s screen', async (s) => {
    go(s);
    render(ContextBar);
    await tick();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
