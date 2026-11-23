import { get } from './api';
import type { Corpus, Project } from './types';

/**
 * Projects (clients) and the corpus-switcher filter: '' all projects, 'none' corpora without
 * a project, or a project id. Like the old header, the filter is not persisted.
 */
export const projectStore = $state<{ list: Project[]; filter: string }>({ list: [], filter: '' });

let seq = 0;

/** Reloads the list (stale responses dropped); a filter on a project that is gone is cleared. */
export async function reloadProjects(): Promise<void> {
  const n = ++seq;
  const list = await get<Project[]>('/api/projects');
  if (n !== seq) return;
  projectStore.list = list;
  const f = projectStore.filter;
  if (/^\d+$/.test(f) && !list.some((p) => String(p.id) === f)) projectStore.filter = '';
}

export function inProject(c: Corpus, filter = projectStore.filter): boolean {
  if (filter === '') return true;
  if (filter === 'none') return c.project_id === null || c.project_id === undefined;
  return String(c.project_id) === filter;
}
