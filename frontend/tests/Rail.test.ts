import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Rail from '../src/lib/ui/Rail.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { route } from '../src/lib/router.svelte';

afterEach(() => {
  corpusStore.aligned = false;
  route.screen = 'sources';
});

describe('Rail', () => {
  it('is a nav landmark with the spec groups in order', () => {
    render(Rail);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    const links = screen.getAllByRole('link').map((a) => a.textContent?.trim());
    expect(links).toEqual([
      'Sources', 'Base corpora', 'Concordance', 'Collocations', 'N-grams', 'Frequency',
      'Keyness', 'Word cloud', 'Termbase', 'Job analysis',
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
    const { rerender } = render(Rail);
    expect(screen.queryByRole('link', { name: 'Equivalents' })).toBeNull();
    corpusStore.aligned = true;
    await rerender({});
    expect(screen.getByRole('link', { name: 'Equivalents' })).toBeInTheDocument();
  });

  it('theme toggle in the footer switches mode', async () => {
    render(Rail);
    const dark = screen.getByRole('button', { name: 'Dark' });
    await fireEvent.click(dark);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(dark).toHaveAttribute('aria-pressed', 'true');
  });
});
