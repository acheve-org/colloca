import { describe, expect, it } from 'vitest';
import { findText } from '../src/lib/findText';

const hits = (text: string, q: string) => findText(text, q).map((r) => text.slice(r.start, r.end));

describe('findText', () => {
  it('ignores accents and case, with offsets in the original text', () => {
    const text = 'La Razón de ser';
    expect(findText(text, 'razon')).toEqual([{ start: 3, end: 8 }]);
    expect(hits(text, 'RAZÓN')).toEqual(['Razón']);
  });

  it('maps offsets back across decomposed accents and characters before them', () => {
    // "é" as e + combining acute: the mark belongs to the match it follows.
    const text = 'café café';
    expect(findText(text, 'cafe')).toEqual([{ start: 0, end: 5 }, { start: 6, end: 10 }]);
    expect(findText('😀 Ñandú', 'nandu')).toEqual([{ start: 3, end: 8 }]);
  });

  it('is literal, not a regular expression', () => {
    expect(findText('x = A.B(1) or AxB(', 'A.B(')).toEqual([{ start: 4, end: 8 }]);
    expect(findText('a+b', '.*')).toEqual([]);
  });

  it('finds nothing for an empty or blank query', () => {
    expect(findText('some text', '')).toEqual([]);
    expect(findText('some  text', '  ')).toEqual([]);
  });

  it('finds repeated matches left to right, without overlaps', () => {
    expect(findText('dose, Dose, DOSE', 'dose')).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 10 },
      { start: 12, end: 16 },
    ]);
    expect(findText('aaaa', 'aa')).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
    expect(findText('abc', 'abcd')).toEqual([]);
  });
});
