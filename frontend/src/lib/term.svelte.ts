import { get, patch, post } from './api';
import { corpusStore, scopeParams } from './corpus.svelte';
import { t } from './i18n';
import { messages } from './messages.svelte';
import type { Example, Languages } from './types';

export interface TermDraft {
  src_term: string;
  tgt_term: string;
  status: 'candidate' | 'approved' | 'admitted' | 'superseded' | 'forbidden';
  pos: string;
  domain: string;
  definition: string;
  notes: string;
  context: string;
  context_source: string;
  src_gender: string;
  src_number: string;
  src_note: string;
  tgt_gender: string;
  tgt_number: string;
  tgt_note: string;
}

export interface TermContext {
  project_id: number | null;
  src_lang: string;
  tgt_lang: string;
  origin: string;
  /** Adding a synonym: the concept the new row joins. */
  concept_id?: number;
}

export interface OpenTermArgs {
  /** Set to edit an existing termbase entry (saved with PATCH); no corpus is needed then. */
  id?: number;
  source: string;
  status?: TermDraft['status'];
  domain?: string;
  definition?: string;
  notes?: string;
  /** Edit mode: the entry's own language pair. */
  srcLang?: string;
  tgtLang?: string;
  /** spaCy UPOS (NOUN, VERB...) or a termbase POS value. */
  pos?: string;
  origin?: string;
  target?: string;
  example?: string;
  exampleSource?: string;
  /** Add a row to this concept (a source synonym or another translation); needs `srcLang`, `tgtLang`, `projectId`. */
  conceptId?: number;
  projectId?: number | null;
  srcGender?: string;
  srcNumber?: string;
  srcNote?: string;
  tgtGender?: string;
  tgtNumber?: string;
  tgtNote?: string;
}

/** UPOS tag -> termbase part of speech (as the old UI). */
const POS_MAP: Record<string, string> = {
  NOUN: 'noun', VERB: 'verb', AUX: 'verb', ADJ: 'adjective', ADV: 'adverb', PROPN: 'properNoun',
};
export const TERM_POS = ['noun', 'verb', 'adjective', 'adverb', 'properNoun', 'other'];
/** TBX-Basic grammaticalGender values; number has no TBX-Basic category (CSV and Excel only). */
export const GENDERS = ['masculine', 'feminine', 'neuter', 'other'];
export const NUMBERS = ['singular', 'plural', 'dual', 'mass', 'other'];

const blank = (): TermDraft => ({
  src_term: '', tgt_term: '', status: 'candidate', pos: '', domain: '', definition: '', notes: '',
  context: '', context_source: '', src_gender: '', src_number: '', src_note: '', tgt_gender: '', tgt_number: '',
  tgt_note: '',
});

// Not cached: the list changes when the user adds or removes a language.
async function loadLanguages(): Promise<Languages> {
  return get<Languages>('/api/languages');
}

export const termStore = $state<{
  open: boolean;
  draft: TermDraft;
  ctx: TermContext | null;
  langs: Languages;
  /** Id of the entry being edited; null when adding. */
  editingId: number | null;
  /** Distinct domains of the loaded termbase, offered as suggestions. */
  domains: string[];
  examples: Example[];
  examplesFor: string;
  saving: boolean;
}>({
  open: false,
  draft: blank(),
  ctx: null,
  langs: {},
  editingId: null,
  domains: [],
  examples: [],
  examplesFor: '',
  saving: false,
});

/** Opens the Add term dialog for the current corpus (or edits entry `args.id`), prefilled from `args`. */
export function openTerm(args: OpenTermArgs): void {
  const editing = args.id !== undefined;
  const synonym = args.conceptId !== undefined;
  const c = corpusStore.current;
  if (!editing && !synonym && !c) {
    messages.say(t('corpus.selectFirst'), 'err');
    return;
  }
  const pos = args.pos ? (POS_MAP[args.pos] ?? (TERM_POS.includes(args.pos) ? args.pos : '')) : '';
  termStore.draft = {
    ...blank(),
    src_term: args.source,
    tgt_term: args.target ?? '',
    status: args.status ?? 'candidate',
    pos,
    domain: args.domain ?? '',
    definition: args.definition ?? '',
    notes: args.notes ?? '',
    context: args.example ?? '',
    context_source: args.example ? (args.exampleSource ?? '') : '',
    src_gender: args.srcGender ?? '',
    src_number: args.srcNumber ?? '',
    src_note: args.srcNote ?? '',
    tgt_gender: args.tgtGender ?? '',
    tgt_number: args.tgtNumber ?? '',
    tgt_note: args.tgtNote ?? '',
  };
  termStore.editingId = args.id ?? null;
  termStore.ctx = editing
    ? { project_id: null, src_lang: args.srcLang ?? '', tgt_lang: args.tgtLang ?? '', origin: args.origin ?? 'manual' }
    : synonym
      ? {
          project_id: args.projectId ?? null, src_lang: args.srcLang ?? '', tgt_lang: args.tgtLang ?? '',
          origin: args.origin ?? 'manual', concept_id: args.conceptId,
        }
      : { project_id: c!.project_id, src_lang: c!.lang, tgt_lang: '', origin: args.origin ?? 'manual' };
  termStore.examples = [];
  termStore.examplesFor = '';
  termStore.open = true;
  const ctx = termStore.ctx;
  loadLanguages()
    .then((l) => {
      termStore.langs = l;
      // The target language is the other supported one (as the old UI).
      if (!editing && !synonym) ctx.tgt_lang = Object.keys(l).find((k) => k !== ctx.src_lang) ?? '';
    })
    .catch((err) => messages.say(err instanceof Error ? err.message : String(err), 'err'));
  if (!editing) findExamples(true);
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

/** Fired on `window` after a term was added or updated, so open lists can reload. */
export const TERM_SAVED = 'term-saved';

/** POSTs the draft (PATCHes it when editing); returns true on success (the dialog then closes). */
export async function saveTerm(): Promise<boolean> {
  const ctx = termStore.ctx;
  if (!ctx || termStore.saving) return false;
  const d = termStore.draft;
  const id = termStore.editingId;
  const body = { ...d, context_source: d.context.trim() ? d.context_source : '' };
  termStore.saving = true;
  try {
    if (id !== null) {
      await patch(`/api/terms/${id}`, body);
    } else {
      await post('/api/terms', {
        ...body,
        project_id: ctx.project_id,
        src_lang: ctx.src_lang,
        tgt_lang: ctx.tgt_lang,
        origin: ctx.origin,
        ...(ctx.concept_id !== undefined ? { concept_id: ctx.concept_id } : {}),
      });
    }
    messages.say(t(id !== null ? 'term.updated' : 'term.saved'), 'ok');
    termStore.open = false;
    window.dispatchEvent(new CustomEvent(TERM_SAVED));
    return true;
  } catch (err) {
    messages.say(err instanceof Error ? err.message : String(err), 'err');
    return false;
  } finally {
    termStore.saving = false;
  }
}
