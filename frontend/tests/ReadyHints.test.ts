import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { corpusStore } from '../src/lib/corpus.svelte';
import { messages } from '../src/lib/messages.svelte';
import { route } from '../src/lib/router.svelte';
import Collocations from '../src/screens/Collocations.svelte';
import Concordance from '../src/screens/Concordance.svelte';
import Dispersion from '../src/screens/Dispersion.svelte';
import Frequency from '../src/screens/Frequency.svelte';
import Job from '../src/screens/Job.svelte';
import Keyness from '../src/screens/Keyness.svelte';
import Ngrams from '../src/screens/Ngrams.svelte';
import Related from '../src/screens/Related.svelte';
import WordCloud from '../src/screens/WordCloud.svelte';

interface Case {
  name: string;
  comp: Component;
  title: string;
  run: string;
  input?: [label: string, value: string];
  path: string;
  body: unknown;
}

const CASES: Case[] = [
  { name: 'Frequency', comp: Frequency as never, title: 'Word frequencies', run: 'Show', path: '/frequency', body: [] },
  { name: 'Collocations', comp: Collocations as never, title: 'Find collocations', run: 'Find',
    input: ['Node word (lemma)', 'casa'], path: '/collocations', body: { node_freq: 1, rows: [] } },
  { name: 'N-grams', comp: Ngrams as never, title: 'Recurring word sequences', run: 'Show', path: '/ngrams', body: [] },
  { name: 'Dispersion', comp: Dispersion as never, title: 'Where does a word occur?', run: 'Plot',
    input: ['Word or phrase', 'casa'], path: '/dispersion', body: { total: 0, range: 0, docs: [] } },
  { name: 'Word cloud', comp: WordCloud as never, title: 'Word cloud', run: 'Draw', path: '/frequency', body: [] },
  { name: 'Related', comp: Related as never, title: 'Terms that keep similar company', run: 'Find',
    input: ['Word (lemma)', 'gato'], path: '/related',
    body: { query: 'gato', sources: { corpus: { trained: true, known: true, small: false, tokens: 1, vocabulary: 1 } }, related: { corpus: [] } } },
  { name: 'Concordance', comp: Concordance as never, title: 'Search the corpus', run: 'Search',
    input: ['Word or phrase', 'casa'], path: '/concordance', body: { total: 0, lines: [] } },
];

let mode: 'ok' | 'fail' | 'hang';
let release: () => void;
let calls: string[];

beforeEach(() => {
  mode = 'ok';
  calls = [];
  route.params = {};
  corpusStore.list = [{ id: 1, name: 'ES', lang: 'es', project_id: null, is_reference: 0, docs: 2, tokens: 10 } as never];
  corpusStore.currentId = 1;
  corpusStore.loaded = true;
  corpusStore.clearScope();
  messages.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    const json = (status: number, b: unknown) =>
      new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    const u = String(url);
    if (u.endsWith('/facets')) return json(200, { tags: [], text_types: [], date_min: '', date_max: '' });
    if (u.endsWith('/scope')) return json(200, { filtered: false, docs: 2, words: 10, total_docs: 2, total_words: 10 });
    const c = CASES.find((x) => u.includes(`/api/corpora/1${x.path}`));
    if (!c) return json(200, []);
    if (mode === 'hang') await new Promise<void>((r) => (release = r));
    if (mode === 'fail') return json(500, { detail: 'boom' });
    return json(200, c.body);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const runBtn = (c: Case) => screen.getByRole('button', { name: c.run });
async function start(c: Case): Promise<void> {
  render(c.comp);
  if (c.input) await fireEvent.input(screen.getByLabelText(c.input[0]), { target: { value: c.input[1] } });
}
const hint = (c: Case) => screen.queryByText(c.title);

describe.each(CASES)('$name ready hint', (c) => {
  it('shows a quiet left-aligned hint and rings the run button', async () => {
    await start(c);
    const h = hint(c)!;
    expect(h).toBeInTheDocument();
    expect(h.closest('.ready')).not.toBeNull();
    expect(h.closest('[role]')).toBeNull();
    expect(runBtn(c)).toHaveClass('pending');
  });

  it('drops the hint and the ring once a run produced a result', async () => {
    await start(c);
    await fireEvent.click(runBtn(c));
    await waitFor(() => expect(hint(c)).toBeNull());
    expect(runBtn(c)).not.toHaveClass('pending');
  });

  it('shows neither while the run is loading', async () => {
    mode = 'hang';
    await start(c);
    await fireEvent.click(runBtn(c));
    await waitFor(() => expect(runBtn(c)).not.toHaveClass('pending'));
    expect(hint(c)).toBeNull();
    release();
  });

  it('takes the ring away after a failed run', async () => {
    mode = 'fail';
    await start(c);
    await fireEvent.click(runBtn(c));
    await waitFor(() => expect(messages.current?.text).toBe('boom'));
    expect(runBtn(c)).not.toHaveClass('pending');
  });
});

describe('Keyness', () => {
  it('shows the hint and the ring before a comparison', () => {
    render(Keyness);
    expect(screen.getByText('Compare with a reference corpus').closest('.ready')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Compare' })).toHaveClass('pending');
  });
});

describe('Frequency chips', () => {
  const freqCall = () => calls.find((u) => u.includes('/frequency'))!;

  it('offers three chips', async () => {
    render(Frequency);
    for (const n of ['word forms', 'only nouns', 'with stopwords']) {
      expect(screen.getByRole('button', { name: n })).toBeInTheDocument();
    }
  });

  it('word forms runs with unit=form and updates the toolbar', async () => {
    render(Frequency);
    await fireEvent.click(screen.getByRole('button', { name: 'word forms' }));
    await waitFor(() => expect(freqCall()).toBeTruthy());
    expect(freqCall()).toContain('unit=form');
    expect((screen.getByLabelText('Unit') as HTMLSelectElement).value).toBe('form');
  });

  it('only nouns runs with pos=NOUN and fills the POS field', async () => {
    render(Frequency);
    await fireEvent.click(screen.getByRole('button', { name: 'only nouns' }));
    await waitFor(() => expect(freqCall()).toBeTruthy());
    expect(freqCall()).toContain('pos=NOUN');
    expect(screen.getByLabelText('POS')).toHaveValue('NOUN');
  });

  it('with stopwords runs with exclude_stop=false and unticks the toggle', async () => {
    render(Frequency);
    await fireEvent.click(screen.getByRole('button', { name: 'with stopwords' }));
    await waitFor(() => expect(freqCall()).toBeTruthy());
    expect(freqCall()).toContain('exclude_stop=false');
    expect(screen.getByLabelText('Hide stopwords')).not.toBeChecked();
  });
});

describe('Job', () => {
  it('rings the Analyse button until there is a report', () => {
    render(Job);
    expect(screen.getByText('No analysis yet').closest('.ready')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Analyse' })).toHaveClass('pending');
  });
});
