import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GateHost from './GateHost.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { projectStore } from '../src/lib/projects.svelte';
import { loadLanguageNames } from '../src/lib/context.svelte';
import { go, route } from '../src/lib/router.svelte';
import { setupStep, setupReady } from '../src/lib/setup.svelte';

const corpus = (id: number, is_reference = 0) => ({
  id, name: 'C' + id, lang: 'es', project_id: is_reference ? null : 7, is_reference, docs: 1, tokens: 1,
});

let languages: Record<string, string>;

async function setLanguages(l: Record<string, string>) {
  languages = l;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => languages })));
  await loadLanguageNames();
}

beforeEach(async () => {
  corpusStore.list = [];
  corpusStore.currentId = null;
  corpusStore.loaded = true;
  corpusStore.failed = false;
  projectStore.list = [];
  projectStore.loaded = true;
  projectStore.failed = false;
  await setLanguages({ es: 'Spanish' });
  go('concordance');
});

const link = (name: string) => screen.getByRole('link', { name });

describe('SetupGate', () => {
  it('no languages: asks for the first language, linking to Languages', async () => {
    await setLanguages({});
    render(GateHost);
    expect(screen.getByText('Add your first language')).toBeInTheDocument();
    expect(link('Add a language')).toHaveAttribute('href', '#/languages');
    expect(screen.queryByText('child')).toBeNull();
  });

  it('languages but no project: asks for the first project, linking to Projects', () => {
    render(GateHost);
    expect(screen.getByText('Start your first project')).toBeInTheDocument();
    expect(link('Go to Projects')).toHaveAttribute('href', '#/projects');
  });

  it('a project but no working corpus: asks for a corpus', () => {
    projectStore.list = [{ id: 7, name: 'Acme', corpora: 0, trashed: 0, terms: 0 }];
    render(GateHost);
    expect(screen.getByText('Create a corpus')).toBeInTheDocument();
    expect(link('Go to Projects')).toHaveAttribute('href', '#/projects');
  });

  it('only base corpora do not count as a working corpus', () => {
    projectStore.list = [{ id: 7, name: 'Acme', corpora: 0, trashed: 0, terms: 0 }];
    corpusStore.list = [corpus(1, 1)];
    corpusStore.currentId = 1;
    render(GateHost);
    expect(screen.getByText('Create a corpus')).toBeInTheDocument();
  });

  it('with a working corpus the children render unchanged', () => {
    projectStore.list = [{ id: 7, name: 'Acme', corpora: 1, trashed: 0, terms: 0 }];
    corpusStore.list = [corpus(1)];
    corpusStore.currentId = 1;
    render(GateHost);
    expect(screen.getByText('child')).toBeInTheDocument();
    expect(screen.queryByText('Create a corpus')).toBeNull();
  });

  it('renders nothing while a store is loading, then the gate once it has loaded', async () => {
    projectStore.loaded = false;
    const { container } = render(GateHost);
    expect(container.textContent).toBe('');
    projectStore.loaded = true;
    await tick();
    expect(screen.getByText('Start your first project')).toBeInTheDocument();
  });

  it('after the first settle a corpus switch (loaded false for a moment) keeps the screen mounted', async () => {
    projectStore.list = [{ id: 7, name: 'Acme', corpora: 1, trashed: 0, terms: 0 }];
    corpusStore.list = [corpus(1)];
    corpusStore.currentId = 1;
    render(GateHost);
    const node = screen.getByText('child');
    corpusStore.loaded = false;
    await tick();
    expect(screen.getByText('child')).toBe(node);
    corpusStore.loaded = true;
    await tick();
    expect(screen.getByText('child')).toBe(node);
  });

  it.each([
    ['corpora', () => { corpusStore.failed = true; }],
    ['projects', () => { projectStore.failed = true; }],
    ['languages', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, statusText: 'x', json: async () => ({}) })));
      await loadLanguageNames().catch(() => {});
    }],
  ])('a failed %s load shows the screen, not a first-run claim', async (_n, fail) => {
    await fail();
    expect(setupStep()).toBeNull();
    render(GateHost);
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it.each(['languages', 'projects', 'trash'] as const)('never gates %s', (id) => {
    go(id);
    render(GateHost);
    expect(screen.getByText('child')).toBeInTheDocument();
  });
});

describe('setupStep', () => {
  it('is the first unmet step, and null once a working corpus exists', async () => {
    await setLanguages({});
    expect(setupStep()).toBe('language');
    await setLanguages({ es: 'Spanish' });
    expect(setupStep()).toBe('project');
    projectStore.list = [{ id: 7, name: 'Acme', corpora: 0, trashed: 0, terms: 0 }];
    expect(setupStep()).toBe('corpus');
    corpusStore.list = [corpus(1)];
    corpusStore.currentId = 1;
    expect(setupStep()).toBeNull();
  });

  it('is not ready until all three stores have loaded', () => {
    expect(setupReady()).toBe(true);
    projectStore.loaded = false;
    expect(setupReady()).toBe(false);
  });
});

describe('initial redirect', () => {
  it('goes to the first unfinished step once, only from an empty hash, and not again after', async () => {
    const { redirectOnce } = await import('../src/lib/setup.svelte');
    location.hash = '';
    const run = redirectOnce();
    expect(run()).toBe(true);
    expect(route.screen).toBe('projects');
    go('concordance');
    expect(run()).toBe(false);
    expect(route.screen).toBe('concordance');
  });

  it('does not redirect a deep link, and sends no-language setups to languages', async () => {
    const { redirectOnce } = await import('../src/lib/setup.svelte');
    go('keyness');
    expect(redirectOnce()()).toBe(false);
    expect(route.screen).toBe('keyness');
    await setLanguages({});
    location.hash = '';
    redirectOnce()();
    expect(route.screen).toBe('languages');
  });

  it('does not redirect when a load failed', async () => {
    const { redirectOnce } = await import('../src/lib/setup.svelte');
    projectStore.failed = true;
    location.hash = '';
    expect(redirectOnce()()).toBe(false);
    expect(route.screen).not.toBe('projects');
  });

  it('waits while the stores are loading', async () => {
    const { redirectOnce } = await import('../src/lib/setup.svelte');
    projectStore.loaded = false;
    location.hash = '';
    const run = redirectOnce();
    expect(run()).toBe(false);
    projectStore.loaded = true;
    expect(run()).toBe(true);
  });
});
