import type { Doc } from './types';

export type SizeBand = 'small' | 'workable' | 'solid' | 'large';
export type Readiness = { key: 'concordance' | 'collocations' | 'keyness' | 'related'; level: 'ok' | 'rough'; note: string };

export interface CorpusSize {
  total: number;
  band: SizeBand;
  bandIndex: 0 | 1 | 2 | 3;
  /** The next band up and how many words it still needs; null in the large band. */
  next: { band: string; at: number; more: number } | null;
  /** The document holding more than 40% of the words, when there are at least 2 documents. */
  largest: { title: string; share: number } | null;
  /** Small or unbalanced: the gauge turns amber. */
  warn: boolean;
  rows: Readiness[];
}

const BANDS: SizeBand[] = ['small', 'workable', 'solid', 'large'];
/** Lower edge of each band after the first, in total words. */
const EDGES = [50_000, 250_000, 1_000_000];
/** About the 100k content words `related.py` treats as a small corpus. */
const RELATED_OK = 200_000;
const DOMINANT_SHARE = 0.4;

const ok = (key: Readiness['key'], note = 'size.note.reliable'): Readiness => ({ key, level: 'ok', note });
const rough = (key: Readiness['key'], note = 'size.note.rough'): Readiness => ({ key, level: 'rough', note });

function readiness(band: SizeBand, total: number): Readiness[] {
  if (band === 'small') {
    return [ok('concordance'), rough('collocations', 'size.note.frequentOnly'), rough('keyness'), rough('related')];
  }
  if (band === 'workable') {
    return [
      ok('concordance'),
      ok('collocations', 'size.note.coreTerms'),
      ok('keyness'),
      total < RELATED_OK ? rough('related', 'size.note.roughBelow') : ok('related'),
    ];
  }
  return [ok('concordance'), ok('collocations'), ok('keyness'), ok('related')];
}

/** How big the corpus is (Σ words of its documents), what that size supports, and whether one document dominates. */
export function corpusSize(docs: Pick<Doc, 'title' | 'n_tokens'>[]): CorpusSize | null {
  const total = docs.reduce((sum, d) => sum + d.n_tokens, 0);
  if (!docs.length || total <= 0) return null;
  const bandIndex = EDGES.filter((e) => total >= e).length as CorpusSize['bandIndex'];
  const band = BANDS[bandIndex];
  const at = EDGES[bandIndex];
  const next = at === undefined ? null : { band: BANDS[bandIndex + 1], at, more: at - total };
  let largest: CorpusSize['largest'] = null;
  if (docs.length >= 2) {
    const top = docs.reduce((a, b) => (b.n_tokens > a.n_tokens ? b : a));
    const share = top.n_tokens / total;
    if (share > DOMINANT_SHARE) largest = { title: top.title, share };
  }
  return { total, band, bandIndex, next, largest, warn: band === 'small' || largest !== null, rows: readiness(band, total) };
}
