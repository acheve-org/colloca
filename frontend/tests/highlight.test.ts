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

describe('mergeRanges', () => {
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
});
