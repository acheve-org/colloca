import { beforeEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  return await import('../src/lib/router.svelte');
}

describe('router', () => {
  beforeEach(() => {
    location.hash = '';
  });

  it('parses screen and params from the hash', async () => {
    location.hash = '#/concordance?q=a%20b';
    const { route } = await load();
    expect(route.screen).toBe('concordance');
    expect(route.params).toEqual({ q: 'a b' });
  });

  it('go() updates the hash and route', async () => {
    const { route, go } = await load();
    go('collocations', { q: 'x y' });
    expect(location.hash).toBe('#/collocations?q=x%20y');
    expect(route.screen).toBe('collocations');
    expect(route.params).toEqual({ q: 'x y' });
  });

  it('falls back to sources on a bad hash', async () => {
    location.hash = '#/nonsense';
    const { route } = await load();
    expect(route.screen).toBe('sources');
  });

  it('reacts to hashchange', async () => {
    const { route } = await load();
    location.hash = '#/ngrams';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(route.screen).toBe('ngrams');
  });

  it('round-trips awkward values through go()', async () => {
    const { route, go } = await load();
    const params = { q: 'a&b=c+d%e', w: 'naïve 日本?x' };
    go('concordance', params);
    route.params = {};
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(route.screen).toBe('concordance');
    expect(route.params).toEqual(params);
  });

  it('keeps a literal second ? in the query', async () => {
    location.hash = '#/concordance?q=a?b';
    const { route } = await load();
    expect(route.params).toEqual({ q: 'a?b' });
  });
});
