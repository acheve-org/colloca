// Minimal shapes of the API responses the UI reads (see src/colloca/main.py).

import type { TermMark } from "./highlight";

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
  status: "queued" | "running" | "done" | "error" | string;
  progress: number;
  error: string;
  code: string;
  result: Record<string, unknown>;
}

/** One older document a new text is too similar to (the `result` of a job that failed with code `near_duplicate`). */
export interface NearDupMatch {
  id: number;
  title: string;
  source: string;
  added: string;
  similarity: number;
  units: number;
  shared_units: number;
  changed: string[];
}

/** GET /api/corpora/{id}/near-duplicates */
export interface NearDupDoc {
  id: number;
  title: string;
  source: string;
  added: string;
  n_tokens: number;
}
export interface NearDupReport {
  threshold: number;
  documents: number;
  fingerprinted_now: number;
  pairs: { a: NearDupDoc; b: NearDupDoc; similarity: number }[];
}

/** /frequency (array) */
export interface FrequencyRow {
  item: string;
  in_termbase?: string;
  dropped?: boolean;
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
  /** Token positions of the matched words (the hit, for the document viewer). */
  matches?: number[];
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
  /** advanced searches only: the query in words, and whether the hit cap cut the list short */
  parsed?: string;
  capped?: boolean;
}

/** /api/query/explain: the query in words, or the message and 1-based character position of a mistake */
export type QueryExplanation =
  | { ok: true; parsed: string }
  | { ok: false; error: string; position: number | null };

/** /bilingual returns { total, lines } with the aligned segment */
export interface BilingualLine extends ConcordanceLine {
  source: string;
  target: string;
  /** Character offsets into `source`: the hit itself. */
  source_marks?: { start: number; end: number }[];
  /** Character offsets into `target`: the likely equivalent (`guess` = statistical, else a termbase term). */
  target_marks?: {
    start: number;
    end: number;
    score: number;
    guess: boolean;
  }[];
  /** Termbase hits and forbidden translations (offsets into `source` / `target`). */
  source_terms?: TermMark[];
  target_terms?: TermMark[];
}
export interface BilingualResult {
  total: number;
  lines: BilingualLine[];
  parsed?: string;
  capped?: boolean;
}
/** A concordance line from either endpoint; `source`/`target` only in bilingual results. */
export type ConcLine = ConcordanceLine &
  Partial<
    Pick<
      BilingualLine,
      | "source"
      | "target"
      | "source_marks"
      | "target_marks"
      | "source_terms"
      | "target_terms"
    >
  > & {
    /** KWIC lines: termbase marks as offsets into `left`, `node`, `right`. */
    left_terms?: TermMark[];
    node_terms?: TermMark[];
    right_terms?: TermMark[];
  };

/** Result of POST /check-text. */
export interface CheckTextResult {
  lang: string;
  lines: { text: string; marks: TermMark[] }[];
  summary: { hits: number; forbidden: number };
}

export interface CollocationRow {
  item: string;
  in_termbase?: string;
  dropped?: boolean;
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
/** /dispersion: where a query occurs across the documents. */
export interface DispersionMark {
  pos: number;
  span: number;
  /** relative position in the document, 0 to 1 */
  at: number;
}
export interface DispersionDoc {
  doc_id: number;
  title: string;
  words: number;
  length: number;
  hits: number;
  per_million: number;
  marks: DispersionMark[];
}
export interface DispersionResult {
  total: number;
  range: number;
  docs: DispersionDoc[];
  parsed?: string;
  capped?: boolean;
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
  in_termbase?: string;
  dropped?: boolean;
  freq: number;
  docs: number;
}

/** /keyness (array) */
export interface KeynessRow {
  item: string;
  in_termbase?: string;
  dropped?: boolean;
  pos: string;
  freq: number;
  ref_freq: number;
  per_million: number;
  ref_per_million: number;
  log_ratio: number;
  ll: number;
  docs: number;
  /** Only when the request had both_directions. */
  direction?: "over" | "under";
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
  language_check: "ok" | "uncertain" | "mismatch" | string;
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
  reference: "base" | null;
}
export interface JobTranslation {
  id: number;
  term: string;
  status: "candidate" | "approved" | "forbidden" | string;
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
  /** Status of the termbase entry with this term ("" = none), and whether it is on the stop list. */
  in_termbase?: string;
  dropped?: boolean;
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
  in_termbase?: string;
  dropped?: boolean;
}
export interface JobReport {
  summary: JobSummary;
  key_terms: JobKeyTerm[];
  gaps: JobGap[];
  known_terms: JobKnownTerm[];
  phrases: JobPhrase[];
}

/** GET /api/documents/{id}/context: metadata and the text around one hit. */
export interface DocContextBlock {
  n: number;
  text: string;
  hit: boolean;
  /** Aligned translation of this block (aligned documents only). */
  pair: string;
  marks: { start: number; end: number }[];
}
export interface DocContext {
  document: {
    id: number;
    corpus_id: number;
    title: string;
    source: string;
    kind: string;
    author: string;
    date: string;
    text_type: string;
    tags: string[];
    tokens: number;
    aligned: boolean;
  };
  blocks: DocContextBlock[];
  more_before: boolean;
  more_after: boolean;
}
