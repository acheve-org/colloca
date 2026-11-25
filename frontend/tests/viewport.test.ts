import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (e: { matches: boolean }) => void;

function mockMatchMedia(initial: Record<string, boolean>) {
  const listeners: Record<string, Listener[]> = {};
  const state = { ...initial };
  window.matchMedia = ((q: string) => ({
    get matches() {
      return state[q] ?? false;
    },
    media: q,
    addEventListener: (_: string, l: Listener) => (listeners[q] ??= []).push(l),
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  return {
    set(q: string, matches: boolean) {
      state[q] = matches;
      listeners[q]?.forEach((l) => l({ matches }));
    },
  };
}

afterEach(() => {
  // @ts-expect-error restore jsdom (no matchMedia)
  delete window.matchMedia;
  vi.resetModules();
});

describe('viewport', () => {
  it('is false/false without matchMedia', async () => {
    const { viewport } = await import('../src/lib/viewport.svelte');
    expect(viewport.narrow).toBe(false);
    expect(viewport.stacked).toBe(false);
  });

  it('follows matchMedia and its change events', async () => {
    const mm = mockMatchMedia({ '(max-width: 639px)': true, '(max-width: 899px)': true });
    const { viewport } = await import('../src/lib/viewport.svelte');
    expect(viewport.narrow).toBe(true);
    expect(viewport.stacked).toBe(true);
    mm.set('(max-width: 639px)', false);
    expect(viewport.narrow).toBe(false);
    expect(viewport.stacked).toBe(true);
    mm.set('(max-width: 899px)', false);
    expect(viewport.stacked).toBe(false);
  });

  it('can be overridden for tests', async () => {
    const { viewport, __setViewportForTests } = await import('../src/lib/viewport.svelte');
    __setViewportForTests({ narrow: true });
    expect(viewport.narrow).toBe(true);
    expect(viewport.stacked).toBe(false);
    __setViewportForTests({ narrow: false, stacked: true });
    expect(viewport.narrow).toBe(false);
    expect(viewport.stacked).toBe(true);
  });
});
