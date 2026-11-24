import { describe, expect, it } from 'vitest';
import { findRanges, mergeRanges } from '../src/lib/highlight';

describe('findRanges', () => {
  it('finds a literal phrase', () => {
    expect(findRanges('El parque eólico', ['parque eólico'], 'query')).toEqual([
      { start: 3, end: 16, kind: 'query' },
    ]);
  });

  it('treats regex metacharacters literally and never throws', () => {
    expect(findRanges('uso de c++ y (a|b) aquí', ['c++'], 'query')).toEqual([
      { start: 7, end: 10, kind: 'query' },
    ]);
    expect(findRanges('uso de c++ y (a|b) aquí', ['(a|b)'], 'query')).toEqual([
      { start: 13, end: 18, kind: 'query' },
    ]);
    expect(() => findRanges('x', ['[', '\\', '*', '(', '?'], 'query')).not.toThrow();
    expect(findRanges('a', ['(a|b)'], 'query')).toEqual([]);
  });

  it('is case-insensitive by default and honours caseSensitive', () => {
    expect(findRanges('un Ñandú', ['ñandú'], 'query')).toEqual([{ start: 3, end: 8, kind: 'query' }]);
    expect(findRanges('un Ñandú', ['ñandú'], 'query', { caseSensitive: true })).toEqual([]);
  });

  it('matches accent-sensitively by default, insensitively on request', () => {
    expect(findRanges('una canción', ['cancion'], 'query')).toEqual([]);
    expect(findRanges('una canción', ['cancion'], 'query', { accentInsensitive: true })).toEqual([
      { start: 4, end: 11, kind: 'query' },
    ]);
    expect(findRanges('una cancion', ['canción'], 'query', { accentInsensitive: true })).toEqual([
      { start: 4, end: 11, kind: 'query' },
    ]);
  });

  it('returns offsets into the original string with combining characters', () => {
    const text = 'una canción aquí';
    expect(text.length).toBe(17);
    const r = findRanges(text, ['cancion'], 'query', { accentInsensitive: true });
    expect(r).toEqual([{ start: 4, end: 12, kind: 'query' }]);
    expect(text.slice(r[0].start, r[0].end)).toBe('canción');
    const after = findRanges(text, ['aqui'], 'term', { accentInsensitive: true });
    expect(text.slice(after[0].start, after[0].end)).toBe('aquí');
  });

  it('keeps offsets right when NFD length differs and after astral chars', () => {
    const text = '😀 ñandú ﬁn Å';
    const r = findRanges(text, ['nandu'], 'equiv', { accentInsensitive: true });
    expect(r).toHaveLength(1);
    expect(text.slice(r[0].start, r[0].end)).toBe('ñandú');
    const a = findRanges(text, ['a'], 'equiv', { accentInsensitive: true });
    expect(a.map((x) => text.slice(x.start, x.end))).toEqual(['a', 'Å']);
  });

  it('yields nothing for empty needles and finds every occurrence', () => {
    expect(findRanges('abc', [''], 'query')).toEqual([]);
    expect(findRanges('abc', [], 'query')).toEqual([]);
    expect(findRanges('a b a', ['a'], 'term').map((r) => r.start)).toEqual([0, 4]);
  });
});

describe('findRanges extras', () => {
  it('matches NFD needles against NFC text in both modes', () => {
    const needle = 'n\u0303';
    expect(findRanges('un ñu', [needle], 'query')).toEqual([{ start: 3, end: 4, kind: 'query' }]);
    expect(findRanges('un ñu', [needle], 'query', { accentInsensitive: true })).toEqual([
      { start: 1, end: 2, kind: 'query' },
      { start: 3, end: 4, kind: 'query' },
    ]);
  });

  it('finds overlapping occurrences', () => {
    expect(mergeRanges(findRanges('aaa', ['aa'], 'query'))).toEqual([{ start: 0, end: 3, kind: 'query' }]);
  });
});

describe('mergeRanges', () => {
  it('is fast on many ranges', () => {
    const text = 'a'.repeat(5000);
    const rs = findRanges(text, ['a'], 'query');
    const t0 = performance.now();
    mergeRanges(rs);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('matches a brute-force reference on random overlapping ranges', () => {
    const kinds = ['equiv', 'term', 'query', 'forbidden'] as const;
    const prio = { equiv: 0, term: 1, query: 2, forbidden: 3 };
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let round = 0; round < 20; round++) {
      const rs = Array.from({ length: 60 }, () => {
        const start = Math.floor(rnd() * 100);
        return { start, end: start + Math.floor(rnd() * 15), kind: kinds[Math.floor(rnd() * 4)] };
      });
      const ref: { start: number; end: number; kind: (typeof kinds)[number] }[] = [];
      for (let i = 0; i < 120; i++) {
        let best: (typeof kinds)[number] | null = null;
        for (const r of rs) if (r.start <= i && i < r.end && (!best || prio[r.kind] > prio[best])) best = r.kind;
        if (!best) continue;
        const l = ref[ref.length - 1];
        if (l && l.end === i && l.kind === best) l.end = i + 1;
        else ref.push({ start: i, end: i + 1, kind: best });
      }
      expect(mergeRanges(rs)).toEqual(ref);
    }
  });
  it('sorts and keeps disjoint ranges', () => {
    expect(
      mergeRanges([
        { start: 5, end: 7, kind: 'term' },
        { start: 0, end: 2, kind: 'query' },
      ]),
    ).toEqual([
      { start: 0, end: 2, kind: 'query' },
      { start: 5, end: 7, kind: 'term' },
    ]);
  });

  it('resolves overlaps by priority forbidden > query > term > equiv', () => {
    expect(
      mergeRanges([
        { start: 0, end: 6, kind: 'equiv' },
        { start: 2, end: 8, kind: 'term' },
      ]),
    ).toEqual([
      { start: 0, end: 2, kind: 'equiv' },
      { start: 2, end: 8, kind: 'term' },
    ]);
    expect(
      mergeRanges([
        { start: 0, end: 10, kind: 'query' },
        { start: 3, end: 5, kind: 'forbidden' },
        { start: 4, end: 12, kind: 'term' },
      ]),
    ).toEqual([
      { start: 0, end: 3, kind: 'query' },
      { start: 3, end: 5, kind: 'forbidden' },
      { start: 5, end: 10, kind: 'query' },
      { start: 10, end: 12, kind: 'term' },
    ]);
  });

  it('joins adjacent same-kind ranges and drops empties', () => {
    expect(
      mergeRanges([
        { start: 0, end: 2, kind: 'term' },
        { start: 2, end: 4, kind: 'term' },
        { start: 6, end: 6, kind: 'query' },
      ]),
    ).toEqual([{ start: 0, end: 4, kind: 'term' }]);
  });

  it('keeps the tooltip of a term range under a query range, and flags the merged range', () => {
    expect(
      mergeRanges([
        { start: 0, end: 6, kind: 'query' },
        { start: 2, end: 4, kind: 'term', title: 'lease' },
      ]),
    ).toEqual([
      { start: 0, end: 2, kind: 'query' },
      { start: 2, end: 4, kind: 'query', title: 'lease', term: true },
      { start: 4, end: 6, kind: 'query' },
    ]);
  });
});
