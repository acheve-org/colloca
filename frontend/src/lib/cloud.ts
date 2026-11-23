export interface CloudItem {
  word: string;
  weight: number;
}

export interface Placed {
  word: string;
  weight: number;
  /** Top-left corner and box of the word (the text is drawn 3px inside, baseline "top"). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Font size in px. */
  size: number;
}

/** Text width at a font size; the canvas passes `ctx.measureText` here. */
export type Measure = (word: string, size: number) => number;

const MARGIN = 4;
const MIN_SIZE = 14;
const SPAN = 54; // size range above MIN_SIZE
const PAD = 6; // horizontal breathing room added to the measured width

// Rough average glyph width (em) when no real measure is given.
const estimate: Measure = (word, size) => word.length * size * 0.58;

/**
 * Spiral word-cloud layout (port of the old `drawCloud`): words are placed from the heaviest
 * down, each at the first point of an elliptical spiral around the centre where it fits
 * inside the bounds and clear of the words already placed. Words that never fit are skipped.
 */
export function layoutCloud(
  items: CloudItem[],
  width: number,
  height: number,
  measure: Measure = estimate,
): Placed[] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => b.weight - a.weight);
  const max = Math.sqrt(sorted[0].weight);
  const min = Math.sqrt(sorted[sorted.length - 1].weight);
  const placed: Placed[] = [];

  for (const it of sorted) {
    const size = MIN_SIZE + (max === min ? 20 : (SPAN * (Math.sqrt(it.weight) - min)) / (max - min));
    const w = measure(it.word, size) + PAD;
    const h = size * 1.05;
    for (let t = 0; t < 4000; t += 0.35) {
      const r = 3 * t;
      const x = width / 2 + r * Math.cos(t) * 1.6 - w / 2;
      const y = height / 2 + r * Math.sin(t) - h / 2;
      if (x < MARGIN || y < MARGIN || x + w > width - MARGIN || y + h > height - MARGIN) continue;
      if (placed.some((p) => x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y)) continue;
      placed.push({ word: it.word, weight: it.weight, x, y, w, h, size });
      break;
    }
  }
  return placed;
}
