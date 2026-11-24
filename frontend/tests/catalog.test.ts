import { describe, expect, it } from 'vitest';
import { chunk, filterLinks, type Link } from '../src/lib/catalog';

const links: Link[] = [
  { url: 'https://news.example/2026/uno', text: 'Primera noticia', same_host: true },
  { url: 'https://news.example/blog/dos', text: 'Segunda', same_host: true },
  { url: 'https://other.example/2026/tres', text: 'Tercera NOTICIA', same_host: false },
];

describe('filterLinks', () => {
  it('matches the address and the text, ignoring case', () => {
    expect(filterLinks(links, '/2026/', false).map((l) => l.text)).toEqual(['Primera noticia', 'Tercera NOTICIA']);
    expect(filterLinks(links, 'noticia', false)).toHaveLength(2);
  });
  it('honours same-host only', () => {
    expect(filterLinks(links, '', true).map((l) => l.text)).toEqual(['Primera noticia', 'Segunda']);
  });
  it('keeps everything for an empty query', () => {
    expect(filterLinks(links, '  ', false)).toHaveLength(3);
  });
});

describe('chunk', () => {
  it('splits in order into groups of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it('gives nothing for an empty list', () => {
    expect(chunk([], 3)).toEqual([]);
  });
});
