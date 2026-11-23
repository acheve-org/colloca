import { describe, expect, it } from 'vitest';
import { layoutCloud } from '../src/lib/cloud';

const W = 1000;
const H = 560;

// Zipf-like weights, as a frequency list gives.
const words = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ word: `pal${i}`, weight: Math.round(1000 / (i + 1)) }));

describe('layoutCloud', () => {
  it('places 60 words inside the bounds without overlaps', () => {
    const placed = layoutCloud(words(60), W, H);
    expect(placed.length).toBe(60);
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(4);
      expect(p.y).toBeGreaterThanOrEqual(4);
      expect(p.x + p.w).toBeLessThanOrEqual(W - 4);
      expect(p.y + p.h).toBeLessThanOrEqual(H - 4);
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        expect(overlap, `${a.word} overlaps ${b.word}`).toBe(false);
      }
    }
  });

  it('places the heaviest word first, largest and near the centre', () => {
    const shuffled = [...words(20)].reverse();
    const placed = layoutCloud(shuffled, W, H);
    expect(placed[0].word).toBe('pal0');
    expect(placed[0].size).toBe(Math.max(...placed.map((p) => p.size)));
    expect(Math.abs(placed[0].x + placed[0].w / 2 - W / 2)).toBeLessThan(5);
    expect(Math.abs(placed[0].y + placed[0].h / 2 - H / 2)).toBeLessThan(5);
  });

  it('scales font size with sqrt(weight) and uses the measure callback', () => {
    const placed = layoutCloud(
      [{ word: 'a', weight: 100 }, { word: 'b', weight: 1 }],
      W, H, (_w, size) => size * 2,
    );
    expect(placed[0].size).toBeCloseTo(14 + 54);
    expect(placed[1].size).toBeCloseTo(14);
    expect(placed[0].w).toBeCloseTo(placed[0].size * 2 + 6);
  });

  it('handles empty input and equal weights', () => {
    expect(layoutCloud([], W, H)).toEqual([]);
    const eq = layoutCloud([{ word: 'x', weight: 5 }, { word: 'y', weight: 5 }], W, H);
    expect(eq.map((p) => p.size)).toEqual([34, 34]);
  });

  it('skips a word that cannot fit instead of throwing', () => {
    expect(layoutCloud([{ word: 'x'.repeat(500), weight: 1 }], 100, 50)).toEqual([]);
  });
});
