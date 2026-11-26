import { describe, expect, it } from 'vitest';
import { baseSources } from '../src/lib/baseSources';

const doc = (source: string, n_tokens: number, title = `${source} (part 1)`) => ({ source, title, n_tokens });

describe('baseSources', () => {
  it('groups the parts of each file, in import order', () => {
    expect(baseSources([doc('news.txt', 100), doc('web.txt', 50), doc('news.txt', 70)])).toEqual([
      { source: 'news.txt', parts: 2, words: 170 },
      { source: 'web.txt', parts: 1, words: 50 },
    ]);
  });

  it('falls back to the title without its part suffix when there is no source', () => {
    expect(baseSources([doc('', 10, 'wiki.txt (part 1)'), doc('', 5, 'wiki.txt (part 2)')])).toEqual([
      { source: 'wiki.txt', parts: 2, words: 15 },
    ]);
  });

  it('is empty for an empty base corpus', () => expect(baseSources([])).toEqual([]));
});
