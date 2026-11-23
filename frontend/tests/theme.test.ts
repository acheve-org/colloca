import { beforeEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  return await import('../src/lib/theme.svelte');
}

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('setMode("dark") sets data-theme and stores it', async () => {
    const { theme, setMode } = await load();
    setMode('dark');
    expect(theme.mode).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('colloca.theme')).toBe('dark');
  });

  it('setMode("auto") removes the attribute', async () => {
    const { setMode } = await load();
    setMode('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    setMode('auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('colloca.theme')).toBe('auto');
  });

  it('reads the initial mode from storage and applies it', async () => {
    localStorage.setItem('colloca.theme', 'dark');
    const { theme } = await load();
    expect(theme.mode).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('falls back to auto for missing or invalid storage', async () => {
    localStorage.setItem('colloca.theme', 'purple');
    const { theme } = await load();
    expect(theme.mode).toBe('auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
