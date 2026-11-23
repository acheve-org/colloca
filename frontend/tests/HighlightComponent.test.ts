import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import Highlight from '../src/lib/ui/Highlight.svelte';

describe('Highlight', () => {
  it('renders hostile text literally, never as HTML', () => {
    for (const text of ['<img src=x onerror=alert(1)>', '&amp;', '<script>alert(1)</script>']) {
      const { container, unmount } = render(Highlight, { text, ranges: [] });
      expect(container.textContent).toBe(text);
      expect(container.querySelector('img, script')).toBeNull();
      unmount();
    }
  });

  it('renders hostile text literally inside highlighted spans', () => {
    const text = 'a <img src=x onerror=alert(1)> &amp; b';
    const { container } = render(Highlight, {
      text,
      ranges: [{ start: 2, end: 30, kind: 'forbidden' }],
    });
    expect(container.textContent).toBe(text);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('span.hit-forbidden')?.textContent).toBe(text.slice(2, 30));
  });

  it('wraps ranges in spans with the semantic class', () => {
    const { container } = render(Highlight, {
      text: 'one two three four',
      ranges: [
        { start: 0, end: 3, kind: 'query' },
        { start: 4, end: 7, kind: 'equiv' },
        { start: 8, end: 13, kind: 'term' },
      ],
    });
    expect(container.textContent).toBe('one two three four');
    expect([...container.querySelectorAll('span[class^="hit-"]')].map((s) => [s.className, s.textContent])).toEqual([
      ['hit-query', 'one'],
      ['hit-equiv', 'two'],
      ['hit-term', 'three'],
    ]);
  });

  it('merges overlapping ranges and tolerates out-of-bounds ones', () => {
    const { container } = render(Highlight, {
      text: 'abcdef',
      ranges: [
        { start: 0, end: 4, kind: 'equiv' },
        { start: 2, end: 99, kind: 'query' },
      ],
    });
    expect(container.textContent).toBe('abcdef');
    expect([...container.querySelectorAll('span')].map((s) => [s.className, s.textContent])).toEqual([
      ['hit-equiv', 'ab'],
      ['hit-query', 'cdef'],
    ]);
  });
});
