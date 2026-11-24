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
