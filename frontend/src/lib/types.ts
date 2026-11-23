// Minimal shapes of the API responses the UI reads (see src/colloca/main.py).

export interface Project {
  id: number;
  name: string;
  corpora: number;
}

export interface Corpus {
  id: number;
  name: string;
  lang: string;
  project_id: number | null;
  is_reference: number;
  docs: number;
  tokens: number;
}

export type Languages = Record<string, string>;

export interface ParallelInfo {
  documents: number;
  segments: number;
  partners: { id: number; name: string; lang: string }[];
}

export interface Facets {
  tags: { tag: string; docs: number }[];
  text_types: { text_type: string; docs: number }[];
  date_min: string;
  date_max: string;
}

export interface ScopeInfo {
  filtered: boolean;
  docs: number;
  words: number;
  total_docs: number;
  total_words: number;
}

export interface Doc {
  id: number;
  title: string;
  source: string;
  kind: string;
  text_type: string;
  doc_date: string;
  author: string;
  n_tokens: number;
  pipeline: string;
  lang_check: string;
  added: string;
  segmented: number;
  pair_doc_id: number | null;
  chars: number;
  tags: string[];
  stale: boolean;
}

export interface Job {
  id: number;
  corpus_id: number;
  kind: string;
  label: string;
  status: 'queued' | 'running' | 'done' | 'error' | string;
  progress: number;
  error: string;
  code: string;
  result: Record<string, unknown>;
}

/** /frequency (array) */
export interface FrequencyRow {
  item: string;
  pos: string;
  freq: number;
  per_million: number;
  docs: number;
  docs_pct: number;
  ref_freq?: number;
  ref_per_million?: number;
}

/** /concordance returns { total, lines } */
export interface ConcordanceLine {
  doc_id: number;
  doc: string;
  pos: number;
  left: string;
  node: string;
  right: string;
}
export interface ConcordanceResult {
  total: number;
  lines: ConcordanceLine[];
}

/** /bilingual returns { total, lines } with the aligned segment */
export interface BilingualLine extends ConcordanceLine {
  source: string;
  target: string;
}
export interface BilingualResult {
  total: number;
  lines: BilingualLine[];
}
/** A concordance line from either endpoint; `source`/`target` only in bilingual results. */
export type ConcLine = ConcordanceLine & Partial<Pick<BilingualLine, 'source' | 'target'>>;

export interface CollocationRow {
  item: string;
  pos: string;
  cooc: number;
  freq: number;
  docs: number;
  logdice: number;
  mi: number;
  tscore: number;
  ll: number;
  ref_freq?: number;
  ref_per_million?: number;
}
/** /collocations returns { node_freq, corpus_size, rows } */
export interface CollocationResult {
  node_freq: number;
  corpus_size: number;
  rows: CollocationRow[];
}

/** /ngrams (array) */
export interface NgramRow {
  item: string;
  freq: number;
  docs: number;
}

/** /keyness (array) */
export interface KeynessRow {
  item: string;
  pos: string;
  freq: number;
  ref_freq: number;
  per_million: number;
  ref_per_million: number;
  log_ratio: number;
  ll: number;
  docs: number;
}

export interface EquivalentRow {
  item: string;
  pos: string;
  cooc: number;
  node_segments: number;
  target_segments: number;
  dice: number;
  logdice: number;
}
/** /equivalents returns { node_segments, rows } */
export interface EquivalentsResult {
  node_segments: number;
  rows: EquivalentRow[];
}

/** /examples (array) */
export interface Example {
  sentence: string;
  doc: string;
  doc_id: number;
}

/** /terms (array); columns of the terms table plus the project name */
export interface Term {
  id: number;
  project_id: number | null;
  project: string | null;
  src_lang: string;
  tgt_lang: string;
  src_term: string;
  tgt_term: string;
  pos: string;
  status: string;
  domain: string;
  definition: string;
  notes: string;
  context: string;
  context_source: string;
  origin: string;
  /** Last change (SQLite CURRENT_TIMESTAMP, UTC). */
  updated?: string;
}

/** Job analysis report (GET /api/jobs/{id}/result; see src/colloca/jobanalysis.py). */
export interface JobSummary {
  words: number;
  content_words: number;
  distinct_lemmas: number;
  sentences: number;
  language_check: 'ok' | 'uncertain' | 'mismatch' | string;
  corpus_words: number;
  corpus_filtered: boolean;
  min_corpus_freq: number;
  min_job_freq: number;
  coverage_tokens_pct: number;
  coverage_seen_pct: number;
  coverage_types_pct: number;
  uncovered_types: number;
  termbase_terms_found: number;
  termbase_size: number;
  /** "base" when the key terms are ranked against a base corpus. */
  reference: 'base' | null;
}
export interface JobTranslation {
  id: number;
  term: string;
  status: 'candidate' | 'approved' | 'forbidden' | string;
}
export interface JobKnownTerm {
  item: string;
  occurrences: number;
  example: string;
  translations: JobTranslation[];
  ids: number[];
}
export interface JobGap {
  item: string;
  pos: string;
  job_freq: number;
  corpus_freq: number;
  /** Approved translation, "(candidate)" or "". */
  termbase: string;
}
export interface JobKeyTerm extends JobGap {
  base_per_million: number | null;
  log_ratio: number | null;
  ll: number | null;
}
export interface JobPhrase {
  item: string;
  job_freq: number;
  corpus_freq: number;
  words: number;
}
export interface JobReport {
  summary: JobSummary;
  key_terms: JobKeyTerm[];
  gaps: JobGap[];
  known_terms: JobKnownTerm[];
  phrases: JobPhrase[];
}
