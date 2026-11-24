import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CheckText from '../src/screens/CheckText.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';

describe('CheckText', () => {
  let calls: { url: string; body: Record<string, unknown> }[];
  let languages: Record<string, string>;
  beforeEach(() => {
    calls = [];
    languages = { es: 'Spanish', it: 'Italian' };
    corpusStore.list = [{ id: 7, name: 'c', lang: 'es' } as never];
    corpusStore.currentId = 7;
    corpusStore.loaded = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/languages')) return new Response(JSON.stringify(languages), { status: 200, headers: { 'content-type': 'application/json' } });
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({
        lang: 'it',
        lines: [{ text: 'Il contratto e l’accordo.', marks: [
          { start: 3, end: 12, kind: 'term', term: 'contratto', of: 'contrato', translations: [], forbidden: [], ids: [1] },
          { start: 17, end: 24, kind: 'forbidden', term: 'accordo', of: 'contrato', translations: ['contratto'], forbidden: [], ids: [2] },
        ] }],
        summary: { hits: 1, forbidden: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('checks a draft translation and shows approved and forbidden terms with non-colour cues', async () => {
    render(CheckText);
    await screen.findByRole('option', { name: 'A draft translation (it)' });
    await fireEvent.change(screen.getByLabelText('The text is'), { target: { value: 'draft:it' } });
    await fireEvent.input(screen.getByLabelText('Text to check'), { target: { value: 'Il contratto e l’accordo.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(screen.getByText('1 termbase hits, 1 forbidden translations')).toBeInTheDocument());
    expect(calls[0].url).toContain('/api/corpora/7/check-text');
    expect(calls[0].body).toEqual({ text: 'Il contratto e l’accordo.', lang: 'it' });
    const ok = document.querySelector('.hit-term');
    const bad = document.querySelector('.hit-forbidden');
    expect(ok?.textContent).toBe('contratto');
    expect(bad?.textContent).toBe('accordo');
    expect(bad).toHaveAttribute('title', 'Forbidden translation: “accordo”. Use: contratto');
  });

  it('offers a draft of every other language that is set up, not a fixed pair', async () => {
    languages = { es: 'Spanish', it: 'Italian', fr: 'French' };
    render(CheckText);
    await screen.findByRole('option', { name: 'A draft translation (fr)' });
    expect(screen.getByRole('option', { name: 'A draft translation (it)' })).toBeInTheDocument();
    await fireEvent.change(screen.getByLabelText('The text is'), { target: { value: 'draft:fr' } });
    await fireEvent.input(screen.getByLabelText('Text to check'), { target: { value: 'Le contrat.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ text: 'Le contrat.', lang: 'fr' });
  });

  it('offers no draft when the corpus language is the only one', async () => {
    languages = { es: 'Spanish' };
    render(CheckText);
    await waitFor(() => expect(screen.getByRole('option', { name: 'A source segment (es)' })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: /A draft translation/ })).toBeNull();
  });

  it('asks for text first', async () => {
    render(CheckText);
    await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(calls).toHaveLength(0);
  });
});
