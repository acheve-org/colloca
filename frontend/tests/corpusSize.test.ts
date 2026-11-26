import { describe, expect, it } from 'vitest';
import { corpusSize } from '../src/lib/corpusSize';

const docs = (...sizes: number[]) => sizes.map((n, i) => ({ title: `Doc ${i + 1}`, n_tokens: n }));
const one = (total: number) => corpusSize(docs(total / 4, total / 4, total / 4, total / 4))!;
const row = (total: number, key: string) => one(total).rows.find((r) => r.key === key)!;

describe('corpusSize', () => {
  it('is null for no documents or no words', () => {
    expect(corpusSize([])).toBeNull();
    expect(corpusSize(docs(0, 0))).toBeNull();
  });

  it.each([
    [49_996, 'small', 0],
    [50_000, 'workable', 1],
    [249_996, 'workable', 1],
    [250_000, 'solid', 2],
    [999_996, 'solid', 2],
    [1_000_000, 'large', 3],
  ])('puts %i words in the %s band', (total, band, index) => {
    const s = one(total);
    expect(s.total).toBe(total);
    expect(s.band).toBe(band);
    expect(s.bandIndex).toBe(index);
  });

  it('uses the exact band edges', () => {
    expect(corpusSize(docs(49_999))!.band).toBe('small');
    expect(corpusSize(docs(249_999))!.band).toBe('workable');
    expect(corpusSize(docs(999_999))!.band).toBe('solid');
  });

  it('gives the next band and the words still missing, none in the large band', () => {
    expect(one(182_400).next).toEqual({ band: 'solid', at: 250_000, more: 67_600 });
    expect(one(20_000).next).toEqual({ band: 'workable', at: 50_000, more: 30_000 });
    expect(one(400_000).next).toEqual({ band: 'large', at: 1_000_000, more: 600_000 });
    expect(one(1_000_000).next).toBeNull();
  });

  it('rates the analyses by band', () => {
    const levels = (total: number) => one(total).rows.map((r) => `${r.key}:${r.level}`);
    expect(levels(20_000)).toEqual(['concordance:ok', 'collocations:rough', 'keyness:rough', 'related:rough']);
    expect(levels(100_000)).toEqual(['concordance:ok', 'collocations:ok', 'keyness:ok', 'related:rough']);
    expect(levels(400_000)).toEqual(['concordance:ok', 'collocations:ok', 'keyness:ok', 'related:ok']);
    expect(levels(2_000_000)).toEqual(['concordance:ok', 'collocations:ok', 'keyness:ok', 'related:ok']);
  });

  it('calls related terms rough below 200,000 words in the workable band', () => {
    expect(corpusSize(docs(199_999))!.rows.find((r) => r.key === 'related')!.level).toBe('rough');
    expect(row(200_000, 'related').level).toBe('ok');
    expect(corpusSize(docs(199_999))!.rows.find((r) => r.key === 'related')!.note).toBe('size.note.roughBelow');
    expect(corpusSize(docs(199_999))!.rows.find((r) => r.key === 'related')!.vars).toEqual({ n: '200,000' });
  });

  it('notes the largest document only past 40% with at least 2 documents', () => {
    expect(corpusSize(docs(60_000, 40_000))!.largest).toEqual({ title: 'Doc 1', share: 0.6 });
    expect(corpusSize(docs(40_000, 30_000, 30_000))!.largest).toBeNull(); // exactly 40%
    expect(corpusSize(docs(100_000))!.largest).toBeNull(); // one document
  });

  it('warns when the corpus is small or unbalanced', () => {
    expect(one(20_000).warn).toBe(true);
    expect(one(100_000).warn).toBe(false);
    expect(corpusSize(docs(60_000, 40_000))!.warn).toBe(true);
    expect(corpusSize(docs(100_000))!.warn).toBe(false);
  });
});
