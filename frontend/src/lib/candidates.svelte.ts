import { post } from './api';
import { CORPUS_CHANGED, corpusStore } from './corpus.svelte';
import { t } from './i18n';
import { messages } from './messages.svelte';
import { openTerm, TERM_SAVED, termStore } from './term.svelte';

/** What the candidate tables get from the API for each row (all optional: older results lack them). */
export interface Flagged {
  item: string;
  in_termbase?: string;
  dropped?: boolean;
}

/** A term kept in the Candidates table ("send to candidates"). */
export interface Candidate {
  item: string;
  pos: string;
  /** Where it came from: keyness, frequency, ngram, collocation, job. */
  origin: string;
  /** The named measure ("log-likelihood", "frequency"...) and its value. */
  measure: string;
  score: number | null;
  freq: number | null;
  example: string;
  translation: string;
}

/** The comparison key of a term: lowercase, single spaces (as the stop list stores it). */
export const normTerm = (s: string): string => s.toLowerCase().split(/\s+/).filter(Boolean).join(' ');

/** Review switches shared by every candidate table. */
export const review = $state({ showDropped: false, onlyNew: false });

// What changed since the tables were loaded: the server's flags are kept, these take precedence.
const changes = $state<{ dropped: Record<string, boolean>; added: Record<string, boolean> }>({
  dropped: {},
  added: {},
});

if (typeof window !== 'undefined') {
  window.addEventListener(CORPUS_CHANGED, () => {
    changes.dropped = {};
    changes.added = {};
  });
  // A term saved from the dialog is in the termbase now: flag it in every list without a reload.
  window.addEventListener(TERM_SAVED, () => {
    const k = normTerm(termStore.draft.src_term);
    if (k) changes.added[k] = true;
  });
}

export const isDropped = (r: Flagged): boolean => changes.dropped[normTerm(r.item)] ?? r.dropped ?? false;
export const inTermbase = (r: Flagged): string =>
  r.in_termbase || (changes.added[normTerm(r.item)] ? 'candidate' : '');

/** The rows to show under the shared switches. */
export function visible<T extends Flagged>(rows: T[]): T[] {
  return rows.filter((r) => (review.showDropped || !isDropped(r)) && !(review.onlyNew && inTermbase(r)));
}

const say = (err: unknown) => messages.say(err instanceof Error ? err.message : String(err), 'err');

async function setDropped(items: string[], dropped: boolean): Promise<boolean> {
  const id = corpusStore.currentId;
  if (id === null || !items.length) return false;
  try {
    await post(`/api/corpora/${id}/rejections${dropped ? '' : '/restore'}`, { terms: items });
  } catch (err) {
    say(err);
    return false;
  }
  for (const i of items) changes.dropped[normTerm(i)] = dropped;
  window.dispatchEvent(new CustomEvent(STOPLIST_CHANGED));
  return true;
}
export const STOPLIST_CHANGED = 'stoplist-changed';
export const dropTerms = (items: string[]) => setDropped(items, true);
export const restoreTerms = (items: string[]) => setDropped(items, false);

// ------------------------------------------------------------------ the Candidates table (kept in the browser)
const storageKey = (): string => {
  const c = corpusStore.current;
  return c ? `colloca.candidates.${c.project_id ?? 'none'}.${c.lang}` : '';
};

function load(): Candidate[] {
  try {
    const raw = storageKey() ? localStorage.getItem(storageKey()) : null;
    return raw ? (JSON.parse(raw) as Candidate[]) : [];
  } catch {
    return [];
  }
}

export const basket = $state<{ key: string; items: Candidate[] }>({ key: '', items: [] });

/** Loads the basket of the current project and language (call when the corpus changes). */
export function syncBasket(): void {
  if (basket.key === storageKey()) return;
  basket.key = storageKey();
  basket.items = load();
}

function persist(): void {
  try {
    if (basket.key) localStorage.setItem(basket.key, JSON.stringify(basket.items));
  } catch {
    // storage unavailable or full: the table still works for this visit
  }
}

export function sendToCandidates(entries: Omit<Candidate, 'translation'>[]): number {
  syncBasket();
  const have: Record<string, true> = Object.fromEntries(basket.items.map((c) => [normTerm(c.item), true]));
  let added = 0;
  for (const e of entries) {
    if (have[normTerm(e.item)]) continue;
    have[normTerm(e.item)] = true;
    basket.items.push({ ...e, translation: '' });
    added++;
  }
  persist();
  messages.say(t(added ? 'cand.sent' : 'cand.already', { n: added }), added ? 'ok' : undefined);
  return added;
}

export function removeCandidates(items: string[]): void {
  const gone = items.map(normTerm);
  basket.items = basket.items.filter((c) => !gone.includes(normTerm(c.item)));
  persist();
}

export function setTranslation(item: string, translation: string): void {
  const c = basket.items.find((x) => normTerm(x.item) === normTerm(item));
  if (c) {
    c.translation = translation;
    persist();
  }
}

/** Accept: saved directly when a translation was typed, otherwise the add-term dialog opens prefilled. */
export async function accept(c: Candidate): Promise<boolean> {
  const cur = corpusStore.current;
  if (!cur) return false;
  const tr = c.translation.trim();
  if (!tr) {
    openTerm({ source: c.item, pos: c.pos, origin: c.origin === 'ngram' ? 'ngram' : c.origin, example: c.example });
    return false;
  }
  try {
    await post('/api/terms', {
      project_id: cur.project_id, src_lang: cur.lang, src_term: c.item, tgt_term: tr, pos: c.pos,
      status: 'approved', origin: c.origin, context: c.example,
    });
  } catch (err) {
    say(err);
    return false;
  }
  changes.added[normTerm(c.item)] = true;
  messages.say(t('term.saved'), 'ok');
  return true;
}

/** `in_termbase` / `dropped` of the basket's terms as of now. */
export async function flagsFor(items: string[]): Promise<Flagged[]> {
  const id = corpusStore.currentId;
  if (id === null || !items.length) return [];
  try {
    return await post<Flagged[]>(`/api/corpora/${id}/term-status`, { terms: items });
  } catch (err) {
    say(err);
    return [];
  }
}
