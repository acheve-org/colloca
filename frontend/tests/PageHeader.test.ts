import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PageHeader from '../src/lib/ui/PageHeader.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { go } from '../src/lib/router.svelte';
import { setLang } from '../src/lib/i18n';

beforeEach(() => {
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
  screen.getAllByRole('link').map((a) => a.textContent?.trim());

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

  it('hides the picker on Projects and Languages and keeps Settings tab order', async () => {
    go('projects');
    render(PageHeader);
    await tick();
    expect(screen.queryByRole('group', { name: 'Working in' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(tabNames()).toEqual(['Languages', 'Projects', 'Backup and Trash']);
    go('languages');
    await tick();
    expect(screen.getByRole('heading', { level: 1, name: 'Languages' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Working in' })).toBeNull();
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
});
