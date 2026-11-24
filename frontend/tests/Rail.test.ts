import { fireEvent, render, screen } from '@testing-library/svelte';
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
  it('is a nav landmark with the spec groups in order', () => {
    render(Rail);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    const links = screen.getAllByRole('link').map((a) => a.textContent?.trim());
    expect(links).toEqual([
      'Sources', 'Base corpora', 'Concordance', 'Collocations', 'N-grams', 'Frequency list',
      'Keyness', 'Word cloud', 'Termbase', 'Check text', 'Job',
    ]);
  });

  it('marks only the active route with aria-current', () => {
    route.screen = 'keyness';
    render(Rail);
    const current = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Keyness');
  });

  it('hides Equivalents unless the corpus is aligned', async () => {
    render(Rail);
    expect(screen.queryByRole('link', { name: 'Equivalents' })).toBeNull();
    corpusStore.aligned = true;
    await tick();
    expect(screen.getByRole('link', { name: 'Equivalents' })).toBeInTheDocument();
  });

  it('links each screen with the params it was last on', async () => {
    go('concordance', { q: 'x' });
    go('termbase');
    render(Rail);
    expect(screen.getByRole('link', { name: 'Concordance' })).toHaveAttribute('href', '#/concordance?q=x');
    expect(screen.getByRole('link', { name: 'Keyness' })).toHaveAttribute('href', '#/keyness');
    go('concordance', { q: 'y' });
    await tick();
    expect(screen.getByRole('link', { name: 'Concordance' })).toHaveAttribute('href', '#/concordance?q=y');
  });

  it('theme toggle in the footer switches mode', async () => {
    render(Rail);
    const dark = screen.getByRole('button', { name: 'Dark' });
    await fireEvent.click(dark);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(dark).toHaveAttribute('aria-pressed', 'true');
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
