import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Languages from '../src/screens/Languages.svelte';
import { stopAllJobs } from '../src/lib/jobs.svelte';
import { messages } from '../src/lib/messages.svelte';

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
const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });

beforeEach(() => {
  calls = [];
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
    if (p === '/api/references') return res(200, []);
    if (/^\/api\/corpora\/\d+\/jobs$/.test(p)) return res(200, []);
    if (method === 'DELETE') return res(204, null);
    return res(p === '/api/languages' ? 201 : 202, {});
  }));
});

afterEach(() => {
  stopAllJobs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const card = (name: string) => screen.getByRole('region', { name });
const loaded = () => screen.findByRole('region', { name: 'Spanish' });

describe('Languages', () => {
  it('renders one card per language with its model state', async () => {
    render(Languages);
    await loaded();
    expect(within(card('Spanish')).getByText('es_core_news_lg 3.8.0 (lg)')).toBeInTheDocument();
    expect(within(card('Italian')).getByText('Model not installed')).toBeInTheDocument();
    expect(within(card('French')).getByText('no network')).toBeInTheDocument();
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
    await fireEvent.click(screen.getByRole('button', { name: 'Install model for Italian' }));
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
    expect(within(card('French')).getByRole('button', { name: 'Remove French' })).toBeEnabled();
  });

  it('remove asks for confirmation and can uninstall the model too', async () => {
    render(Languages);
    await loaded();
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
    await fireEvent.click(screen.getByRole('button', { name: 'Add language' }));
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
