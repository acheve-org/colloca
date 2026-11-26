import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Languages from '../src/screens/Languages.svelte';
import { stopAllJobs } from '../src/lib/jobs.svelte';
import { messages } from '../src/lib/messages.svelte';
import { __setViewportForTests } from '../src/lib/viewport.svelte';

const row = (code: string, name: string, over: Record<string, unknown> = {}, model: Record<string, unknown> = {}, ocr: Record<string, unknown> = {}) => ({
  code, name, model_size: null, tesseract: code === 'es' ? 'spa' : code === 'it' ? 'ita' : 'fra', corpus_count: 0,
  model: { name: `${code}_core_news_lg`, version: '3.8.0', size: 'lg', small: false, state: 'idle', message: '', ...model },
  ocr: { engine: true, tesseract: 'spa', available: true, state: 'idle', message: '', ...ocr },
  ...over,
});
const catalog = [
  { code: 'es', name: 'Spanish', sizes: ['sm', 'md', 'lg'], tesseract: 'spa', added: true },
  { code: 'fr', name: 'French', sizes: ['sm', 'md', 'lg'], tesseract: 'fra', added: false },
  { code: 'de', name: 'German', sizes: ['sm', 'md', 'lg'], tesseract: 'deu', added: false },
];

interface Call { method: string; path: string; search: string; body?: unknown }
let calls: Call[];
let settings: ReturnType<typeof row>[][];
let references: Record<string, unknown>[];
const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });

beforeEach(() => {
  calls = [];
  references = [];
  settings = [[row('es', 'Spanish', { corpus_count: 2 }), row('it', 'Italian', {}, { name: null, version: null, size: null }), row('fr', 'French', {}, { name: null, state: 'failed', message: 'no network' })]];
  messages.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const u = new URL(url, 'http://x');
    const raw = init?.body;
    calls.push({ method, path: u.pathname, search: u.search, body: typeof raw === 'string' ? JSON.parse(raw) : raw });
    const p = u.pathname;
    if (p === '/api/language-settings') return res(200, settings.length > 1 ? settings.shift()! : settings[0]);
    if (p === '/api/language-catalog') return res(200, catalog);
    if (p === '/api/languages' && method === 'GET') return res(200, { es: 'Spanish', it: 'Italian', fr: 'French' });
    if (p === '/api/references') return res(200, references);
    if (/^\/api\/corpora\/\d+\/jobs$/.test(p)) return res(200, []);
    if (method === 'DELETE') return res(204, null);
    return res(p === '/api/languages' ? 201 : 202, {});
  }));
});

afterEach(() => {
  __setViewportForTests({ stacked: false });
  stopAllJobs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// The panel shows the selected language only, as a region named after it.
const card = (name: string) => screen.getByRole('region', { name });
const loaded = () => screen.findByRole('region', { name: 'Spanish' });
const nav = () => screen.getByRole('navigation', { name: 'Languages' });
// The list button of a language: its name starts with the language name, then the code and the dots.
const item = (name: string) => within(nav()).getByRole('button', { name: new RegExp(`^${name} `) });
const pick = async (name: string) => {
  await fireEvent.click(item(name));
  await tick();
};

describe('Languages', () => {
  it('lists one button per language with its name, code and three status dots', async () => {
    references = [{ id: 7, name: 'Italian base', lang: 'it', project_id: null, is_reference: 1, docs: 1, tokens: 10 }];
    render(Languages);
    await loaded();
    const buttons = within(nav()).getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));
    expect(buttons).toHaveLength(3);
    const es = item('Spanish');
    expect(within(es).getByText('es')).toBeInTheDocument();
    expect(within(es).getByText('Model: installed')).toBeInTheDocument();
    expect(within(es).getByText('OCR: installed')).toBeInTheDocument();
    expect(within(es).getByText('Base corpus: missing')).toBeInTheDocument();
    const it_ = item('Italian');
    expect(within(it_).getByText('it')).toBeInTheDocument();
    expect(within(it_).getByText('Model: missing')).toBeInTheDocument();
    expect(within(it_).getByText('Base corpus: installed')).toBeInTheDocument();
    expect(within(item('French')).getByText('Model: failed')).toBeInTheDocument();
    // Each dot has a visible text label, so colour is never the only signal.
    expect(within(es).getByText('Model', { exact: true })).toBeInTheDocument();
    expect(within(es).getByText('OCR', { exact: true })).toBeInTheDocument();
    expect(within(es).getByText('Base corpus', { exact: true })).toBeInTheDocument();
  });

  it('shows the add button and a one-line intro above the list', async () => {
    render(Languages);
    await loaded();
    expect(within(nav()).getByRole('button', { name: 'Add language' })).toBeInTheDocument();
    expect(within(nav()).getByText('Models, OCR data and base corpora for the languages you work with.')).toBeInTheDocument();
  });

  it('selects the first language by default and shows only its panel', async () => {
    render(Languages);
    await loaded();
    expect(item('Spanish')).toHaveAttribute('aria-pressed', 'true');
    expect(item('Italian')).toHaveAttribute('aria-pressed', 'false');
    expect(within(card('Spanish')).getByText('es_core_news_lg 3.8.0 (lg)')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Italian' })).toBeNull();
  });

  it('choosing another language selects it and shows its panel', async () => {
    render(Languages);
    await loaded();
    await pick('Italian');
    expect(item('Italian')).toHaveAttribute('aria-pressed', 'true');
    expect(item('Spanish')).toHaveAttribute('aria-pressed', 'false');
    expect(within(card('Italian')).getByText('Model not installed')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Spanish' })).toBeNull();
    await pick('French');
    expect(within(card('French')).getByText('no network')).toBeInTheDocument();
  });

  it('keeps the selection when polling reloads the languages', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    settings = [
      [row('es', 'Spanish'), row('it', 'Italian', {}, { name: null, state: 'installing' })],
      [row('es', 'Spanish'), row('it', 'Italian', {}, { name: 'it_core_news_md', version: '3.8.0', size: 'md' })],
    ];
    render(Languages);
    await loaded();
    await pick('Italian');
    await vi.advanceTimersByTimeAsync(2100);
    await waitFor(() => expect(within(card('Italian')).getByText('it_core_news_md 3.8.0 (md)')).toBeInTheDocument());
    expect(item('Italian')).toHaveAttribute('aria-pressed', 'true');
  });

  it('removing the selected language selects the first remaining one', async () => {
    settings = [settings[0], [row('es', 'Spanish', { corpus_count: 2 }), row('it', 'Italian', {}, { name: null, version: null, size: null })]];
    render(Languages);
    await loaded();
    await pick('French');
    await fireEvent.click(within(card('French')).getByRole('button', { name: 'Remove French' }));
    await fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove French?' })).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(within(nav()).queryByRole('button', { name: /^French / })).toBeNull());
    expect(item('Spanish')).toHaveAttribute('aria-pressed', 'true');
    expect(card('Spanish')).toBeInTheDocument();
  });

  it('install posts the model request and polls until it is done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    settings = [
      [row('it', 'Italian', {}, { name: null, version: null, size: null })],
      [row('it', 'Italian', {}, { name: null, version: null, size: null, state: 'installing' })],
      [row('it', 'Italian', {}, { name: 'it_core_news_md', version: '3.8.0', size: 'md' })],
    ];
    render(Languages);
    await screen.findByRole('region', { name: 'Italian' });
    await fireEvent.click(within(card('Italian')).getByRole('button', { name: 'Install model for Italian' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/languages/it/model')).toBe(true));
    expect(calls.find((c) => c.path === '/api/languages/it/model')!.body).toEqual({});
    await waitFor(() => expect(within(card('Italian')).getByRole('progressbar')).toBeInTheDocument());
    await vi.advanceTimersByTimeAsync(2100);
    await waitFor(() => expect(within(card('Italian')).getByText('it_core_news_md 3.8.0 (md)')).toBeInTheDocument());
    const n = calls.filter((c) => c.path === '/api/language-settings').length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(calls.filter((c) => c.path === '/api/language-settings').length).toBe(n);   // polling stopped
  });

  it('a failed install is announced', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    settings = [
      [row('it', 'Italian', {}, { name: null, state: 'installing' })],
      [row('it', 'Italian', {}, { name: null, state: 'failed', message: 'no network' })],
    ];
    render(Languages);
    await screen.findByRole('region', { name: 'Italian' });
    await vi.advanceTimersByTimeAsync(2100);
    await waitFor(() => expect(messages.current?.text).toContain('no network'));
    expect(messages.current?.kind).toBe('err');
  });

  it('uninstalling a model asks first and warns when corpora use the language', async () => {
    render(Languages);
    await loaded();
    await fireEvent.click(within(card('Spanish')).getByRole('button', { name: 'Uninstall model of Spanish' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const dlg = screen.getByRole('dialog', { name: 'Uninstall the model of Spanish?' });
    expect(within(dlg).getByText(/2 corpora use this language: importing/)).toBeInTheDocument();
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/languages/es/model')).toBe(true));
  });

  it('remove is disabled while corpora use the language and says how many', async () => {
    render(Languages);
    await loaded();
    expect(within(card('Spanish')).getByRole('button', { name: 'Remove Spanish' })).toBeDisabled();
    expect(within(card('Spanish')).getByText('2 corpora use this language')).toBeInTheDocument();
    await pick('French');
    expect(within(card('French')).getByRole('button', { name: 'Remove French' })).toBeEnabled();
  });

  it('remove asks for confirmation and can uninstall the model too', async () => {
    render(Languages);
    await loaded();
    await pick('French');
    await fireEvent.click(within(card('French')).getByRole('button', { name: 'Remove French' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const dlg = screen.getByRole('dialog', { name: 'Remove French?' });
    await fireEvent.click(within(dlg).getByRole('switch', { name: 'Also uninstall the model' }));
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/languages/fr')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')!.search).toBe('?uninstall_model=true');
  });

  it('the add dialog lists only catalog languages not yet added and posts the choice', async () => {
    render(Languages);
    await loaded();
    await fireEvent.click(within(nav()).getByRole('button', { name: 'Add language' }));
    const dlg = await screen.findByRole('dialog', { name: 'Add a language' });
    await waitFor(() => expect(within(dlg).getByRole('radio', { name: 'French' })).toBeInTheDocument());
    expect(within(dlg).queryByRole('radio', { name: 'Spanish' })).toBeNull();
    expect(within(dlg).getByRole('button', { name: 'Add' })).toBeDisabled();
    await fireEvent.input(within(dlg).getByRole('searchbox', { name: 'Search languages' }), { target: { value: 'ger' } });
    expect(within(dlg).queryByRole('radio', { name: 'French' })).toBeNull();
    await fireEvent.input(within(dlg).getByRole('searchbox', { name: 'Search languages' }), { target: { value: '' } });
    await fireEvent.click(within(dlg).getByRole('radio', { name: 'French' }));
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/languages')).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/languages')!.body).toEqual({
      code: 'fr', size: 'md', install_model: true, install_ocr: true,
    });
  });

  it('the edit dialog patches name and OCR code, keeps the code read-only', async () => {
    render(Languages);
    await loaded();
    await fireEvent.click(within(card('Spanish')).getByRole('button', { name: 'Edit Spanish' }));
    const dlg = screen.getByRole('dialog', { name: 'Edit Spanish' });
    expect(within(dlg).getByLabelText('Code')).toHaveAttribute('readonly');
    await fireEvent.input(within(dlg).getByLabelText('Display name'), { target: { value: 'Español' } });
    await fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.path).toBe('/api/languages/es');
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ name: 'Español', tesseract: 'spa' });
  });

  it('the OCR line says when the Tesseract program is missing', async () => {
    settings = [[row('es', 'Spanish', {}, {}, { engine: false, available: false })]];
    render(Languages);
    await loaded();
    expect(within(card('Spanish')).getByText('Tesseract is not installed (build with WITH_OCR=1)')).toBeInTheDocument();
  });

  it('OCR data can be installed and removed', async () => {
    settings = [[row('es', 'Spanish', {}, {}, { available: false })]];
    render(Languages);
    await loaded();
    expect(within(card('Spanish')).getByText('OCR data not installed')).toBeInTheDocument();
    await fireEvent.click(within(card('Spanish')).getByRole('button', { name: 'Install OCR data for Spanish' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/languages/es/ocr')).toBe(true));
  });
});

describe('Languages stacked below 900px', () => {
  beforeEach(() => __setViewportForTests({ stacked: true }));

  it('arriving shows the list only', async () => {
    render(Languages);
    await screen.findByRole('button', { name: /^Spanish / });
    expect(item('Italian')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Spanish' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('choosing a language shows its panel with Back; Back returns to the list and focuses it', async () => {
    render(Languages);
    await screen.findByRole('button', { name: /^Spanish / });
    await pick('Italian');
    expect(within(card('Italian')).getByText('Model not installed')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Languages' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await tick();
    expect(screen.queryByRole('region', { name: 'Italian' })).toBeNull();
    await waitFor(() => expect(item('Italian')).toHaveFocus());
    expect(item('Italian')).toHaveAttribute('aria-pressed', 'true');
  });
});
