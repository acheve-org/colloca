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
  const kinds = Object.keys(PRIORITY) as HitKind[];
  const events: { pos: number; kind: HitKind; delta: 1 | -1 }[] = [];
  for (const r of ranges) {
    if (r.end <= r.start) continue;
    events.push({ pos: r.start, kind: r.kind, delta: 1 }, { pos: r.end, kind: r.kind, delta: -1 });
  }
  events.sort((a, b) => a.pos - b.pos);
  const active: Record<HitKind, number> = { equiv: 0, term: 0, query: 0, forbidden: 0 };
  const out: Range[] = [];
  for (let i = 0; i < events.length; ) {
    const pos = events[i].pos;
    while (i < events.length && events[i].pos === pos) {
      active[events[i].kind] += events[i].delta;
      i++;
    }
    if (i >= events.length) break;
    const next = events[i].pos;
    let best: HitKind | null = null;
    for (const k of kinds) if (active[k] > 0 && (best === null || PRIORITY[k] > PRIORITY[best])) best = k;
    if (best === null) continue;
    const last = out[out.length - 1];
    if (last && last.end === pos && last.kind === best) last.end = next;
    else out.push({ start: pos, end: next, kind: best });
  }
  return out;
}
