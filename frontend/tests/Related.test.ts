import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Related from '../src/screens/Related.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { messages } from '../src/lib/messages.svelte';
import { go } from '../src/lib/router.svelte';
import { termStore } from '../src/lib/term.svelte';
import type { RelatedResult } from '../src/lib/types';

const RESULT: RelatedResult = {
  query: 'gato',
  sources: { corpus: { trained: true, known: true, small: true, tokens: 5200, vocabulary: 310 } },
  related: { corpus: [
    { item: 'perro', pos: 'NOUN', similarity: 0.93, freq: 120 },
    { item: 'caballo', pos: 'NOUN', similarity: 0.88, freq: 80 },
  ] },
};

let calls: string[];
let reply: RelatedResult;

beforeEach(() => {
  calls = [];
  reply = RESULT;
  corpusStore.list = [{ id: 1, name: 'ES', lang: 'es', project_id: null, is_reference: 0, docs: 2, tokens: 10 } as never];
  corpusStore.currentId = 1;
  corpusStore.loaded = true;
  messages.clear();
  termStore.open = false;
  go('related');                                   // (no options left over from another test: they would auto-run)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    const body = String(url).endsWith('/facets') ? { tags: [], text_types: [], date_min: '', date_max: '' }
      : String(url).endsWith('/scope') ? { filtered: false, docs: 2, words: 10, total_docs: 2, total_words: 10 }
      : reply;
    return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.list = [];
  corpusStore.currentId = null;
});

const relatedCalls = () => calls.filter((c) => c.includes('/related'));
const find = () => fireEvent.click(screen.getByRole('button', { name: 'Find' }));

describe('Related', () => {
  it('asks for a word first', async () => {
    render(Related);
    await find();
    await waitFor(() => expect(messages.current?.text).toBe('Type a word (lemma).'));
    expect(relatedCalls()).toHaveLength(0);
  });

  it('asks the corpus source by default and lists the neighbours, labelled as statistical', async () => {
    render(Related);
    await fireEvent.input(screen.getByLabelText('Word (lemma)'), { target: { value: ' gato ' } });
    await find();
    expect(await screen.findByText('perro')).toBeInTheDocument();
    const url = new URL(relatedCalls()[0], 'http://x');
    expect(url.pathname).toBe('/api/corpora/1/related');
    expect(url.searchParams.get('q')).toBe('gato');
    expect(url.searchParams.get('source')).toBe('corpus');
    expect(url.searchParams.get('with_base')).toBe('false');
    expect(screen.getByText(/Related terms \(statistical\)/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Related to “gato” in this corpus' })).toBeInTheDocument();
    expect(screen.getByText('Learned from 5,200 content words (310 words with a vector).')).toBeInTheDocument();
    expect(screen.getByText(/This corpus is small/)).toBeInTheDocument();
    expect(screen.getByText('0.93')).toBeInTheDocument();
  });

  it('sends the source, the part of speech and the base-corpus switch', async () => {
    render(Related);
    await fireEvent.input(screen.getByLabelText('Word (lemma)'), { target: { value: 'gato' } });
    await fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'both' } });
    await fireEvent.input(screen.getByPlaceholderText('NOUN'), { target: { value: 'NOUN' } });
    await fireEvent.click(screen.getByRole('switch', { name: 'add the base corpus' }));
    await find();
    await waitFor(() => expect(relatedCalls()).toHaveLength(1));
    const p = new URL(relatedCalls()[0], 'http://x').searchParams;
    expect([p.get('source'), p.get('pos'), p.get('with_base')]).toEqual(['both', 'NOUN', 'true']);
  });

  it('explains an empty source instead of showing an empty table', async () => {
    reply = {
      query: 'gato',
      sources: { corpus: { trained: true, known: false, small: false, reason: '“gato” is too rare in this corpus to have a vector' },
                 model: { available: false, name: 'es_core_news_sm', known: false, reason: 'The spaCy model in use has no word vectors (use the md or lg model)' } },
      related: { corpus: [], model: [] },
    };
    render(Related);
    await fireEvent.input(screen.getByLabelText('Word (lemma)'), { target: { value: 'gato' } });
    await find();
    expect(await screen.findByText('“gato” is too rare in this corpus to have a vector')).toBeInTheDocument();
    expect(screen.getByText(/no word vectors/)).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('shows the model list with its name and no frequency', async () => {
    reply = {
      query: 'gato',
      sources: { model: { available: true, name: 'es_core_news_lg', known: true } },
      related: { model: [{ item: 'perro', pos: '', similarity: 0.8, freq: null }] },
    };
    render(Related);
    await fireEvent.input(screen.getByLabelText('Word (lemma)'), { target: { value: 'gato' } });
    await fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'model' } });
    await find();
    expect(await screen.findByText('Vectors of the spaCy model es_core_news_lg (general language).')).toBeInTheDocument();
    const row = within(screen.getAllByRole('row').filter((r) => r.classList.contains('body'))[0]);
    expect(row.getByText('perro')).toBeInTheDocument();
  });

  it('+ Term opens the dialog on the suggestion; nothing is saved by looking', async () => {
    render(Related);
    await fireEvent.input(screen.getByLabelText('Word (lemma)'), { target: { value: 'gato' } });
    await find();
    await screen.findByText('perro');
    await fireEvent.click(screen.getAllByRole('button', { name: '+ Term' })[0]);
    expect(termStore.open).toBe(true);
    expect(termStore.draft.src_term).toBe('perro');
    expect(calls.some((c) => c.includes('/api/terms'))).toBe(false);
  });
});
