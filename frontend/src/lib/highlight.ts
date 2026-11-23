export type HitKind = 'query' | 'equiv' | 'term' | 'forbidden';
export type Range = { start: number; end: number; kind: HitKind };

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
  for (const ch of needle) out += foldChar(ch, o);
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
      from = at + n.length;
    }
  }
  return out;
}

/** Sorted, non-overlapping ranges; overlaps are split and resolved by kind priority. */
export function mergeRanges(ranges: Range[]): Range[] {
  const valid = ranges.filter((r) => r.end > r.start);
  const points = [...new Set(valid.flatMap((r) => [r.start, r.end]))].sort((a, b) => a - b);
  const out: Range[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    let best: HitKind | null = null;
    for (const r of valid) {
      if (r.start <= a && r.end >= b && (best === null || PRIORITY[r.kind] > PRIORITY[best])) {
        best = r.kind;
      }
    }
    if (best === null) continue;
    const last = out[out.length - 1];
    if (last && last.end === a && last.kind === best) last.end = b;
    else out.push({ start: a, end: b, kind: best });
  }
  return out;
}
