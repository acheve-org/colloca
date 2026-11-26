import type { Doc } from './types';

export interface BaseSource {
  /** The uploaded file name (each file is split into parts of 5000 sentences). */
  source: string;
  parts: number;
  words: number;
}

/** The files a base corpus was built from, in import order, with their parts and words. */
export function baseSources(docs: Pick<Doc, 'source' | 'title' | 'n_tokens'>[]): BaseSource[] {
  const by = new Map<string, BaseSource>();
  for (const d of docs) {
    // Older imports may lack a source: fall back to the title without its ' (part N)' suffix.
    const source = d.source || d.title.replace(/ \(part \d+\)$/, '');
    const s = by.get(source) ?? { source, parts: 0, words: 0 };
    s.parts += 1;
    s.words += d.n_tokens;
    by.set(source, s);
  }
  return [...by.values()];
}
