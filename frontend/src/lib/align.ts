/** Editing of an automatic alignment proposal (the review step). Pure functions: nothing here talks to the server. */
export interface AlignLink {
  src: string[];
  tgt: string[];
  confidence: number;
  /** Marked for review: a low score, or a unit with no counterpart. */
  low: boolean;
  /** Changed by the reviewer (merged or split): counted as reviewed, not as low confidence. */
  edited: boolean;
}

export interface AlignProposal {
  title: string;
  source_lang: string;
  target_lang: string;
  links: { src: string[]; tgt: string[]; confidence: number; low: boolean }[];
}

export interface AlignReport {
  links: number;
  byType: Record<string, number>;
  low: number;
  lowShare: number;
  /** Links with an empty side: they cannot be stored as a pair. */
  unstorable: number;
}

export const LINK_TYPES = ['1:1', '1:2', '2:1', '1:0', '0:1'] as const;

export const linkType = (l: AlignLink) => `${l.src.length}:${l.tgt.length}`;
export const isLow = (l: AlignLink) => l.low && !l.edited;
export const storable = (l: AlignLink) => l.src.length > 0 && l.tgt.length > 0;

export function fromProposal(p: AlignProposal): AlignLink[] {
  return p.links.map((l) => ({ src: l.src, tgt: l.tgt, confidence: l.confidence, low: l.low, edited: false }));
}

export function removeLink(links: AlignLink[], i: number): AlignLink[] {
  return links.filter((_, k) => k !== i);
}

/** Link `i` and the next one become one link (their sentences are joined side by side). */
export function mergeNext(links: AlignLink[], i: number): AlignLink[] {
  if (i < 0 || i + 1 >= links.length) return links;
  const [a, b] = [links[i], links[i + 1]];
  const merged: AlignLink = {
    src: [...a.src, ...b.src], tgt: [...a.tgt, ...b.tgt], confidence: Math.min(a.confidence, b.confidence),
    low: a.low || b.low, edited: true,
  };
  return [...links.slice(0, i), merged, ...links.slice(i + 2)];
}

/** Splits link `i` after the first `s` source and the first `t` target sentences. Both parts must hold something. */
export function splitLink(links: AlignLink[], i: number, s: number, t: number): AlignLink[] {
  const l = links[i];
  if (!l || s < 0 || t < 0 || s > l.src.length || t > l.tgt.length) return links;
  if (s + t === 0 || s + t === l.src.length + l.tgt.length) return links;
  const part = (src: string[], tgt: string[]): AlignLink => ({ src, tgt, confidence: l.confidence, low: l.low, edited: true });
  return [...links.slice(0, i), part(l.src.slice(0, s), l.tgt.slice(0, t)), part(l.src.slice(s), l.tgt.slice(t)), ...links.slice(i + 1)];
}

export function report(links: AlignLink[]): AlignReport {
  const byType: Record<string, number> = Object.fromEntries(LINK_TYPES.map((k) => [k, 0]));
  for (const l of links) {
    const k = linkType(l);
    byType[k] = (byType[k] ?? 0) + 1;
  }
  const low = links.filter(isLow).length;
  return {
    links: links.length,
    byType,
    low,
    lowShare: links.length ? low / links.length : 0,
    unstorable: links.filter((l) => !storable(l)).length,
  };
}
