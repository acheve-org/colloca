import { render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PageHeader from '../src/lib/ui/PageHeader.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { go } from '../src/lib/router.svelte';
import { setLang } from '../src/lib/i18n';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () =>
      url.includes('/facets')
        ? { tags: [], text_types: [], date_min: '', date_max: '' }
        : url.includes('/scope')
          ? { filtered: false, docs: 2, total_docs: 2, words: 10, total_words: 10 }
          : [],
  })));
  corpusStore.currentId = 1;
  corpusStore.clearScope();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.aligned = false;
  setLang('en');
  go('sources');
});

const tabNames = () =>
  within(screen.getByRole('group', { name: 'Section screens' })).getAllByRole('link').map((a) => a.textContent?.trim());

describe('PageHeader', () => {
  it('shows picker, title and tabs on Concordance', async () => {
    go('concordance');
    render(PageHeader);
    await tick();
    expect(screen.getByRole('group', { name: 'Working in' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Concordance' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Section screens' })).toBeInTheDocument();
  });

  it('keeps the context header on Projects and Languages and Settings tab order', async () => {
    go('projects');
    render(PageHeader);
    await tick();
    expect(screen.getByRole('group', { name: 'Working in' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(tabNames()).toEqual(['Languages', 'Projects', 'Backup and Trash']);
    go('languages');
    await tick();
    expect(screen.getByRole('heading', { level: 1, name: 'Languages' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Working in' })).toBeInTheDocument();
  });

  it('has a title and no tab strip on single-screen areas', async () => {
    go('sources');
    render(PageHeader);
    await tick();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('group', { name: 'Section screens' })).toBeNull();
    go('job');
    await tick();
    expect(screen.getByRole('heading', { level: 1, name: 'Job' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Section screens' })).toBeNull();
  });

  it('adds the aligned tabs for an aligned corpus', async () => {
    corpusStore.aligned = true;
    go('concordance');
    render(PageHeader);
    await tick();
    expect(screen.getByRole('link', { name: 'Equivalents' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Segment lookup' })).toBeInTheDocument();
  });

  it('follows the interface language', async () => {
    go('concordance');
    render(PageHeader);
    setLang('es');
    await tick();
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe('Concordance');
  });

  it('shows a back link and no tabs on the Add documents page', async () => {
    go('sources-add');
    render(PageHeader);
    await tick();
    expect(screen.getByRole('heading', { level: 1, name: 'Add documents' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Documents/ })).toHaveAttribute('href', '#/sources');
    expect(screen.queryByRole('group', { name: 'Section screens' })).not.toBeInTheDocument();
  });

  it('has no back link on Sources', async () => {
    go('sources');
    render(PageHeader);
    await tick();
    expect(screen.queryByRole('link', { name: /Documents/ })).not.toBeInTheDocument();
  });

  describe('scope control', () => {
    const pill = () => screen.queryByRole('button', { name: /All documents|of .* documents/ });

    it.each(['concordance', 'frequency', 'job'] as const)('shows the pill beside the picker on %s', async (id) => {
      go(id);
      render(PageHeader);
      await tick();
      expect(pill()).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Working in' })).toBeInTheDocument();
    });

    it.each(['sources', 'termbase', 'languages', 'sources-add'] as const)('has no pill on %s', async (id) => {
      go(id);
      render(PageHeader);
      await tick();
      expect(pill()).toBeNull();
    });

    it('has no pill without a corpus', async () => {
      corpusStore.currentId = null;
      go('concordance');
      render(PageHeader);
      await tick();
      expect(pill()).toBeNull();
    });

    it('keeps the scope when moving between screens', async () => {
      corpusStore.scope.tags = 'wind';
      go('concordance');
      render(PageHeader);
      await tick();
      expect(screen.getByText('Tags: wind')).toBeInTheDocument();
      go('keyness');
      await tick();
      expect(screen.getByText('Tags: wind')).toBeInTheDocument();
    });
  });
});
