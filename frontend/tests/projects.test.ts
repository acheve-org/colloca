import { describe, expect, it } from 'vitest';
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
