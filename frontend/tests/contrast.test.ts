import { describe, expect, it } from 'vitest';
import css from '../src/lib/styles/tokens.css?raw';

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function vars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

// Light = first :root block; dark = :root[data-theme="dark"] block.
const light = vars(css.match(/:root\s*\{([^}]*)\}/)![1]);
const dark = { ...light, ...vars(css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)![1]) };
const mediaDark = vars(css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/)![1]);

const hits = ['query', 'equiv', 'term', 'forbidden'];
const pairs: [string, string, string][] = [
  ['--fg', '--bg', 'fg on bg'],
  ['--fg', '--surface', 'fg on surface'],
  ['--muted', '--surface', 'muted on surface'],
  ['--muted', '--bg', 'muted on bg'],
  ['--accent-fg', '--accent', 'button text on accent'],
  ['--accent', '--bg', 'accent on bg'],
  ['--danger', '--bg', 'danger on bg'],
  ['--status-candidate', '--bg', 'status-candidate on bg'],
  ['--status-approved', '--bg', 'status-approved on bg'],
  ['--status-forbidden', '--bg', 'status-forbidden on bg'],
  ['--status-candidate', '--surface', 'status-candidate on surface'],
  ['--status-approved', '--surface', 'status-approved on surface'],
  ['--status-forbidden', '--surface', 'status-forbidden on surface'],
  ['--danger', '--surface', 'danger on surface'],
  ['--accent', '--surface', 'accent on surface'],
  ...hits.map((h): [string, string, string] => [`--hit-${h}-fg`, `--hit-${h}-bg`, `hit-${h}`]),
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme contrast', (_name, t) => {
  it.each(pairs)('%s on %s (%s) >= 4.5', (fg, bg) => {
    expect(t[fg], fg).toBeDefined();
    expect(t[bg], bg).toBeDefined();
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('prefers-color-scheme block mirrors the dark theme', () => {
  it('has identical values', () => {
    const explicit = vars(css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)![1]);
    expect(mediaDark).toEqual(explicit);
  });
});

describe.each([
  ['light', light],
  ['dark', dark],
])('%s hit hue mapping', (_name, t) => {
  const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  it('equiv is green', () => {
    for (const k of ['--hit-equiv-bg', '--hit-equiv-fg']) {
      const { r, g, b } = rgb(t[k]);
      expect(g, k).toBeGreaterThan(r);
      expect(g, k).toBeGreaterThan(b);
    }
  });
  it('term is blue', () => {
    for (const k of ['--hit-term-bg', '--hit-term-fg']) {
      const { r, g, b } = rgb(t[k]);
      expect(b, k).toBeGreaterThan(r);
      expect(b, k).toBeGreaterThan(g);
    }
  });
});
