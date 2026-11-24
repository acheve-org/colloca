import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Trash from '../src/screens/Trash.svelte';

const LIST = {
  retention_days: 30,
  corpora: [{ id: 3, name: 'Old corpus', lang: 'es', docs: 2, deleted_at: '2026-01-01 10:00:00' }],
  documents: [{ id: 9, title: 'Lease', corpus: 'ES', aligned: 1, partner: 'Contratto', deleted_at: '2026-01-02 10:00:00' }],
  terms: [],
};

let calls: { url: string; method: string; body?: string }[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
      const json = (x: unknown) => ({ ok: true, status: 200, json: async () => x }) as Response;
      if (url.startsWith('/api/trash') && (init?.method ?? 'GET') === 'GET') return json(LIST);
      if (url.startsWith('/api/projects')) return json([]);
      if (url.startsWith('/api/corpora')) return json([]);
      return json({});
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Trash screen', () => {
  it('lists trashed items with their aligned partner and restores one', async () => {
    render(Trash);
    expect(await screen.findByText('Old corpus')).toBeInTheDocument();
    expect(screen.getByText(/aligned with “Contratto”/)).toBeInTheDocument();
    const restore = screen.getAllByRole('button', { name: 'Restore' });
    await fireEvent.click(restore[1]);
    await waitFor(() => expect(calls.some((c) => c.url === '/api/trash/restore')).toBe(true));
    const sent = calls.find((c) => c.url === '/api/trash/restore')!;
    expect(JSON.parse(sent.body!)).toEqual({ kind: 'document', ids: [9] });
  });

  it('asks before deleting forever', async () => {
    render(Trash);
    await screen.findByText('Old corpus');
    await fireEvent.click(screen.getAllByRole('button', { name: 'Delete forever' })[0]);
    expect(calls.some((c) => c.url === '/api/trash/delete')).toBe(false);
    const all = screen.getAllByRole('button', { name: 'Delete forever', hidden: true });
    await fireEvent.click(all[all.length - 1]);                 // the dialog's own button comes last
    await waitFor(() => expect(calls.some((c) => c.url === '/api/trash/delete')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.url === '/api/trash/delete')!.body!)).toEqual({ kind: 'corpus', ids: [3] });
  });
});

describe('Backup passphrase', () => {
  it('without a passphrase the export is the plain download', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign, set href(v: string) { assign(v); } } });
    render(Trash);
    await screen.findByText('Old corpus');
    await fireEvent.click(screen.getByRole('button', { name: 'Back up the whole database' }));
    expect(assign).toHaveBeenCalledWith('/api/backup');
    expect(calls.some((c) => c.url === '/api/backup/encrypted')).toBe(false);
  });

  it('with a passphrase the export is a POST, and a short one is refused first', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
      if (url === '/api/backup/encrypted') {
        return { ok: true, status: 200, headers: new Headers({ 'content-disposition': 'attachment; filename="b.zip.enc"' }), blob: async () => new Blob(['x']) } as Response;
      }
      const json = (x: unknown) => ({ ok: true, status: 200, json: async () => x }) as Response;
      return url.startsWith('/api/trash') ? json(LIST) : json([]);
    }));
    render(Trash);
    await screen.findByText('Old corpus');
    const pass = screen.getByLabelText('Passphrase to encrypt the export');
    await fireEvent.input(pass, { target: { value: 'short' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Back up the whole database' }));
    expect(calls.some((c) => c.url === '/api/backup/encrypted')).toBe(false);
    await fireEvent.input(pass, { target: { value: 'a long passphrase' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Back up the whole database' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/backup/encrypted')).toBe(true));
    const sent = calls.find((c) => c.url === '/api/backup/encrypted')!;
    expect(sent.method).toBe('POST');
    expect(JSON.parse(sent.body!)).toEqual({ passphrase: 'a long passphrase' });
  });

  it('the import form sends the passphrase of an encrypted file', async () => {
    render(Trash);
    await screen.findByText('Old corpus');
    await fireEvent.change(screen.getByLabelText('Export file (.zip or .json)'), { target: { files: [new File(['x'], 'b.zip.enc')] } });
    await fireEvent.input(screen.getByLabelText('Passphrase (encrypted files)'), { target: { value: 'a long passphrase' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Check (no changes)' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/import')).toBe(true));
    const form = calls.find((c) => c.url === '/api/import')!.body as unknown as FormData;
    expect(form.get('passphrase')).toBe('a long passphrase');
  });
});
