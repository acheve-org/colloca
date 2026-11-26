/** A match: offsets into the original text, `end` exclusive. */
export type TextMatch = { start: number; end: number };

const MARK = /\p{M}/u;

/** The text folded for matching (decomposed, lower case, no combining marks), with each folded
 *  character's span in the original. A dropped mark joins the span of the character before it. */
function fold(text: string): { folded: string; starts: number[]; ends: number[] } {
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of text) {
    const end = i + ch.length;
    let piece = '';
    for (const c of ch.normalize('NFD').toLowerCase()) if (!MARK.test(c)) piece += c;
    if (piece) {
      for (let k = 0; k < piece.length; k++) {
        starts.push(i);
        ends.push(end);
      }
      folded += piece;
    } else if (ends.length) {
      ends[ends.length - 1] = end;
    }
    i = end;
  }
  return { folded, starts, ends };
}

/** Literal, case- and accent-insensitive matches of `query` in `text`, left to right, not overlapping. */
export function findText(text: string, query: string): TextMatch[] {
  if (!query.trim()) return [];
  const q = fold(query).folded;
  if (!q) return [];
  const { folded, starts, ends } = fold(text);
  const out: TextMatch[] = [];
  for (let at = folded.indexOf(q); at !== -1; at = folded.indexOf(q, at + q.length)) {
    out.push({ start: starts[at], end: ends[at + q.length - 1] });
  }
  return out;
}
