import { get } from './api';
import { CORPUS_CHANGED, corpusStore, scopeParams } from './corpus.svelte';
import { fmt, t } from './i18n';
import type { Facets, ScopeInfo } from './types';

export type ScopePart = 'tags' | 'type' | 'dates';

const emptyFacets = (): Facets => ({ tags: [], text_types: [], date_min: '', date_max: '' });

/** What the document filter has learned from the server: suggestions, the match summary, a failure. */
export const scopeView = $state<{ facets: Facets; info: ScopeInfo | null; error: string }>({
  facets: emptyFacets(),
  info: null,
  error: '',
});

let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

/** True when any part of the filter is set (right even before the summary arrives) or the server says so. */
export function scopeActive(): boolean {
  const s = corpusStore.scope;
  return !!(s.tags.trim() || s.type.trim() || s.from.trim() || s.to.trim() || scopeView.info?.filtered);
}

/** One chip per part of the filter that is set. */
export function scopeChips(): { key: ScopePart; text: string }[] {
  const s = corpusStore.scope;
  const chips: { key: ScopePart; text: string }[] = [];
  const tags = s.tags.trim();
  const type = s.type.trim();
  const from = s.from.trim();
  const to = s.to.trim();
  if (tags) chips.push({ key: 'tags', text: `Tags: ${tags}` });
  if (type) chips.push({ key: 'type', text: `Type: ${type}` });
  if (from || to) chips.push({ key: 'dates', text: `${from || '…'}–${to || '…'}` });
  return chips;
}

export function scopeSummary(): string {
  const { error, info } = scopeView;
  if (error) return error;
  if (!info) return '';
  if (!info.filtered) return t('scope.all');
  return t('filter.summary', {
    docs: info.docs,
    total: info.total_docs,
    words: fmt(info.words),
    totalWords: fmt(info.total_words),
  });
}

export async function refreshScope(): Promise<void> {
  const id = corpusStore.currentId;
  if (id === null) return;
  const n = ++seq;
  try {
    const r = await get<ScopeInfo>(`/api/corpora/${id}/scope`, scopeParams());
    if (n !== seq) return;
    scopeView.info = r;
    scopeView.error = '';
  } catch (err) {
    if (n !== seq) return;
    scopeView.info = null;
    scopeView.error = err instanceof Error ? err.message : String(err);
  }
}

export function refreshScopeSoon(): void {
  clearTimeout(timer);
  timer = setTimeout(refreshScope, 350);
}

export async function loadScope(): Promise<void> {
  const id = corpusStore.currentId;
  if (id === null) return;
  try {
    const f = await get<Facets>(`/api/corpora/${id}/facets`);
    if (corpusStore.currentId !== id) return;
    scopeView.facets = f;
  } catch {
    // the summary line reports errors; facets only feed suggestions
  }
  await refreshScope();
}

export function clearScopePart(key: ScopePart): void {
  const s = corpusStore.scope;
  if (key === 'tags') s.tags = '';
  else if (key === 'type') s.type = '';
  else {
    s.from = '';
    s.to = '';
  }
  void refreshScope();
}

export function clearScope(): void {
  corpusStore.clearScope();
  void refreshScope();
}

/** Keep the view in step with the corpus: load now, reset and reload when it changes. Returns the stop function. */
export function startScope(): () => void {
  const onChange = () => {
    seq++; // a reply still in flight for the previous corpus must not land
    scopeView.facets = emptyFacets();
    scopeView.info = null;
    scopeView.error = '';
    void loadScope();
  };
  window.addEventListener(CORPUS_CHANGED, onChange);
  void loadScope();
  return () => {
    window.removeEventListener(CORPUS_CHANGED, onChange);
    clearTimeout(timer);
  };
}
