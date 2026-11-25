import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import tableSrc from '../src/lib/ui/DataTable.svelte?raw';
import css from '../src/lib/styles/tokens.css?raw';
import baseCss from '../src/lib/styles/base.css?raw';

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
  ['--fg', '--panel', 'fg on panel'],
  ['--muted', '--panel', 'muted on panel'],
  ['--accent', '--panel', 'accent on panel'],
  ['--danger', '--panel', 'danger on panel'],
  ['--fg', '--accent-soft', 'fg on accent-soft'],
  ['--status-candidate', '--accent-soft', 'status-candidate on accent-soft'],
  ['--status-approved', '--accent-soft', 'status-approved on accent-soft'],
  ['--status-forbidden', '--accent-soft', 'status-forbidden on accent-soft'],
  ['--accent', '--accent-soft', 'accent on accent-soft'],
  ['--muted', '--accent-soft', 'muted on accent-soft'],
  ['--danger', '--accent-soft', 'danger on accent-soft'],
  ['--rail-fg', '--rail-bg', 'rail text on rail'],
  ['--rail-muted', '--rail-bg', 'rail muted on rail'],
  ['--rail-fg', '--rail-hover', 'rail text on rail hover'],
  ['--rail-muted', '--rail-hover', 'rail muted on rail hover'],
  ['--rail-accent', '--rail-bg', 'rail accent on rail'],
  ['--rail-bg', '--rail-accent', 'brand letter on the accent tile'],
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

const lightBlock = css.match(/:root\s*\{([^}]*)\}/)![1];
const darkBlock = css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)![1];

describe('panel, accent-soft and radius tokens', () => {
  it('the light block defines --panel, --accent-soft and --radius-lg', () => {
    expect(lightBlock).toMatch(/--panel:\s*#[0-9a-fA-F]{6};/);
    expect(lightBlock).toMatch(/--accent-soft:\s*#[0-9a-fA-F]{6};/);
    expect(lightBlock).toMatch(/--radius-lg:\s*8px;/);
  });
  it('the dark block defines --panel and --accent-soft', () => {
    expect(darkBlock).toMatch(/--panel:\s*#[0-9a-fA-F]{6};/);
    expect(darkBlock).toMatch(/--accent-soft:\s*#[0-9a-fA-F]{6};/);
  });
});

describe('type scale and density', () => {
  it('the light block sets --fs-base 14px, --fs-small 12.5px and --row-h 32px', () => {
    expect(lightBlock).toMatch(/--fs-base:\s*14px;/);
    expect(lightBlock).toMatch(/--fs-small:\s*12\.5px;/);
    expect(lightBlock).toMatch(/--row-h:\s*32px;/);
  });
  it('the light block sets --radius 6px and the page and gap tokens', () => {
    expect(lightBlock).toMatch(/--radius:\s*6px;/);
    expect(lightBlock).toMatch(/--page-pad:\s*20px;/);
    expect(lightBlock).toMatch(/--gap:\s*14px;/);
  });
});

describe('base.css heading scale and controls', () => {
  it('h1 is 20px, h2 is 16px, and headings are weight 650', () => {
    expect(baseCss).toMatch(/h1\s*\{\s*font-size:\s*var\(--fs-h1\);\s*\}/);
    expect(baseCss).toMatch(/h2\s*\{\s*font-size:\s*var\(--fs-h2\);\s*\}/);
    expect(lightBlock).toMatch(/--fs-h1:\s*20px;/);
    expect(lightBlock).toMatch(/--fs-h2:\s*16px;/);
    expect(baseCss).toMatch(/h1,\s*h2,\s*h3\s*\{[^}]*font-weight:\s*650;/);
  });
  it('inputs and buttons take the --panel background', () => {
    expect(baseCss).toMatch(/button,\s*input,\s*select,\s*textarea\s*\{[^}]*background:\s*var\(--panel\)/);
    expect(baseCss).toMatch(/^button\s*\{[^}]*background:\s*var\(--panel\)/m);
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

describe('status badges on a selected DataTable row', () => {
  it('sit on a panel pill (status colours reach 4.5:1 on --panel in both themes)', () => {
    expect(tableSrc).toMatch(/\.body\.selected :global\(\.badge\)\s*\{[^}]*background:\s*var\(--panel\)/);
    for (const t of [light, dark]) {
      for (const k of ['--status-candidate', '--status-approved', '--status-forbidden']) {
        expect(contrast(t[k], t['--panel'])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

// docs/accessibility.md lists the ratios measured here; it is generated, so it cannot drift from tokens.css.
// vitest runs from frontend/, so the docs folder is one level up.
const DOC = resolve(process.cwd(), '..', 'docs', 'accessibility.md');
const MARK = '<!-- contrast-table -->';

function ratioTable(): string {
  const row = (fg: string, bg: string, what: string) => {
    const l = contrast(light[fg], light[bg]);
    const d = contrast(dark[fg], dark[bg]);
    const mark = (r: number) => (r >= 7 ? `${r.toFixed(2)} (AAA)` : r >= 4.5 ? `${r.toFixed(2)} (AA)` : `${r.toFixed(2)} (fails)`);
    return `| ${what} | \`${fg}\` on \`${bg}\` | ${mark(l)} | ${mark(d)} |`;
  };
  return [
    '| Pair | Tokens | Light | Dark |',
    '|---|---|---|---|',
    ...pairs.map(([fg, bg, what]) => row(fg, bg, what)),
  ].join('\n');
}

describe('docs/accessibility.md', () => {
  it('shows the contrast ratios of tokens.css (run `UPDATE_DOCS=1 npx vitest run contrast` after changing colours)', () => {
    const doc = readFileSync(DOC, 'utf8');
    const [head, , tail] = doc.split(MARK);
    const next = `${head}${MARK}\n${ratioTable()}\n${MARK}${tail}`;
    if (process.env.UPDATE_DOCS) writeFileSync(DOC, next);
    else expect(doc).toBe(next);
  });
});
