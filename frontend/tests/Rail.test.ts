import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Rail from '../src/lib/ui/Rail.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { route, go } from '../src/lib/router.svelte';

afterEach(() => {
  corpusStore.aligned = false;
  corpusStore.loaded = false;
  go('sources');
});

describe('Rail', () => {
  it('is a nav landmark with the five areas in order', () => {
    render(Rail);
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    const links = screen.getAllByRole('link').map((a) => a.textContent?.trim());
    expect(links).toEqual(['Corpus', 'Explore', 'Terms', 'Job', 'Settings']);
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });

  it('every rail entry has an accessible name and a visible label', () => {
    render(Rail);
    for (const name of ['Corpus', 'Explore', 'Terms', 'Job', 'Settings']) {
      const link = screen.getByRole('link', { name });
      expect(link.textContent?.trim()).toBe(name);
      expect(link).toHaveAttribute('title', name);
      expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.getByRole('button', { name: 'Menu' }).textContent?.trim()).toBe('Menu');
  });

  it('does not keep reloading language names for a code the API lacks', async () => {
    const f = vi.fn(async (u: string) => ({
      ok: true, status: 200, statusText: 'OK',
      json: async () => (String(u) === '/api/languages' ? { es: 'Spanish' } : []),
    }));
    vi.stubGlobal('fetch', f);
    corpusStore.list = [{ id: 1, name: 'a', lang: 'zz', project_id: null, is_reference: 0, docs: 1, tokens: 1 }];
    corpusStore.currentId = 1;
    render(Rail);
    await new Promise((r) => setTimeout(r, 50));
    const n = f.mock.calls.filter((c) => String(c[0]) === '/api/languages').length;
    await new Promise((r) => setTimeout(r, 50));
    expect(f.mock.calls.filter((c) => String(c[0]) === '/api/languages').length).toBe(n);
    expect(n).toBeLessThanOrEqual(2);
    corpusStore.currentId = null;
    vi.unstubAllGlobals();
  });

  it('marks only the active area with aria-current', () => {
    route.screen = 'keyness';
    render(Rail);
    const current = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Explore');
  });

  it('an area links to its last used screen with its last search', () => {
    go('concordance', { q: 'x' });
    go('termbase');
    render(Rail);
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '#/concordance?q=x');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '#/termbase');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/languages');
  });

  describe('Equivalents redirect', () => {
    it('keeps a deep link while loading, then while aligned turns true', async () => {
      go('equivalents');
      render(Rail);
      await tick();
      expect(route.screen).toBe('equivalents');
      corpusStore.aligned = true;
      corpusStore.loaded = true;
      await tick();
      expect(route.screen).toBe('equivalents');
    });

    it('redirects to concordance once loaded with aligned=false', async () => {
      go('equivalents');
      render(Rail);
      corpusStore.loaded = true;
      await tick();
      expect(route.screen).toBe('concordance');
    });

    it('redirects after switching to a non-aligned corpus', async () => {
      vi.stubGlobal('fetch', vi.fn(async (u: string) => ({
        ok: true, status: 200, statusText: 'OK',
        json: async () => (String(u) === '/api/projects' ? [] : { documents: String(u).includes('/1/') ? 2 : 0, segments: 0, partners: [] }),
      })));
      corpusStore.list = [
        { id: 1, name: 'a', lang: 'es', project_id: null, is_reference: 0, docs: 1, tokens: 1 },
        { id: 2, name: 'b', lang: 'es', project_id: null, is_reference: 0, docs: 1, tokens: 1 },
      ];
      await corpusStore.select(1);
      go('equivalents');
      render(Rail);
      await tick();
      expect(route.screen).toBe('equivalents');
      await corpusStore.select(2);
      await tick();
      expect(route.screen).toBe('concordance');
      vi.unstubAllGlobals();
    });
  });
});
