import { describe, expect, it } from 'vitest';
import { fromProposal, mergeNext, removeLink, report, splitLink, type AlignLink } from '../src/lib/align';

const link = (src: string[], tgt: string[], low = false): AlignLink => ({ src, tgt, confidence: low ? 0.05 : 0.9, low, edited: false });

describe('alignment editing', () => {
  const base = [link(['a'], ['A']), link(['b', 'c'], ['B'], true), link(['d'], [])];

  it('removes a pair', () => {
    expect(removeLink(base, 1).map((l) => l.src[0])).toEqual(['a', 'd']);
  });

  it('merges a link with the next one, joining both sides in order', () => {
    const out = mergeNext(base, 0);
    expect(out).toHaveLength(2);
    expect(out[0].src).toEqual(['a', 'b', 'c']);
    expect(out[0].tgt).toEqual(['A', 'B']);
    expect(out[0].edited).toBe(true);
    expect(mergeNext(base, 2)).toBe(base);
  });

  it('splits a link at a source and a target position', () => {
    const out = splitLink(base, 1, 1, 0);
    expect(out.map((l) => [l.src, l.tgt])).toEqual([
      [['a'], ['A']], [['b'], []], [['c'], ['B']], [['d'], []],
    ]);
    expect(out[1].edited && out[2].edited).toBe(true);
  });

  it('refuses a split that leaves one part empty', () => {
    expect(splitLink(base, 1, 0, 0)).toBe(base);
    expect(splitLink(base, 1, 2, 1)).toBe(base);
    expect(splitLink(base, 1, 3, 0)).toBe(base);
  });

  it('fixes a wrong grouping by merge then split', () => {
    // (s1 | t1 t2) (s2 | t3) should have been (s1 | t1) (s2 | t2 t3)
    const wrong = [link(['s1'], ['t1', 't2']), link(['s2'], ['t3'])];
    const fixed = splitLink(mergeNext(wrong, 0), 0, 1, 1);
    expect(fixed.map((l) => [l.src, l.tgt])).toEqual([[['s1'], ['t1']], [['s2'], ['t2', 't3']]]);
  });

  it('reports counts by type, low-confidence share and unstorable links; edited links count as reviewed', () => {
    const r = report(base);
    expect(r.byType).toMatchObject({ '1:1': 1, '2:1': 1, '1:0': 1 });
    expect(r.links).toBe(3);
    expect(r.low).toBe(1);
    expect(r.lowShare).toBeCloseTo(1 / 3);
    expect(r.unstorable).toBe(1);
    expect(report(splitLink(base, 1, 1, 0)).low).toBe(0);
    expect(report([]).lowShare).toBe(0);
  });

  it('builds links from a proposal', () => {
    const l = fromProposal({ title: 't', source_lang: 'es', target_lang: 'it', links: [{ src: ['x'], tgt: ['y'], confidence: 1, low: false }] });
    expect(l).toEqual([{ src: ['x'], tgt: ['y'], confidence: 1, low: false, edited: false }]);
  });
});
