import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Collocations from '../src/screens/Collocations.svelte';
import Equivalents from '../src/screens/Equivalents.svelte';
import Frequency from '../src/screens/Frequency.svelte';
import Keyness from '../src/screens/Keyness.svelte';
import Ngrams from '../src/screens/Ngrams.svelte';
import WordCloud from '../src/screens/WordCloud.svelte';
import { CORPUS_CHANGED, corpusStore } from '../src/lib/corpus.svelte';
import { messages } from '../src/lib/messages.svelte';
import { go, route } from '../src/lib/router.svelte';
import { termStore } from '../src/lib/term.svelte';

const corpus = (id: number, lang = 'es') => ({
  id, name: `C${id}`, lang, project_id: null, is_reference: 0, docs: 2, tokens: 100,
});

const freqRows = [
  { item: 'casa', pos: 'NOUN', freq: 9, per_million: 90, docs: 2, docs_pct: 100, ref_per_million: 5 },
  { item: 'perro', pos: 'NOUN', freq: 10, per_million: 100, docs: 1, docs_pct: 50, ref_per_million: 6 },
  { item: 'gato', pos: 'NOUN', freq: 100, per_million: 1000, docs: 2, docs_pct: 100, ref_per_million: 7 },
];
const coRows = [
  { item: 'grande', pos: 'ADJ', cooc: 3, freq: 20, docs: 2, logdice: 9.5, mi: 5.1, tscore: 2.1, ll: 12.2 },
  { item: 'vieja', pos: 'ADJ', cooc: 10, freq: 30, docs: 2, logdice: 8.5, mi: 4.1, tscore: 3.1, ll: 22.2 },
];
const ngRows = [
  { item: 'de la casa', freq: 5, docs: 2 },
  { item: 'en el', freq: 12, docs: 1 },
];
const kyRows = [
  { item: 'contrato', pos: 'NOUN', freq: 8, ref_freq: 1, per_million: 80, ref_per_million: 1, log_ratio: 6.3, ll: 40.5, docs: 2 },
  { item: 'cláusula', pos: 'NOUN', freq: 30, ref_freq: 2, per_million: 300, ref_per_million: 2, log_ratio: 7.2, ll: 90.1, docs: 2 },
];
const eqRows = [
  { item: 'house', pos: 'NOUN', cooc: 4, node_segments: 5, target_segments: 9, dice: 0.57, logdice: 11.1 },
  { item: 'home', pos: 'NOUN', cooc: 12, node_segments: 5, target_segments: 40, dice: 0.2, logdice: 9.1 },
];

interface Call { path: string; params: URLSearchParams }
let calls: Call[];
let body: Record<string, { status: number; body: unknown }>;
let hold: Promise<void> | null;

const res = (status: number, b: unknown) => ({
  ok: status < 400, status, statusText: 'x', json: async () => b,
});
const hits = (suffix: string) => calls.filter((c) => c.path.endsWith(`/${suffix}`));

beforeEach(() => {
  calls = [];
  hold = null;
  body = {
    frequency: { status: 200, body: freqRows },
    collocations: { status: 200, body: { node_freq: 42, corpus_size: 1000, rows: coRows } },
    ngrams: { status: 200, body: ngRows },
    keyness: { status: 200, body: kyRows },
    equivalents: { status: 200, body: { node_segments: 5, rows: eqRows } },
  };
  corpusStore.list = [corpus(1), corpus(2), corpus(3, 'it')];
  corpusStore.currentId = 1;
  corpusStore.aligned = true;
  corpusStore.loaded = true;
  corpusStore.clearScope();
  messages.clear();
  termStore.open = false;
  go('frequency');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = new URL(url, 'http://x');
    calls.push({ path: u.pathname, params: u.searchParams });
    const last = u.pathname.split('/').pop() ?? '';
    if (last in body) {
      if (hold) await hold;
      return res(body[last].status, body[last].body);
    }
    if (u.pathname === '/api/references') {
      return res(200, [{ id: 9, name: 'Base ES', lang: 'es', tokens: 5000, docs: 1, is_reference: 1 }]);
    }
    if (last === 'facets') return res(200, { tags: [], text_types: [], date_min: '', date_max: '' });
    if (last === 'scope') return res(200, { filtered: false, docs: 2, words: 100, total_docs: 2, total_words: 100 });
    if (last === 'examples') return res(200, []);
    if (u.pathname === '/api/languages') return res(200, { es: 'Spanish', en: 'English' });
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  corpusStore.list = [];
  corpusStore.currentId = null;
  corpusStore.aligned = false;
  go('frequency');
});

const bodyRows = () => screen.queryAllByRole('row').filter((r) => r.classList.contains('body'));
const firstCol = () => bodyRows().map((r) => r.querySelector('[role=gridcell]')?.textContent?.trim());
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const setNum = (name: RegExp, v: string) =>
  fireEvent.input(screen.getByRole('spinbutton', { name }), { target: { value: v } });
const setText = (name: RegExp, v: string) =>
  fireEvent.input(screen.getByRole('textbox', { name }), { target: { value: v } });

describe('Frequency', () => {
  it('requests /frequency with the toolbar defaults and scope params, and lists the rows', async () => {
    corpusStore.scope.tags = 'law';
    render(Frequency);
    await click('Show');
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    const p = hits('frequency')[0];
    expect(p.path).toBe('/api/corpora/1/frequency');
    expect(p.params.get('unit')).toBe('lemma');
    expect(p.params.get('min_freq')).toBe('2');
    expect(p.params.get('exclude_stop')).toBe('true');
    expect(p.params.get('with_reference')).toBe('false');
    expect(p.params.get('limit')).toBe('1000');
    expect(p.params.get('pos')).toBeNull();
    expect(p.params.get('tags')).toBe('law');
    expect(screen.getByText('3 items')).toBeInTheDocument();
    expect(screen.queryByText('Base per M')).toBeNull();
  });

  it('sends POS, min freq and the reference flag, and shows the base column', async () => {
    render(Frequency);
    await setText(/POS/, 'NOUN,VERB');
    await setNum(/Min freq/, '5');
    await fireEvent.click(screen.getByRole('switch', { name: 'Compare with base corpus' }));
    await click('Show');
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    const p = hits('frequency')[0].params;
    expect(p.get('pos')).toBe('NOUN,VERB');
    expect(p.get('min_freq')).toBe('5');
    expect(p.get('with_reference')).toBe('true');
    expect(screen.getByText('Base per M')).toBeInTheDocument();
  });

  it('links the CSV with the same params', async () => {
    render(Frequency);
    expect(screen.queryByRole('link', { name: 'CSV' })).toBeNull();
    await click('Show');
    const a = await screen.findByRole('link', { name: 'CSV' });
    expect(a.getAttribute('href')).toContain('/api/corpora/1/frequency?');
    expect(a.getAttribute('href')).toContain('format=csv');
  });

  it('goes to the concordance when a word is clicked', async () => {
    render(Frequency);
    await click('Show');
    await fireEvent.click(await screen.findByRole('link', { name: 'casa' }));
    expect(window.location.hash).toBe('#/concordance?q=casa&unit=lemma');
    expect(route.screen).toBe('concordance');
  });

  it('sorts numeric columns numerically', async () => {
    render(Frequency);
    await click('Show');
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    await fireEvent.click(screen.getByRole('columnheader', { name: /^Freq/ }));
    expect(firstCol()).toEqual(['casa', 'perro', 'gato']); // 9 < 10 < 100
    await fireEvent.click(screen.getByRole('columnheader', { name: /^Freq/ }));
    expect(firstCol()).toEqual(['gato', 'perro', 'casa']);
  });

  it('filters the results client-side', async () => {
    render(Frequency);
    await click('Show');
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Filter in results' }), { target: { value: 'per' } });
    expect(firstCol()).toEqual(['perro']);
  });

  it('opens the term dialog for a row', async () => {
    render(Frequency);
    await click('Show');
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    await fireEvent.click(screen.getAllByRole('button', { name: '+ Term' })[0]);
    expect(termStore.open).toBe(true);
    expect(termStore.draft.src_term).toBe('casa');
    expect(termStore.draft.pos).toBe('noun');
    expect(termStore.ctx?.origin).toBe('frequency');
  });

  it('keeps previous rows and the form on an error, and reports it', async () => {
    render(Frequency);
    await setNum(/Min freq/, '4');
    await click('Show');
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    body.frequency = { status: 500, body: { detail: 'boom' } };
    await click('Show');
    await waitFor(() => expect(messages.current).toEqual({ text: 'boom', kind: 'err' }));
    expect(bodyRows()).toHaveLength(3);
    expect((screen.getByRole('spinbutton', { name: /Min freq/ }) as HTMLInputElement).value).toBe('4');
  });

  it('never lets an older response overwrite a newer one, and keeps the button enabled', async () => {
    render(Frequency);
    let release: () => void = () => {};
    hold = new Promise<void>((r) => (release = r));
    body.frequency = { status: 200, body: [freqRows[0]] };
    click('Show');
    await waitFor(() => expect(hits('frequency')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Show' })).toBeEnabled();
    hold = null;
    body.frequency = { status: 200, body: [freqRows[2]] };
    await click('Show');
    await waitFor(() => expect(firstCol()).toEqual(['gato']));
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(firstCol()).toEqual(['gato']);
  });

  it('persists the options in the route only after success', async () => {
    render(Frequency);
    await setText(/POS/, 'NOUN');
    body.frequency = { status: 500, body: { detail: 'boom' } };
    await click('Show');
    await waitFor(() => expect(messages.current?.kind).toBe('err'));
    expect(route.params.pos).toBeUndefined();
    body.frequency = { status: 200, body: freqRows };
    await click('Show');
    await waitFor(() => expect(route.params.pos).toBe('NOUN'));
    expect(route.params.min).toBe('2');
  });

  it('clears results and selection when the corpus changes', async () => {
    render(Frequency);
    await click('Show');
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    await fireEvent.click(bodyRows()[0]);
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
    await waitFor(() => expect(bodyRows()).toHaveLength(0));
    expect(screen.queryByRole('link', { name: 'CSV' })).toBeNull();
  });

  it('clears the "Working…" status when a request is dropped by a corpus change', async () => {
    render(Frequency);
    hold = new Promise<void>(() => {});
    click('Show');
    await waitFor(() => expect(messages.current?.text).toBe('Working…'));
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
    expect(messages.current).toBeNull();
  });

  it('clears the "Working…" status when the screen is left mid-request, but not an error', async () => {
    const { unmount } = render(Frequency);
    hold = new Promise<void>(() => {});
    click('Show');
    await waitFor(() => expect(messages.current?.text).toBe('Working…'));
    unmount();
    expect(messages.current).toBeNull();
    const again = render(Frequency);
    messages.say('boom', 'err');
    again.unmount();
    expect(messages.current).toEqual({ text: 'boom', kind: 'err' });
  });

  it('restores options from the route and runs once the corpus has loaded', async () => {
    corpusStore.loaded = false;
    go('frequency', { unit: 'form', pos: 'VERB', min: '7', stop: '0', ref: '1' });
    render(Frequency);
    await new Promise((r) => setTimeout(r, 10));
    expect(hits('frequency')).toHaveLength(0);
    corpusStore.loaded = true;
    await waitFor(() => expect(hits('frequency')).toHaveLength(1));
    const p = hits('frequency')[0].params;
    expect(p.get('unit')).toBe('form');
    expect(p.get('pos')).toBe('VERB');
    expect(p.get('min_freq')).toBe('7');
    expect(p.get('exclude_stop')).toBe('false');
    expect(p.get('with_reference')).toBe('true');
  });

  it('shows an empty state and sends nothing without a corpus', async () => {
    corpusStore.currentId = null;
    render(Frequency);
    expect(screen.getByText('Create or select a corpus first.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
    expect(calls.filter((c) => c.path.includes('/frequency'))).toHaveLength(0);
  });
});

describe('Collocations', () => {
  it('needs a node word, then requests /collocations with every option', async () => {
    go('collocations');
    render(Collocations);
    await click('Find');
    expect(messages.current).toEqual({ text: 'Type a node word.', kind: 'err' });
    expect(hits('collocations')).toHaveLength(0);

    await setText(/Node word/, 'casa');
    await setNum(/Left/, '2');
    await setNum(/Right/, '6');
    await setNum(/Min freq/, '3');
    await setText(/POS/, 'ADJ');
    await fireEvent.click(screen.getByRole('switch', { name: 'Compare with base corpus' }));
    await click('Find');
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    const p = hits('collocations')[0];
    expect(p.path).toBe('/api/corpora/1/collocations');
    expect(Object.fromEntries(p.params)).toMatchObject({
      q: 'casa', left: '2', right: '6', min_freq: '3', pos: 'ADJ', exclude_stop: 'true', with_reference: 'true',
    });
    expect(screen.getByText(/42 occurrences/)).toBeInTheDocument();
    expect(screen.getByText('Base per M')).toBeInTheDocument();
  });

  it('sorts numerically and links collocates to the concordance', async () => {
    go('collocations', { q: 'casa' });
    render(Collocations);
    await waitFor(() => expect(bodyRows()).toHaveLength(2)); // restored from the route
    await fireEvent.click(screen.getByRole('columnheader', { name: /^Co-occ/ }));
    expect(firstCol()).toEqual(['grande', 'vieja']); // 3 < 10
    await fireEvent.click(screen.getByRole('link', { name: 'vieja' }));
    expect(window.location.hash).toBe('#/concordance?q=vieja&unit=lemma');
  });
});

describe('Ngrams', () => {
  it('requests /ngrams with n, unit, min freq, min docs and edge flag', async () => {
    go('ngrams');
    render(Ngrams);
    await click('Show');
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    const p = hits('ngrams')[0];
    expect(p.path).toBe('/api/corpora/1/ngrams');
    expect(Object.fromEntries(p.params)).toMatchObject({
      n: '3', unit: 'form', min_freq: '2', min_docs: '1', edge_stop: 'false',
    });
    expect(screen.getByRole('columnheader', { name: /^3-gram/ })).toBeInTheDocument();
    expect(screen.getByText('2 n-grams')).toBeInTheDocument();
  });

  it('sorts freq numerically and opens an n-gram in the concordance as an exact form', async () => {
    go('ngrams');
    render(Ngrams);
    await click('Show');
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    await fireEvent.click(screen.getByRole('columnheader', { name: /^Freq/ }));
    expect(firstCol()).toEqual(['de la casa', 'en el']); // 5 < 12
    await fireEvent.click(screen.getByRole('link', { name: 'de la casa' }));
    expect(window.location.hash).toBe('#/concordance?q=de%20la%20casa&unit=form');
  });
});

describe('Keyness', () => {
  it('offers the base corpus and same-language corpora, and requests /keyness', async () => {
    go('keyness');
    render(Keyness);
    const sel = (await screen.findByRole('combobox', { name: 'Reference corpus' })) as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBe(2));
    expect(sel.options[0].textContent).toContain('Base ES');
    expect(sel.options[1].textContent).toContain('C2'); // not C1 (itself) nor C3 (Italian)
    await click('Compare');
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    const p = hits('keyness')[0];
    expect(p.path).toBe('/api/corpora/1/keyness');
    expect(p.params.get('ref')).toBeNull(); // default = the language's base corpus
    expect(p.params.get('min_freq')).toBe('3');
    await fireEvent.change(sel, { target: { value: '2' } });
    await click('Compare');
    await waitFor(() => expect(hits('keyness')).toHaveLength(2));
    expect(hits('keyness')[1].params.get('ref')).toBe('2');
  });

  it('sorts LL numerically and links lemmas to the concordance', async () => {
    go('keyness');
    render(Keyness);
    await screen.findByRole('combobox', { name: 'Reference corpus' });
    await click('Compare');
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    await fireEvent.click(screen.getByRole('columnheader', { name: /^LL/ }));
    expect(firstCol()).toEqual(['contrato', 'cláusula']); // 40.5 < 90.1
    await fireEvent.click(screen.getByRole('link', { name: 'contrato' }));
    expect(window.location.hash).toBe('#/concordance?q=contrato&unit=lemma');
  });

  it('a restored route runs once, after the reference choices are known', async () => {
    go('keyness', { ref: '2', min: '5' });
    render(Keyness);
    await waitFor(() => expect(hits('keyness')).toHaveLength(1));
    const p = hits('keyness')[0].params;
    expect(p.get('ref')).toBe('2');
    expect(p.get('min_freq')).toBe('5');
    await new Promise((r) => setTimeout(r, 20));
    expect(hits('keyness')).toHaveLength(1);
  });

  it('a restored route with a reference that is gone runs against the first valid one', async () => {
    go('keyness', { ref: '99' });
    render(Keyness);
    await waitFor(() => expect(hits('keyness')).toHaveLength(1));
    expect(hits('keyness')[0].params.get('ref')).toBeNull();
  });

  it('does not run on load without route params', async () => {
    go('keyness');
    render(Keyness);
    await screen.findByRole('combobox', { name: 'Reference corpus' });
    await new Promise((r) => setTimeout(r, 20));
    expect(hits('keyness')).toHaveLength(0);
  });

  it('explains when there is no reference and sends nothing', async () => {
    corpusStore.list = [corpus(1)];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = new URL(url, 'http://x');
      calls.push({ path: u.pathname, params: u.searchParams });
      if (u.pathname === '/api/references') return res(200, []);
      return res(200, { tags: [], text_types: [], date_min: '', date_max: '' });
    }));
    go('keyness');
    render(Keyness);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/references')).toBe(true));
    await click('Compare');
    expect(messages.current?.kind).toBe('err');
    expect(messages.current?.text).toMatch(/base corpus/i);
    expect(hits('keyness')).toHaveLength(0);
  });
});

describe('Equivalents', () => {
  it('labels the unit choice "Search by" ("Match" is kept for segment match %)', () => {
    go('equivalents');
    render(Equivalents);
    expect(screen.getByRole('combobox', { name: 'Search by' })).toBeInTheDocument();
    expect(screen.queryByText('Match')).toBeNull();
  });

  it('requests /equivalents and shows the segment count', async () => {
    go('equivalents');
    render(Equivalents);
    await click('Find');
    expect(messages.current?.text).toBe('Type a source word or phrase.');
    await setText(/Source word/, 'casa');
    await setNum(/Min segments/, '3');
    await click('Find');
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    const p = hits('equivalents')[0];
    expect(p.path).toBe('/api/corpora/1/equivalents');
    expect(Object.fromEntries(p.params)).toMatchObject({ q: 'casa', unit: 'lemma', min_freq: '3' });
    expect(screen.getByText(/occurs in 5 aligned segments/)).toBeInTheDocument();
  });

  it('+ Term opens the dialog with the source, the candidate target', async () => {
    go('equivalents', { q: 'casa' });
    render(Equivalents);
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    await fireEvent.click(screen.getAllByRole('button', { name: '+ Term' })[1]);
    expect(termStore.open).toBe(true);
    expect(termStore.draft.src_term).toBe('casa');
    expect(termStore.draft.tgt_term).toBe('home');
    expect(termStore.ctx?.origin).toBe('equivalent');
  });

  it('sorts Dice numerically', async () => {
    go('equivalents', { q: 'casa' });
    render(Equivalents);
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    await fireEvent.click(screen.getByRole('columnheader', { name: /^Dice/ }));
    expect(firstCol()).toEqual(['home', 'house']); // 0.2 < 0.57
  });
});

describe('WordCloud', () => {
  let drawn: string[];
  beforeEach(() => {
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED)); // forget the last Keyness comparison
    drawn = [];
    const ctx = {
      font: '', fillStyle: '', textBaseline: '',
      fillRect: vi.fn(),
      measureText: (s: string) => ({ width: s.length * 8 }),
      fillText: (s: string) => drawn.push(s),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    body.frequency = {
      status: 200,
      body: [{ item: 'casa', freq: 9 }, { item: 'perro', freq: 4 }, { item: 'gato', freq: 1 }],
    };
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws the frequency words with the toolbar params', async () => {
    go('cloud');
    render(WordCloud);
    await click('Draw');
    await waitFor(() => expect(drawn.sort()).toEqual(['casa', 'gato', 'perro']));
    const p = hits('frequency')[0].params;
    expect(p.get('pos')).toBe('NOUN,ADJ,VERB');
    expect(p.get('limit')).toBe('80');
    expect(p.get('exclude_stop')).toBe('true');
    expect(p.get('min_freq')).toBe('1');
    expect(screen.getByRole('button', { name: 'Save PNG' })).toBeInTheDocument();
  });

  it('a restored keyness cloud without a Keyness comparison waits quietly (no error after a reload)', async () => {
    go('cloud', { src: 'keyness', pos: 'NOUN', n: '50' });
    render(WordCloud);
    await new Promise((r) => setTimeout(r, 20));
    expect(messages.current).toBeNull();
    expect(hits('keyness')).toHaveLength(0);
    expect(screen.getByRole('combobox', { name: 'Source' })).toHaveValue('keyness');
  });

  it('a restored frequency cloud draws on load', async () => {
    go('cloud', { src: 'frequency', n: '50' });
    render(WordCloud);
    await waitFor(() => expect(hits('frequency')).toHaveLength(1));
    expect(hits('frequency')[0].params.get('limit')).toBe('50');
  });

  it('needs a Keyness comparison before drawing keyness', async () => {
    go('cloud', { src: 'keyness' });
    render(WordCloud);
    await click('Draw');
    expect(messages.current?.kind).toBe('err');
    expect(hits('keyness')).toHaveLength(0);
  });

  it('draws keyness weights from the last comparison, ignoring non-positive LL', async () => {
    go('keyness');
    const k = render(Keyness);
    await screen.findByRole('combobox', { name: 'Reference corpus' });
    await click('Compare');
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    k.unmount();
    body.keyness = { status: 200, body: [{ ...kyRows[0], ll: 5 }, { ...kyRows[1], ll: -3 }] };
    go('cloud', { src: 'keyness' });
    render(WordCloud);
    await click('Draw');
    await waitFor(() => expect(drawn).toEqual(['contrato']));
    expect(hits('keyness')[1].params.get('limit')).toBe('80');
  });
});
