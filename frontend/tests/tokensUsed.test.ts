import { describe, expect, it } from 'vitest';

const files = import.meta.glob('../src/**/*.{svelte,css}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGB = /\brgba?\(/;
const FONT_SIZE = /font-size:\s*[0-9.]+(px|rem|em)\b/;
const LITERAL_OK = /\/\*\s*literal:\s*\S.*\*\//;

function offenders(test: (line: string) => boolean): string[] {
  const out: string[] = [];
  for (const [path, src] of Object.entries(files)) {
    if (path.endsWith('/tokens.css')) continue;
    src.split('\n').forEach((line, i) => {
      if (test(line) && !LITERAL_OK.test(line)) out.push(`${path}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

describe('components use tokens, not literals', () => {
  it('scans some files', () => {
    expect(Object.keys(files).length).toBeGreaterThan(20);
  });
  it('has no literal colours (hex, rgb, rgba) without a literal: comment', () => {
    expect(offenders((l) => HEX.test(l) || RGB.test(l))).toEqual([]);
  });
  it('has no literal font-size without a literal: comment', () => {
    expect(offenders((l) => FONT_SIZE.test(l))).toEqual([]);
  });
});
