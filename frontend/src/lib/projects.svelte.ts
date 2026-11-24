import { get } from './api';
import type { Corpus, Project } from './types';

/** Projects (clients). */
export const projectStore = $state<{ list: Project[] }>({ list: [] });

let seq = 0;

/** Reloads the list (stale responses dropped). */
export async function reloadProjects(): Promise<void> {
  const n = ++seq;
  const list = await get<Project[]>('/api/projects');
  if (n !== seq) return;
  projectStore.list = list;
}

/** The project a corpus belongs to (null when it has none or the list does not know it). */
export function projectOf(c: Corpus | null): Project | null {
  if (!c || c.project_id === null || c.project_id === undefined) return null;
  return projectStore.list.find((p) => p.id === c.project_id) ?? null;
}
