import { get } from './api';
import { messages } from './messages.svelte';
import type { Corpus, ParallelInfo } from './types';

export const CORPUS_CHANGED = 'corpus-changed';

export interface Scope {
  tags: string;
  type: string;
  from: string;
  to: string;
  project: string;
}

const emptyScope = (): Scope => ({ tags: '', type: '', from: '', to: '', project: '' });

interface CorpusStore {
  list: Corpus[];
  currentId: number | null;
  readonly current: Corpus | null;
  aligned: boolean;
  scope: Scope;
  reload: () => Promise<void>;
  select: (id: number | null) => Promise<void>;
  clearScope: () => void;
}

export const corpusStore: CorpusStore = $state<CorpusStore>({
  list: [],
  currentId: null,
  get current(): Corpus | null {
    return corpusStore.list.find((c) => c.id === corpusStore.currentId) ?? null;
  },
  aligned: false,
  scope: emptyScope(),

  async reload() {
    // Intentionally fires no corpus-changed when the current corpus is kept: results stay valid.
    corpusStore.list = await get<Corpus[]>('/api/corpora');
    const keep = corpusStore.list.some((c) => c.id === corpusStore.currentId);
    const target = keep ? corpusStore.currentId : (corpusStore.list[0]?.id ?? null);
    if (target !== corpusStore.currentId) await corpusStore.select(target);
    else await loadAligned();
  },

  async select(id) {
    corpusStore.currentId = id;
    corpusStore.scope = emptyScope();
    corpusStore.aligned = false;
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id } }));
    try {
      await loadAligned();
    } catch (err) {
      if (corpusStore.currentId === id) {
        corpusStore.aligned = false;
        messages.say(err instanceof Error ? err.message : String(err), 'err');
      }
    }
  },

  clearScope() {
    corpusStore.scope = emptyScope();
  },
});

async function loadAligned(): Promise<void> {
  const id = corpusStore.currentId;
  if (id === null) {
    corpusStore.aligned = false;
    return;
  }
  const p = await get<ParallelInfo>(`/api/corpora/${id}/parallel`);
  if (corpusStore.currentId === id) corpusStore.aligned = p.documents > 0;
}

/** Query params the API expects for the active document filter (`project` is UI-only). */
export function scopeParams(): Record<string, string> {
  const s = corpusStore.scope;
  return { tags: s.tags, text_type: s.type, date_from: s.from, date_to: s.to };
}
