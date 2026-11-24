import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Job from '../src/screens/Job.svelte';
import { CORPUS_CHANGED, corpusStore } from '../src/lib/corpus.svelte';
import { analysis } from '../src/lib/analysis.svelte';
import { stopAllJobs } from '../src/lib/jobs.svelte';
import { messages } from '../src/lib/messages.svelte';
import { termStore } from '../src/lib/term.svelte';
import type { Job as JobT, JobReport } from '../src/lib/types';

const report = (over: Partial<JobReport> = {}): JobReport => ({
  summary: {
    words: 12345, content_words: 6000, distinct_lemmas: 321, sentences: 10, language_check: 'ok',
    corpus_words: 50000, corpus_filtered: false, min_corpus_freq: 3, min_job_freq: 2,
    coverage_tokens_pct: 87, coverage_seen_pct: 94.5, coverage_types_pct: 70, uncovered_types: 2,
    termbase_terms_found: 2, termbase_size: 5, reference: 'base',
  },
  key_terms: [
    { item: 'contrato', pos: 'NOUN', job_freq: 5, corpus_freq: 40, base_per_million: 12.3, log_ratio: 2.1, ll: 33.4, termbase: 'contract' },
    { item: 'arrendador', pos: 'NOUN', job_freq: 3, corpus_freq: 1, base_per_million: 0.5, log_ratio: 3.2, ll: 20.1, termbase: '(candidate)' },
  ],
  gaps: [
    { item: 'fianza', pos: 'NOUN', job_freq: 4, corpus_freq: 0, termbase: '' },
    { item: 'aval', pos: 'NOUN', job_freq: 2, corpus_freq: 1, termbase: 'guarantee' },
  ],
  known_terms: [
    {
      item: 'arrendamiento', occurrences: 3, example: 'El arrendamiento termina hoy.', ids: [4, 5],
      translations: [{ id: 4, term: 'lease', status: 'approved' }, { id: 5, term: 'renting', status: 'forbidden' }],
    },
    {
      item: 'rescisión', occurrences: 1, example: 'La rescisión es inmediata.', ids: [6],
      translations: [{ id: 6, term: 'rescission', status: 'forbidden' }],
    },
  ],
  phrases: [{ item: 'el contrato de', job_freq: 3, corpus_freq: 7, words: 3 }],
  ...over,
});

const jobOf = (status: string, over: Partial<JobT> = {}): JobT => ({
  id: 7, corpus_id: 1, kind: 'analysis', label: 'pasted text', status, progress: 0.4, error: '', code: '', result: {}, ...over,
});

interface Call { method: string; path: string; params: URLSearchParams; body?: unknown }
let calls: Call[];
let statuses: JobT[];
let result: JobReport;
let submit: { status: number; body: unknown };
let savedList: unknown[];

const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });
const corpus = (id: number) => ({ id, name: `C${id}`, lang: 'es', project_id: null, is_reference: 0, docs: 2, tokens: 10 });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  calls = [];
  statuses = [jobOf('queued'), jobOf('running'), jobOf('done', { progress: 1 })];
  result = report();
  submit = { status: 202, body: { job_id: 7 } };
  savedList = [];
  corpusStore.list = [corpus(1), corpus(2)];
  corpusStore.currentId = 1;
  corpusStore.loaded = true;
  corpusStore.clearScope();
  messages.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const u = new URL(url, 'http://x');
    calls.push({ method, path: u.pathname, params: u.searchParams, body: init?.body });
    const p = u.pathname;
    if (/\/analyse-job$/.test(p)) return res(submit.status, submit.body);
    if (p === '/api/jobs/7/save') {
      savedList = [{ id: 3, title: 'pasted text · now', source: '', created: '2026-11-24 10:00:00', has_text: false, words: 12345, coverage_tokens_pct: 87, gaps: 2, terms_found: 2 }];
      return res(200, { id: 3, saved_before: false });
    }
    if (/\/corpora\/\d+\/reports$/.test(p)) return res(200, savedList);
    if (p === '/api/reports/3/result') return res(200, { ...result, report_id: 3, title: 'Contrato Acme', source: 'acme.docx', has_text: true });
    if (p === '/api/reports/3/text') return res(200, { text: 'El contrato fija el plazo.', lang: 'es' });
    if (p === '/api/reports/3' && method === 'DELETE') { savedList = []; return res(204, null); }
    if (/\/check-text$/.test(p)) return res(200, { lang: 'es', lines: [{ text: 'El contrato fija el plazo.', marks: [{ start: 3, end: 11, kind: 'term', translations: ['contratto'], forbidden: [] }] }], summary: { hits: 1, forbidden: 0 } });
    if (/^\/api\/jobs\/\d+$/.test(p)) return res(200, statuses.length > 1 ? statuses.shift()! : statuses[0]);
    if (/^\/api\/jobs\/\d+\/result$/.test(p)) return res(200, result);
    if (/\/jobs$/.test(p)) return res(200, []);
    if (/\/facets$/.test(p)) return res(200, { tags: [], text_types: [], date_min: '', date_max: '' });
    if (/\/scope$/.test(p)) return res(200, { filtered: false, docs: 2, words: 10, total_docs: 2, total_words: 10 });
    if (p === '/api/languages') return res(200, { es: 'Spanish', it: 'Italian' });
    if (/\/examples$/.test(p)) return res(200, []);
    return res(404, { detail: 'nope' });
  }));
});

afterEach(() => {
  analysis.reset();
  analysis.text = '';
  stopAllJobs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  corpusStore.list = [];
  corpusStore.currentId = null;
  termStore.open = false;
});

const pollCalls = () => calls.filter((c) => /^\/api\/jobs\/\d+$/.test(c.path));
const submitCalls = () => calls.filter((c) => /\/analyse-job$/.test(c.path));
const analyse = () => screen.getByRole('button', { name: 'Analyse' });

async function paste(text = 'Un texto de prueba para analizar.') {
  await fireEvent.input(screen.getByLabelText('Or paste the text here'), { target: { value: text } });
}
/** Runs timers until the report is on screen. */
async function runToReport() {
  await paste();
  await fireEvent.click(analyse());
  await vi.advanceTimersByTimeAsync(3000);
  await screen.findByText('87%');
}

describe('Job', () => {
  it('shows an empty state without a corpus and requests nothing', () => {
    corpusStore.list = [];
    corpusStore.currentId = null;
    render(Job);
    expect(screen.getByText('Create or select a corpus first.')).toBeInTheDocument();
    expect(calls.length).toBe(0);
  });

  it('asks for input when neither file nor text is given', async () => {
    render(Job);
    await fireEvent.click(analyse());
    expect(messages.current).toEqual({ text: 'Choose a file or paste the text to analyse.', kind: 'err' });
    expect(submitCalls().length).toBe(0);
  });

  it('posts the pasted text with options and scope, polls until done and renders the report', async () => {
    corpusStore.scope.tags = 'legal';
    render(Job);
    await fireEvent.input(screen.getByLabelText(/min\. times in text/), { target: { value: '4' } });
    await fireEvent.input(screen.getByLabelText(/well covered from/), { target: { value: '5' } });
    await fireEvent.click(screen.getByLabelText('analyse even if the language looks wrong'));
    await paste('Hola mundo.');
    await fireEvent.click(analyse());
    await waitFor(() => expect(submitCalls().length).toBe(1));
    const c = submitCalls()[0];
    expect(c.path).toBe('/api/corpora/1/analyse-job');
    expect(c.params.get('min_freq')).toBe('4');
    expect(c.params.get('min_corpus_freq')).toBe('5');
    expect(c.params.get('force_language')).toBe('true');
    expect(c.params.get('tags')).toBe('legal');
    expect((c.body as FormData).get('text')).toBe('Hola mundo.');
    expect((c.body as FormData).get('file')).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await screen.findByText('87%')).toBeInTheDocument();
    expect(pollCalls().length).toBeGreaterThanOrEqual(3);
    expect(calls.some((x) => x.path === '/api/jobs/7/result')).toBe(true);
    expect(analyse()).not.toBeDisabled();
  });

  it('sends a chosen file instead of the text', async () => {
    render(Job);
    const file = new File(['hola'], 'a.txt', { type: 'text/plain' });
    await fireEvent.change(screen.getByLabelText('File to analyse'), { target: { files: [file] } });
    await paste('ignored');
    await fireEvent.click(analyse());
    await waitFor(() => expect(submitCalls().length).toBe(1));
    const fd = submitCalls()[0].body as FormData;
    expect((fd.get('file') as File).name).toBe('a.txt');
    expect(fd.get('text')).toBeNull();
  });

  it('shows queue and progress while the job runs and disables the button', async () => {
    render(Job);
    await paste();
    await fireEvent.click(analyse());
    await waitFor(() => expect(screen.getByText('queued…')).toBeInTheDocument());
    expect(analyse()).toBeDisabled();
    await vi.advanceTimersByTimeAsync(800);
    expect(await screen.findByText('analysing…')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '40');
  });

  it('renders every stat tile with the old formatting', async () => {
    render(Job);
    await runToReport();
    const tile = (label: string) => screen.getByText(label).closest('.stat') as HTMLElement;
    expect(within(tile('words')).getByText((12345).toLocaleString())).toBeInTheDocument();
    expect(within(tile('different words')).getByText('321')).toBeInTheDocument();
    expect(within(tile('covered (≥3×)')).getByText('87%')).toBeInTheDocument();
    expect(within(tile('seen at all')).getByText('94.5%')).toBeInTheDocument();
    expect(within(tile('gaps')).getByText('2')).toBeInTheDocument();
    expect(within(tile('termbase terms found')).getByText('2 / 5')).toBeInTheDocument();
    expect(tile('seen at all')).toHaveAttribute('title', 'share of content words the corpus has at least once');
  });

  it('renders the sections, their CSV links and the glossary links', async () => {
    render(Job);
    await runToReport();
    const link = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(link('CSV: Termbase terms in this text')).toBe('/api/jobs/7/result?section=known_terms&format=csv');
    expect(link('CSV: Gaps')).toBe('/api/jobs/7/result?section=gaps&format=csv');
    expect(link('CSV: Key terms')).toBe('/api/jobs/7/result?section=key_terms&format=csv');
    expect(link('CSV: Repeated phrases')).toBe('/api/jobs/7/result?section=phrases&format=csv');
    expect(link('TBX')).toBe('/api/terms/export?format=tbx2&ids=4%2C5%2C6');
    expect(link('Excel')).toBe('/api/terms/export?format=xlsx&ids=4%2C5%2C6');
    expect(link('CSV: glossary for this job')).toBe('/api/terms/export?format=csv&ids=4%2C5%2C6');
    expect(screen.getByText('Key terms of the text (compared with the base corpus)')).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/[▲▼]/g, '').trim());
    expect(headers).toEqual(expect.arrayContaining(['Base per M', 'LL', 'Lemma', 'Phrase', 'In text', 'In corpus', 'Termbase', 'Times', 'First occurrence']));
    expect(screen.getByRole('link', { name: 'fianza' })).toBeInTheDocument();
    expect(screen.getByText('el contrato de')).toBeInTheDocument();
    expect(screen.getByText('contract')).toBeInTheDocument();
    // the backend's "(candidate)" marker shows as the translated Candidate badge
    expect(screen.getByText('Candidate')).toBeInTheDocument();
    expect(screen.queryByText('(candidate)')).toBeNull();
  });

  it('omits glossary links without known terms and drops the key-term ranking columns without a base corpus', async () => {
    result = report({
      known_terms: [],
      summary: { ...report().summary, reference: null, termbase_size: 0, termbase_terms_found: 0 },
      key_terms: [{ item: 'contrato', pos: 'NOUN', job_freq: 5, corpus_freq: 40, base_per_million: null, log_ratio: null, ll: null, termbase: '' }],
    });
    render(Job);
    await runToReport();
    expect(screen.queryByText('glossary for this job:')).toBeNull();
    expect(screen.queryByRole('link', { name: 'TBX' })).toBeNull();
    expect(screen.getByText('No termbase entry occurs in the text (the termbase for this project is empty).')).toBeInTheDocument();
    expect(screen.getByText('Key terms of the text (most frequent; add a base corpus to rank by distinctiveness)')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Base per M/ })).toBeNull();
  });

  it('warns about an empty corpus and an uncertain language', async () => {
    result = report({ summary: { ...report().summary, corpus_words: 0, language_check: 'uncertain' } });
    render(Job);
    await runToReport();
    expect(screen.getByText('This corpus has no text yet, so nothing is covered.')).toBeInTheDocument();
    expect(screen.getByText(/does not clearly look like Spanish or Italian/)).toBeInTheDocument();
  });

  it('marks termbase hits in the shown sentences: term and forbidden, with the forbidden translations flagged', async () => {
    render(Job);
    await runToReport();
    const hit = screen.getByText('arrendamiento', { selector: '.hit-term' });
    expect(hit).toBeInTheDocument();
    const bad = screen.getByText('rescisión', { selector: '.hit-forbidden' });
    expect(bad).toBeInTheDocument();
    const row = screen.getByText('renting ✗').closest('[role="row"]') as HTMLElement;
    expect(within(row).getByText('lease')).toBeInTheDocument();
    expect(screen.getByText('renting ✗').closest('span[title]')).toHaveAttribute('title', 'Forbidden — do not use');
    expect(within(row).getByText('lease').closest('span[title]')).toHaveAttribute('title', 'Approved');
  });

  it('shows text containing markup literally', async () => {
    result = report({
      known_terms: [{ item: 'x', occurrences: 1, example: 'before <script>alert(1)</script> x', ids: [1],
        translations: [{ id: 1, term: '<b>bold</b>', status: 'approved' }] }],
      gaps: [{ item: '<img src=x onerror=alert(1)>', pos: 'NOUN', job_freq: 1, corpus_freq: 0, termbase: '' }],
    });
    const { container } = render(Job);
    await runToReport();
    expect(screen.getByText(/before <script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('script, img, .tr b')).toBeNull();
  });

  it('opens the Add term dialog from gap, key term and phrase rows with origin job', async () => {
    render(Job);
    await runToReport();
    const gapRow = screen.getByRole('link', { name: 'fianza' }).closest('[role="row"]') as HTMLElement;
    await fireEvent.click(within(gapRow).getByRole('button', { name: '+ Term' }));
    expect(termStore.open).toBe(true);
    expect(termStore.draft.src_term).toBe('fianza');
    expect(termStore.draft.pos).toBe('noun');
    expect(termStore.ctx?.origin).toBe('job');
    const keyRow = screen.getByRole('link', { name: 'arrendador' }).closest('[role="row"]') as HTMLElement;
    await fireEvent.click(within(keyRow).getByRole('button', { name: '+ Term' }));
    expect(termStore.draft.src_term).toBe('arrendador');
    const phraseRow = screen.getByText('el contrato de').closest('[role="row"]') as HTMLElement;
    await fireEvent.click(within(phraseRow).getByRole('button', { name: '+ Term' }));
    expect(termStore.draft.src_term).toBe('el contrato de');
  });

  it('a failed job shows its error and re-enables the button', async () => {
    statuses = [jobOf('queued'), jobOf('error', { error: 'The text is too short to analyse', code: '' })];
    render(Job);
    await paste();
    await fireEvent.click(analyse());
    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByRole('alert')).toHaveTextContent('The text is too short to analyse');
    expect(messages.current).toEqual({ text: 'The text is too short to analyse', kind: 'err' });
    expect(analyse()).not.toBeDisabled();
    const n = pollCalls().length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(pollCalls().length).toBe(n);
  });

  it('keeps the previous report while a new analysis runs and after a failed submit', async () => {
    render(Job);
    await runToReport();
    submit = { status: 400, body: { detail: 'Upload a file or paste the text to analyse' } };
    await fireEvent.click(analyse());
    await waitFor(() => expect(messages.current?.kind).toBe('err'));
    expect(messages.current?.text).toBe('Upload a file or paste the text to analyse');
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(analyse()).not.toBeDisabled();
    // a new run keeps showing the old report until its result replaces it
    submit = { status: 202, body: { job_id: 7 } };
    statuses = [jobOf('running')];
    await fireEvent.click(analyse());
    await waitFor(() => expect(screen.getByText('analysing…')).toBeInTheDocument());
    expect(screen.getByText('87%')).toBeInTheDocument();
  });

  it('keeps the previous report when the new job fails', async () => {
    render(Job);
    await runToReport();
    statuses = [jobOf('error', { error: 'boom' })];
    await fireEvent.click(analyse());
    await vi.advanceTimersByTimeAsync(1500);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByText('87%')).toBeInTheDocument();
  });

  it('retries a failed poll once, then gives up with the error and a usable button', async () => {
    const real = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<unknown>;
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => {
      if (/^\/api\/jobs\/\d+$/.test(new URL(u, 'http://x').pathname)) {
        calls.push({ method: 'GET', path: '/api/jobs/7', params: new URLSearchParams() });
        return res(500, { detail: 'db down' });
      }
      return real(u, i);
    }));
    render(Job);
    await paste();
    await fireEvent.click(analyse());
    await vi.advanceTimersByTimeAsync(3000);
    await waitFor(() => expect(messages.current).toEqual({ text: 'db down', kind: 'err' }));
    expect(pollCalls().length).toBe(2);
    expect(analyse()).not.toBeDisabled();
  });

  it('clears the report and stops polling when the corpus changes', async () => {
    render(Job);
    await runToReport();
    statuses = [jobOf('running')];
    await fireEvent.click(analyse());
    await waitFor(() => expect(screen.getByText('analysing…')).toBeInTheDocument());
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
    await waitFor(() => expect(screen.queryByText('87%')).toBeNull());
    expect(screen.queryByText('analysing…')).toBeNull();
    expect(analyse()).not.toBeDisabled();
    const n = pollCalls().length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(pollCalls().length).toBe(n);
  });

  it('ignores a result that arrives after the corpus changed', async () => {
    render(Job);
    await paste();
    statuses = [jobOf('done', { progress: 1 })];
    await fireEvent.click(analyse());
    await waitFor(() => expect(submitCalls().length).toBe(1));
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(screen.queryByText('87%')).toBeNull();
  });

  it('keeps the report across unmount and remount (leaving the screen and coming back)', async () => {
    const first = render(Job);
    await runToReport();
    first.unmount();
    render(Job);
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(screen.getByText('Report for the pasted text')).toBeInTheDocument();
    expect(screen.getByLabelText('Or paste the text here')).toHaveValue('Un texto de prueba para analizar.');
    expect(screen.getByRole('link', { name: 'CSV: Gaps' })).toHaveAttribute('href', '/api/jobs/7/result?section=gaps&format=csv');
  });

  it('names the analysed file above the report', async () => {
    render(Job);
    const file = new File(['hola'], 'contrato.docx');
    await fireEvent.change(screen.getByLabelText('File to analyse'), { target: { files: [file] } });
    await fireEvent.click(analyse());
    await vi.advanceTimersByTimeAsync(3000);
    expect(await screen.findByText('Report for contrato.docx')).toBeInTheDocument();
  });

  it('keeps polling after the screen is left and shows the report on return', async () => {
    const first = render(Job);
    await paste();
    statuses = [jobOf('running'), jobOf('running'), jobOf('done', { progress: 1 })];
    await fireEvent.click(analyse());
    await waitFor(() => expect(pollCalls().length).toBeGreaterThan(0));
    first.unmount();
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls.some((x) => x.path === '/api/jobs/7/result')).toBe(true);
    render(Job);
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(analyse()).not.toBeDisabled();
  });

  it('shows the progress of an analysis still running when the screen is mounted again', async () => {
    const first = render(Job);
    await paste();
    statuses = [jobOf('running')];
    await fireEvent.click(analyse());
    await waitFor(() => expect(screen.getByText('analysing…')).toBeInTheDocument());
    first.unmount();
    render(Job);
    expect(screen.getByText('analysing…')).toBeInTheDocument();
    expect(analyse()).toBeDisabled();
  });

  it('a corpus change clears a report kept while the screen was closed', async () => {
    const first = render(Job);
    await runToReport();
    first.unmount();
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED, { detail: { id: 2 } }));
    render(Job);
    expect(screen.queryByText('87%')).toBeNull();
    expect(screen.getByText('No analysis yet')).toBeInTheDocument();
  });

  it('reset stops the poll for good: no timer is left behind', async () => {
    const first = render(Job);
    await paste();
    statuses = [jobOf('running')];
    await fireEvent.click(analyse());
    await vi.advanceTimersByTimeAsync(1600);
    first.unmount();
    stopAllJobs();
    analysis.reset();
    expect(vi.getTimerCount()).toBe(0);
    const n = pollCalls().length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(pollCalls().length).toBe(n);
    expect(analysis.busy).toBe(false);
  });

  it('an empty job error falls back to a generic analysis-failed message', async () => {
    statuses = [jobOf('error', { error: '' })];
    render(Job);
    await paste();
    await fireEvent.click(analyse());
    await vi.advanceTimersByTimeAsync(1500);
    expect(await screen.findByRole('alert')).toHaveTextContent('The analysis failed: the server gave no reason');
  });
});

describe('Job saved reports', () => {
  it('keeping the text is off by default and is sent when ticked', async () => {
    render(Job);
    await paste();
    await fireEvent.click(analyse());
    await vi.advanceTimersByTimeAsync(100);
    expect(submitCalls()[0].params.get('keep_text')).toBe('false');
    await vi.advanceTimersByTimeAsync(3000);
    await screen.findByText('87%');
    await fireEvent.click(screen.getByLabelText('keep the text with a saved report'));
    await fireEvent.click(analyse());
    await vi.advanceTimersByTimeAsync(100);
    expect(submitCalls()[1].params.get('keep_text')).toBe('true');
  });

  it('saves the report on screen, lists it, and the downloads then come from the saved report', async () => {
    render(Job);
    await runToReport();
    expect(screen.getByRole('link', { name: 'Excel: whole report' }).getAttribute('href')).toBe('/api/jobs/7/result?format=xlsx');
    await fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/jobs/7/save' && c.method === 'POST')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save report' })).toBeNull();
    expect(await screen.findByText('Saved reports')).toBeInTheDocument();
    expect(screen.getByText(/12,345 words · 87% covered · 2 gaps/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Excel: whole report' }).getAttribute('href')).toBe('/api/reports/3/result?format=xlsx');
    expect(screen.getByRole('link', { name: 'CSV: Gaps' }).getAttribute('href')).toBe('/api/reports/3/result?section=gaps&format=csv');
  });

  it('opens a saved report after a restart and shows the text with the termbase hits marked', async () => {
    savedList = [{ id: 3, title: 'Contrato Acme', source: 'acme.docx', created: '2026-11-23 09:00:00', has_text: true, words: 900, coverage_tokens_pct: 61, gaps: 4, terms_found: 1 }];
    render(Job);
    expect(await screen.findByText('Contrato Acme')).toBeInTheDocument();
    expect(screen.getByText(/61% covered · 4 gaps · text kept/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Open report Contrato Acme' }));
    expect(await screen.findByText('87%')).toBeInTheDocument();
    expect(screen.getByText('Report for acme.docx')).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Show the text' }));
    const region = await screen.findByRole('region', { name: 'Analysed text' });
    expect(within(region).getByText('contrato')).toHaveClass('hit-term');
    expect(calls.find((c) => /check-text$/.test(c.path))!.body).toBe(JSON.stringify({ text: 'El contrato fija el plazo.', lang: 'es' }));
  });

  it('a report without kept text offers no text view', async () => {
    savedList = [{ id: 3, title: 'Sin texto', source: '', created: '2026-11-23 09:00:00', has_text: false, words: 1, coverage_tokens_pct: 1, gaps: 0, terms_found: 0 }];
    render(Job);
    await screen.findByText('Sin texto');
    expect(screen.queryByRole('button', { name: 'Show the text' })).toBeNull();
  });

  it('deleting asks first, removes the report and clears it from the screen', async () => {
    savedList = [{ id: 3, title: 'Contrato Acme', source: 'acme.docx', created: '2026-11-23 09:00:00', has_text: true, words: 900, coverage_tokens_pct: 61, gaps: 4, terms_found: 1 }];
    render(Job);
    await fireEvent.click(await screen.findByRole('button', { name: 'Open report Contrato Acme' }));
    await screen.findByText('87%');
    await fireEvent.click(screen.getByRole('button', { name: 'Delete report Contrato Acme' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('with the text kept in it');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/reports/3')).toBe(true));
    await waitFor(() => expect(screen.queryByText('Saved reports')).toBeNull());
    expect(screen.queryByText('87%')).toBeNull();
  });
});
