import { get } from './api';
import type { Corpus, Project } from './types';

/** Projects (clients). `loaded` tells "not fetched yet" from "no projects". */
export const projectStore = $state<{ list: Project[]; loaded: boolean; failed: boolean }>({
  list: [],
  loaded: false,
  failed: false,
});

let seq = 0;

/** Reloads the list (stale responses dropped). */
export async function reloadProjects(): Promise<void> {
  const n = ++seq;
  try {
    const list = await get<Project[]>('/api/projects');
    if (n !== seq) return;
    projectStore.list = list;
    projectStore.failed = false;
    projectStore.loaded = true;
  } catch (err) {
    if (n === seq) {
      projectStore.failed = true;
      projectStore.loaded = true;
    }
    throw err;
  }
}

/** The project a corpus belongs to (null when it has none or the list does not know it). */
export function projectOf(c: Corpus | null): Project | null {
  if (!c || c.project_id === null || c.project_id === undefined) return null;
  return projectStore.list.find((p) => p.id === c.project_id) ?? null;
}
