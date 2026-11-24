import { describe, expect, it, vi } from 'vitest';
import { projectOf, projectStore } from '../src/lib/projects.svelte';
import type { Corpus } from '../src/lib/types';

const corpus = (project_id: number | null): Corpus => ({
  id: 1, name: 'c', lang: 'es', project_id, is_reference: 0, docs: 0, tokens: 0,
});

describe('projectOf', () => {
  it('finds the corpus project, or null', () => {
    projectStore.list = [{ id: 7, name: 'Acme', corpora: 1, trashed: 0 }];
    expect(projectOf(corpus(7))?.name).toBe('Acme');
    expect(projectOf(corpus(null))).toBeNull();
    expect(projectOf(corpus(99))).toBeNull();
    expect(projectOf(null)).toBeNull();
  });
});

describe('projectStore load flags', () => {
  it('marks loaded, and failed on error (loaded too, so nothing waits forever)', async () => {
    const { projectStore, reloadProjects } = await import('../src/lib/projects.svelte');
    projectStore.loaded = false;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, statusText: 'x', json: async () => ({ detail: 'boom' }) })));
    await expect(reloadProjects()).rejects.toThrow();
    expect(projectStore.failed).toBe(true);
    expect(projectStore.loaded).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => [] })));
    await reloadProjects();
    expect(projectStore.failed).toBe(false);
    vi.unstubAllGlobals();
  });
});
