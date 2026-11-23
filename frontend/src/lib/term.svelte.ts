import { get, post } from './api';
import { corpusStore, scopeParams } from './corpus.svelte';
import { t } from './i18n';
import { messages } from './messages.svelte';
import type { Example, Languages } from './types';

export interface TermDraft {
  src_term: string;
  tgt_term: string;
  status: 'candidate' | 'approved' | 'forbidden';
  pos: string;
  domain: string;
  definition: string;
  notes: string;
  context: string;
  context_source: string;
}

export interface TermContext {
  project_id: number | null;
  src_lang: string;
  tgt_lang: string;
  origin: string;
}

export interface OpenTermArgs {
  source: string;
  /** spaCy UPOS (NOUN, VERB...) or a termbase POS value. */
  pos?: string;
  origin?: string;
  target?: string;
  example?: string;
  exampleSource?: string;
}

/** UPOS tag -> termbase part of speech (as the old UI). */
const POS_MAP: Record<string, string> = {
  NOUN: 'noun', VERB: 'verb', AUX: 'verb', ADJ: 'adjective', ADV: 'adverb', PROPN: 'properNoun',
};
export const TERM_POS = ['noun', 'verb', 'adjective', 'adverb', 'properNoun', 'other'];

const blank = (): TermDraft => ({
  src_term: '', tgt_term: '', status: 'candidate', pos: '', domain: '', definition: '', notes: '',
  context: '', context_source: '',
});

let languages: Languages | null = null;

async function loadLanguages(): Promise<Languages> {
  languages ??= await get<Languages>('/api/languages');
  return languages;
}

export const termStore = $state<{
  open: boolean;
  draft: TermDraft;
  ctx: TermContext | null;
  langs: Languages;
  examples: Example[];
  examplesFor: string;
  saving: boolean;
}>({
  open: false,
  draft: blank(),
  ctx: null,
  langs: {},
  examples: [],
  examplesFor: '',
  saving: false,
});

/** Opens the Add term dialog for the current corpus, prefilled from `args`. */
export function openTerm(args: OpenTermArgs): void {
  const c = corpusStore.current;
  if (!c) {
    messages.say(t('corpus.selectFirst'), 'err');
    return;
  }
  const pos = args.pos ? (POS_MAP[args.pos] ?? (TERM_POS.includes(args.pos) ? args.pos : '')) : '';
  termStore.draft = {
    ...blank(),
    src_term: args.source,
    tgt_term: args.target ?? '',
    pos,
    context: args.example ?? '',
    context_source: args.example ? (args.exampleSource ?? '') : '',
  };
  termStore.ctx = { project_id: c.project_id, src_lang: c.lang, tgt_lang: '', origin: args.origin ?? 'manual' };
  termStore.examples = [];
  termStore.examplesFor = '';
  termStore.open = true;
  const ctx = termStore.ctx;
  loadLanguages()
    .then((l) => {
      termStore.langs = l;
      // The target language is the other supported one (as the old UI).
      ctx.tgt_lang = Object.keys(l).find((k) => k !== ctx.src_lang) ?? '';
    })
    .catch((err) => messages.say(err instanceof Error ? err.message : String(err), 'err'));
  findExamples(true);
}

/** Whole sentences with the source term, as example candidates. `quiet` swallows errors. */
export async function findExamples(quiet = false): Promise<void> {
  const q = termStore.draft.src_term.trim();
  const id = corpusStore.currentId;
  if (!q || id === null) return;
  try {
    const ex = await get<Example[]>(`/api/corpora/${id}/examples`, {
      q, unit: q.includes(' ') ? 'form' : 'lemma', limit: 5, ...scopeParams(),
    });
    if (termStore.draft.src_term.trim() !== q) return; // the user kept typing
    termStore.examples = ex ?? [];
    termStore.examplesFor = quiet && !termStore.examples.length ? '' : q;
  } catch (err) {
    if (!quiet) messages.say(err instanceof Error ? err.message : String(err), 'err');
  }
}

export function useExample(x: Example): void {
  termStore.draft.context = x.sentence;
  termStore.draft.context_source = x.doc;
}

/** POSTs the draft; returns true on success (the dialog then closes). */
export async function saveTerm(): Promise<boolean> {
  const ctx = termStore.ctx;
  if (!ctx || termStore.saving) return false;
  const d = termStore.draft;
  termStore.saving = true;
  try {
    await post('/api/terms', {
      ...d,
      context_source: d.context.trim() ? d.context_source : '',
      project_id: ctx.project_id,
      src_lang: ctx.src_lang,
      tgt_lang: ctx.tgt_lang,
      origin: ctx.origin,
    });
    messages.say(t('term.saved'), 'ok');
    termStore.open = false;
    return true;
  } catch (err) {
    messages.say(err instanceof Error ? err.message : String(err), 'err');
    return false;
  } finally {
    termStore.saving = false;
  }
}
