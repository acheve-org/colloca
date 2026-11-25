import { describe, expect, it } from 'vitest';

// jsdom cannot lay out, so the rule is asserted in the component source.
const src = import.meta.glob('../src/lib/ui/DetailStrip.svelte', { query: '?raw', import: 'default', eager: true });
const css = Object.values(src)[0] as string;
const rule = (selector: string) => css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('DetailStrip actions', () => {
  it('lets a button label wrap onto two lines: no nowrap, height auto, token padding', () => {
    const body = rule('\\.actions :global\\(button\\)');
    expect(body).not.toBe('');
    expect(body).not.toMatch(/white-space:\s*nowrap/);
    expect(body).toMatch(/height:\s*auto/);
    expect(body).toMatch(/padding:\s*var\(--s-1\)/);
  });

  it('keeps the actions row wrapping below the title on phones', () => {
    expect(rule('\\.actions')).toMatch(/flex-wrap:\s*wrap/);
  });
});
