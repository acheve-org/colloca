import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, get, post, del } from '../src/lib/api';
import { csvUrl } from '../src/lib/csv';
import { t } from '../src/lib/i18n';

function mockFetch(status: number, body?: unknown, statusText = '') {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('drops empty and null params but keeps false', async () => {
    const f = mockFetch(200, []);
    await get('/api/x', { a: '', b: null, c: undefined, d: false, e: 0, f: 'q' });
    const url = (f.mock.calls[0] as unknown as [string])[0];
    expect(url).toBe('/api/x?d=false&e=0&f=q');
  });

  it('rejects a 400 with the detail string', async () => {
    mockFetch(400, { detail: 'x' });
    const err = (await get('/api/x').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('x');
    expect(err.status).toBe(400);
  });

  it('stringifies a list detail (422)', async () => {
    mockFetch(422, { detail: [{ msg: 'bad' }] });
    const err = (await post('/api/x', {}).catch((e) => e)) as ApiError;
    expect(err.message).toBe(JSON.stringify([{ msg: 'bad' }]));
    expect(err.status).toBe(422);
  });

  it('falls back to statusText when the body is not JSON', async () => {
    mockFetch(500, undefined, 'Server Error');
    const err = (await get('/api/x').catch((e) => e)) as ApiError;
    expect(err.message).toBe('Server Error');
  });

  it('resolves null on 204', async () => {
    mockFetch(204);
    expect(await del('/api/x/1')).toBeNull();
  });
});

describe('csvUrl', () => {
  it('adds format=csv and drops empties', () => {
    expect(csvUrl('/api/c/1/frequency', { unit: 'lemma', pos: '' })).toBe(
      '/api/c/1/frequency?unit=lemma&format=csv',
    );
  });
});

describe('i18n', () => {
  it('returns the key when unknown', () => {
    expect(t('no.such.key')).toBe('no.such.key');
  });
  it('interpolates variables', () => {
    expect(t('scope.summary', { docs: 2, total: 5 })).toContain('2');
  });
});
