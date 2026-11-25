import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CORPUS_CHANGED, corpusStore } from '../src/lib/corpus.svelte';
import { setLang } from '../src/lib/i18n';
import { go } from '../src/lib/router.svelte';
import { scopeView } from '../src/lib/scope.svelte';
import ScopeControl from '../src/lib/ui/ScopeControl.svelte';

type Reply = { ok: boolean; body: unknown };
let replies: Record<string, (url: string) => Reply>;
let calls: string[];

const facets = {
  tags: [{ tag: 'wind', docs: 3 }, { tag: 'solar', docs: 2 }],
  text_types: [{ text_type: 'news', docs: 4 }, { text_type: 'law', docs: 1 }],
  date_min: '2001',
  date_max: '2023',
};
const filtered = { filtered: true, docs: 5, total_docs: 12, words: 20244, total_words: 48200 };
const unfiltered = { filtered: false, docs: 12, total_docs: 12, words: 48200, total_words: 48200 };

beforeEach(() => {
  calls = [];
  replies = {
    '/api/corpora/1/facets': () => ({ ok: true, body: facets }),
    '/api/corpora/1/scope': (u) => ({ ok: true, body: /tags|text_type|date/.test(u) ? filtered : unfiltered }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const r = (replies[url.split('?')[0]] ?? (() => ({ ok: true, body: {} })))(url);
      return { ok: r.ok, status: r.ok ? 200 : 400, statusText: 'Bad', json: async () => r.body };
    }),
  );
  corpusStore.currentId = 1;
  corpusStore.clearScope();
  scopeView.facets = { tags: [], text_types: [], date_min: '', date_max: '' };
  scopeView.info = null;
  scopeView.error = '';
});
afterEach(() => {
  setLang('en');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const pill = () => screen.getAllByRole('button').find((b) => b.hasAttribute('aria-expanded')) as HTMLElement;
const openPanel = async () => {
  await fireEvent.click(pill());
  return screen.getByRole('group', { name: 'Scope: which documents?' });
};
const type = async (label: string, value: string) => {
  await fireEvent.input(screen.getByLabelText(label), { target: { value } });
};

describe('ScopeControl', () => {
  it('focuses the Tags field right after the pill is clicked and keeps the panel open', async () => {
    render(ScopeControl);
    await fireEvent.click(pill());
    await waitFor(() => expect(screen.getByLabelText('Tags')).toHaveFocus());
    expect(screen.getByRole('group', { name: 'Scope: which documents?' })).toBeInTheDocument();
    expect(pill()).toHaveAttribute('aria-expanded', 'true');
  });

  it('reloads facets and the summary when the panel opens', async () => {
    render(ScopeControl);
    await waitFor(() => expect(pill().className).not.toMatch(/muted/));
    calls.length = 0;
    await openPanel();
    await waitFor(() => {
      expect(calls.some((c) => c.includes('/facets'))).toBe(true);
      expect(calls.some((c) => c.includes('/scope'))).toBe(true);
    });
  });

  it('gives the pill a Document filter accessible name', async () => {
    render(ScopeControl);
    expect(pill()).toHaveAccessibleName('Document filter: All documents');
    await openPanel();
    await type('Tags', 'wind');
    await waitFor(() => expect(pill()).toHaveAccessibleName('Document filter: 5 of 12 documents'));
  });

  it('reads All documents, muted, before the first summary, with no chips', async () => {
    replies['/api/corpora/1/scope'] = () => new Promise(() => {}) as never;
    render(ScopeControl);
    expect(pill()).toHaveTextContent('All documents');
    expect(pill().className).toMatch(/muted/);
    expect(document.querySelector('.chip')).toBeNull();
  });

  it('is not muted once the summary arrived', async () => {
    render(ScopeControl);
    await waitFor(() => expect(pill().className).not.toMatch(/muted/));
    expect(pill()).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows a tags chip and the summary after typing', async () => {
    render(ScopeControl);
    await openPanel();
    expect(pill()).toHaveAttribute('aria-expanded', 'true');
    await type('Tags', 'wind');
    expect(screen.getByText('Tags: wind')).toBeInTheDocument();
    await waitFor(() => expect(pill()).toHaveTextContent('5 of 12 documents'));
    expect(screen.getByText(/5 of 12 documents · 20,?244 of 48,?200 words/)).toBeInTheDocument();
  });

  it('closes the panel when the screen changes', async () => {
    go('concordance');
    render(ScopeControl);
    await openPanel();
    go('keyness');
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Scope: which documents?' })).toBeNull());
    go('sources');
  });

  it('removes a part through its chip', async () => {
    render(ScopeControl);
    await openPanel();
    await type('Tags', 'wind');
    await fireEvent.click(screen.getByRole('button', { name: 'Remove Tags: wind' }));
    expect(corpusStore.scope.tags).toBe('');
    expect(screen.queryByText('Tags: wind')).toBeNull();
    expect(pill()).toHaveFocus();
  });

  it('lists the facet types with counts and filters by the chosen one', async () => {
    render(ScopeControl);
    await openPanel();
    await waitFor(() => expect(screen.getByRole('option', { name: 'news (4)' })).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'any' })).toBeInTheDocument();
    await fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'news' } });
    expect(screen.getByText('Type: news')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.includes('/scope') && c.includes('text_type=news'))).toBe(true));
  });

  it('shows an open-ended date chip', async () => {
    render(ScopeControl);
    await openPanel();
    await type('From', '2022');
    expect(screen.getByText('2022–…')).toBeInTheDocument();
  });

  it('uses the facet dates as placeholders and lists tags in the datalist', async () => {
    render(ScopeControl);
    await openPanel();
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveAttribute('placeholder', '2001'));
    expect(screen.getByLabelText('To')).toHaveAttribute('placeholder', '2023');
    const opts = [...document.querySelectorAll('datalist option')];
    expect(opts.map((o) => o.getAttribute('value'))).toEqual(['wind', 'solar']);
    expect(opts[0].textContent).toBe('3 docs');
  });

  it('Clear empties the scope and disappears when nothing is active', async () => {
    render(ScopeControl);
    await openPanel();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    await type('Tags', 'wind');
    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(corpusStore.scope.tags).toBe('');
    expect(document.querySelector('.chip')).toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull());
  });

  it('Done closes the panel and focuses the pill', async () => {
    render(ScopeControl);
    await openPanel();
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('group', { name: 'Scope: which documents?' })).toBeNull();
    expect(pill()).toHaveFocus();
  });

  it('Escape closes the panel and focuses the pill', async () => {
    render(ScopeControl);
    await openPanel();
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Scope: which documents?' })).toBeNull();
    expect(pill()).toHaveFocus();
  });

  it('an outside press closes the panel', async () => {
    render(ScopeControl);
    await openPanel();
    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'Scope: which documents?' })).toBeNull();
  });

  it('shows the error in the panel while the pill still reads All documents', async () => {
    replies['/api/corpora/1/scope'] = () => ({ ok: false, body: { detail: 'scope broke' } });
    render(ScopeControl);
    await openPanel();
    await waitFor(() => expect(screen.getByText('scope broke')).toBeInTheDocument());
    expect(pill()).toHaveTextContent('All documents');
  });

  it('a corpus change resets pill and chips and keeps the panel open', async () => {
    render(ScopeControl);
    await openPanel();
    await type('Tags', 'wind');
    await waitFor(() => expect(pill()).toHaveTextContent('5 of 12 documents'));
    corpusStore.clearScope();
    window.dispatchEvent(new Event(CORPUS_CHANGED));
    await waitFor(() => expect(pill()).toHaveTextContent('All documents'));
    expect(document.querySelector('.chip')).toBeNull();
    expect(screen.getByRole('group', { name: 'Scope: which documents?' })).toBeInTheDocument();
  });
});
