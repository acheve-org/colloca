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
  source?: string;
  n_tokens: number;
  tags?: string[];
  text_type?: string;
  doc_date?: string;
  lang_status?: string;
}

export interface Job {
  id: number;
  kind?: string;
  status: string;
  progress?: number;
  message?: string;
  error?: string;
}

export interface FrequencyRow {
  lemma?: string;
  form?: string;
  pos?: string;
  freq: number;
  per_million?: number;
  ref_freq?: number;
  ref_per_million?: number;
}

export interface ConcordanceRow {
  doc_title?: string;
  left: string;
  node: string;
  right: string;
}

export interface CollocationRow {
  collocate: string;
  pos?: string;
  freq: number;
  score?: number;
}

export interface NgramRow {
  ngram: string;
  freq: number;
}

export interface KeynessRow {
  item: string;
  freq: number;
  ref_freq: number;
  score: number;
}

export interface Term {
  id: number;
  project_id: number | null;
  src_lang: string;
  tgt_lang: string;
  src: string;
  tgt: string;
  pos?: string;
  origin?: string;
  note?: string;
}
