import { t } from './i18n';

export type HitKind = 'query' | 'equiv' | 'term' | 'forbidden';
/** `title` is the hover text; `term` is set on a merged range that also lies on a termbase hit. */
export type Range = { start: number; end: number; kind: HitKind; title?: string; term?: boolean };

type Opts = { caseSensitive?: boolean; accentInsensitive?: boolean };

const MARK = /^\p{M}+$/u;

// Higher wins on overlap: forbidden > query > term > equiv.
const PRIORITY: Record<HitKind, number> = { equiv: 0, term: 1, query: 2, forbidden: 3 };

function foldChar(ch: string, o: Opts): string {
  let s = ch;
  if (o.accentInsensitive) s = s.normalize('NFD').replace(/\p{M}+/gu, '');
  if (!o.caseSensitive) s = s.toLowerCase();
  return s;
}

/** Folded text plus, for every folded UTF-16 unit, the original [start,end) it came from. */
function fold(text: string, o: Opts) {
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of text) {
    const next = i + ch.length;
    const f = foldChar(ch, o);
    for (let k = 0; k < f.length; k++) {
      starts.push(i);
      ends.push(next);
    }
    folded += f;
    i = next;
  }
  return { folded, starts, ends };
}

function foldNeedle(needle: string, o: Opts): string {
  let out = '';
  for (const ch of needle.normalize('NFC')) out += foldChar(ch, o);
  return out;
}

/** Literal (non-regex) search; offsets always index the ORIGINAL `text`. */
export function findRanges(
  text: string,
  needles: string[],
  kind: HitKind,
  opts: Opts = {},
): Range[] {
  const o = { caseSensitive: !!opts.caseSensitive, accentInsensitive: !!opts.accentInsensitive };
  const out: Range[] = [];
  if (!text) return out;
  const { folded, starts, ends } = fold(text, o);
  for (const needle of needles) {
    const n = foldNeedle(needle, o);
    if (!n) continue;
    let from = 0;
    for (;;) {
      const at = folded.indexOf(n, from);
      if (at < 0) break;
      const start = starts[at];
      let end = ends[at + n.length - 1];
      if (o.accentInsensitive) {
        // Combining marks fold to nothing; keep them inside the span.
        while (end < text.length) {
          const cp = String.fromCodePoint(text.codePointAt(end)!);
          if (!MARK.test(cp)) break;
          end += cp.length;
        }
      }
      out.push({ start, end, kind });
      from = at + 1;
    }
  }
  return out;
}

/** Sorted, non-overlapping ranges; overlaps are split and resolved by kind priority. O(n log n). */
export function mergeRanges(ranges: Range[]): Range[] {
  const events: { pos: number; r: Range; delta: 1 | -1 }[] = [];
  for (const r of ranges) {
    if (r.end <= r.start) continue;
    events.push({ pos: r.start, r, delta: 1 }, { pos: r.end, r, delta: -1 });
  }
  events.sort((a, b) => a.pos - b.pos);
  const active = new Set<Range>();
  const out: Range[] = [];
  for (let i = 0; i < events.length; ) {
    const pos = events[i].pos;
    while (i < events.length && events[i].pos === pos) {
      if (events[i].delta === 1) active.add(events[i].r);
      else active.delete(events[i].r);
      i++;
    }
    if (i >= events.length) break;
    const next = events[i].pos;
    let best: HitKind | null = null;
    for (const r of active) if (best === null || PRIORITY[r.kind] > PRIORITY[best]) best = r.kind;
    if (best === null) continue;
    // the tooltip of the strongest range that has one; a hit on a termbase term keeps its tooltip
    let title: string | undefined;
    let titleRank = -1;
    let onTerm = false;
    for (const r of active) {
      if (r.title && (r.kind === 'term' || r.kind === 'forbidden')) onTerm = true;
      if (r.title && PRIORITY[r.kind] > titleRank) {
        title = r.title;
        titleRank = PRIORITY[r.kind];
      }
    }
    const term = onTerm && best === 'query';
    const last = out[out.length - 1];
    if (last && last.end === pos && last.kind === best && last.title === title && !!last.term === term) {
      last.end = next;
    } else {
      const merged: Range = { start: pos, end: next, kind: best };
      if (title) merged.title = title;
      if (term) merged.term = true;
      out.push(merged);
    }
  }
  return out;
}

/** Offsets computed by the server into a line's `source` / `target` text. */
export interface Mark {
  start: number;
  end: number;
  score?: number;
  guess?: boolean;
}
/** A termbase hit or forbidden translation found by the server in a text (offsets into that text). */
export interface TermMark {
  start: number;
  end: number;
  kind: 'term' | 'forbidden';
  term: string;
  /** For a translation found in a target text: the source term it belongs to. */
  of: string;
  translations: string[];
  forbidden: string[];
  ids: number[];
}

/** Hover text of a termbase mark. */
export function termTitle(m: TermMark): string {
  const list = (a: string[]) => a.join(', ');
  if (m.kind === 'forbidden') {
    return m.translations.length
      ? t('th.forbiddenUse', { term: m.term, use: list(m.translations) })
      : t('th.forbidden', { term: m.term });
  }
  const parts: string[] = [];
  if (m.of) parts.push(t('th.approvedFor', { term: m.of }));
  else if (m.translations.length) parts.push(t('th.translation', { use: list(m.translations) }));
  else parts.push(t('th.noApproved'));
  if (m.forbidden.length) parts.push(t('th.avoid', { avoid: list(m.forbidden) }));
  return parts.join(' · ');
}

/** Ranges for termbase marks: solid underline (`term`) or struck-through warning (`forbidden`). */
export function termRanges(marks: TermMark[] | undefined): Range[] {
  return (marks ?? []).map((m) => ({ start: m.start, end: m.end, kind: m.kind, title: termTitle(m) }));
}

export interface MarkedLine {
  node: string;
  source?: string;
  target?: string;
  source_marks?: Mark[];
  target_marks?: Mark[];
  source_terms?: TermMark[];
  target_terms?: TermMark[];
}

/** The query in the source segment: the server's exact occurrence, else a text search for the node. */
export function sourceRanges(l: MarkedLine): Range[] {
  const text = l.source ?? '';
  const query: Range[] = l.source_marks
    ? l.source_marks.map((m) => ({ start: m.start, end: m.end, kind: 'query' as const }))
    : findRanges(text, [l.node], 'query');
  return [...query, ...termRanges(l.source_terms)];
}

/**
 * The likely equivalent in the target: an approved termbase translation ('term', solid underline) or a
 * statistical guess ('equiv', dotted underline). Without server marks, `likelyEquiv` words are searched.
 */
export function targetRanges(l: MarkedLine, likelyEquiv: string[] = []): Range[] {
  const terms = termRanges(l.target_terms);
  if (l.target_marks) {
    return [
      ...l.target_marks.map((m) => ({ start: m.start, end: m.end, kind: m.guess ? ('equiv' as const) : ('term' as const) })),
      ...terms,
    ];
  }
  return [...findRanges(l.target ?? '', likelyEquiv, 'equiv'), ...terms];
}

/** True when the target highlight is a statistical guess (to be labelled as such). */
export function targetIsGuess(l: MarkedLine, likelyEquiv: string[] = []): boolean {
  if (l.target_marks) return l.target_marks.some((m) => m.guess);
  return likelyEquiv.length > 0;
}
