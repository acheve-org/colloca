import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TermImport from '../src/screens/TermImport.svelte';

const res = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });
let sent: { path: string; form: FormData }[];
const report = (applied: boolean) => ({
  format: 'sheet', src_lang: 'es', tgt_lang: 'it', applied, to_add: 2, duplicates: 1, rejected: 1, total: 4,
  sample: [], duplicate_rows: [{ row: 3, src_term: 'a', tgt_term: 'b' }],
  rejected_rows: [{ row: 4, src_term: 'c', tgt_term: '', reason: 'A approved entry needs a translation' }],
});

beforeEach(() => {
  sent = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname;
    sent.push({ path, form: init?.body as FormData });
    if (path === '/api/languages') return res(200, { es: 'Spanish', it: 'Italian' });
    if (path.endsWith('/preview')) {
      return res(200, { kind: 'sheet', rows: [['Source', 'Translation'], ['a', 'b']], columns: 2, total_rows: 1,
        header: true, mapping: { src_term: 0, tgt_term: 1 } });
    }
    return res(200, report((init?.body as FormData).get('dry_run') === 'false'));
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('TermImport', () => {
  it('previews, runs a dry run, then applies the import', async () => {
    const onimported = vi.fn();
    render(TermImport, { open: true, projects: [{ id: 7, name: 'Acme', corpora: 1, trashed: 0 }], scope: '7', onimported });
    const input = screen.getByLabelText(/File \(/) as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['Source,Translation\na,b\n'], 'g.csv')] } });
    await waitFor(() => expect(screen.getByLabelText('Meaning of column 1')).toBeTruthy());
    expect((screen.getByLabelText('Meaning of column 2') as HTMLSelectElement).value).toBe('tgt_term');
    await waitFor(() => expect((screen.getByLabelText('Source language') as HTMLSelectElement).value).toBe('es'));
    const apply = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);                       // nothing is stored before the check
    await fireEvent.click(screen.getByRole('button', { name: 'Check file' }));
    await waitFor(() => expect(screen.getByText(/2 to add/)).toBeTruthy());
    expect(screen.getByText(/needs a translation/)).toBeTruthy();
    const dry = sent.at(-1)!.form;
    expect(dry.get('dry_run')).toBe('true');
    expect(dry.get('project_id')).toBe('7');
    expect(JSON.parse(String(dry.get('mapping')))).toEqual({ src_term: 0, tgt_term: 1 });
    await fireEvent.click(screen.getByRole('button', { name: 'Import 2 entries' }));
    await waitFor(() => expect(onimported).toHaveBeenCalled());
    expect(sent.at(-1)!.form.get('dry_run')).toBe('false');
  });
});
