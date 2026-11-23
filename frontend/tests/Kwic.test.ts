import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Kwic from '../src/lib/ui/Kwic.svelte';
import type { ConcLine } from '../src/lib/types';

const line = (i: number, over: Partial<ConcLine> = {}): ConcLine => ({
  doc_id: 1,
  doc: `doc${i}`,
  pos: i * 10,
  left: `left ${i}`,
  node: 'casa',
  right: `right ${i}`,
  ...over,
});

const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
const bodyRows = () => screen.getAllByRole('row').filter((r) => r.classList.contains('body'));

describe('Kwic', () => {
  it('renders KWIC columns with the node highlighted and lines in order', () => {
    render(Kwic, { lines: [line(1), line(2)], mode: 'kwic', query: 'casa', selected: null });
    expect(headers()).toEqual(['#', 'Left', 'Node', 'Right', 'Document']);
    const rows = bodyRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('1left 1casaright 1doc1');
    expect(rows[1]).toHaveTextContent('2left 2casaright 2doc2');
    const node = within(rows[0]).getByText('casa');
    expect(node).toHaveClass('hit-query');
  });

  it('right-aligns the left context', () => {
    render(Kwic, { lines: [line(1)], mode: 'kwic', query: 'casa', selected: null });
    const cell = within(bodyRows()[0]).getByText('left 1');
    expect(cell.closest('.left')).not.toBeNull();
  });

  it('renders corpus text literally (no HTML injection)', () => {
    const evil = '<script>alert(1)</script>';
    const { container } = render(Kwic, {
      lines: [line(1, { left: evil, node: '<b>x</b>', right: '&amp;' })],
      mode: 'kwic',
      query: 'x',
      selected: null,
    });
    expect(screen.getByText(evil)).toBeInTheDocument();
    expect(screen.getByText('<b>x</b>')).toBeInTheDocument();
    expect(screen.getByText('&amp;')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('bilingual mode shows source and target segments with the hit highlighted', () => {
    render(Kwic, {
      lines: [line(1, { source: 'La casa es grande.', target: 'La casa è grande.' })],
      mode: 'bilingual',
      query: 'casa',
      selected: null,
    });
    expect(headers()).toEqual(['#', 'Source segment', 'Target segment', 'Document']);
    const row = bodyRows()[0];
    const hits = row.querySelectorAll('.hit-query');
    expect(hits).toHaveLength(1);
    expect(hits[0].textContent).toBe('casa');
    expect(hits[0].closest('.src')).not.toBeNull();
    expect(row.querySelector('.hit-equiv')).toBeNull();
  });

  it('highlights likely equivalents in the target as equiv', () => {
    render(Kwic, {
      lines: [line(1, { source: 'La casa es grande.', target: 'La casa è grande.' })],
      mode: 'bilingual',
      query: 'casa',
      selected: null,
      likelyEquiv: ['grande'],
    });
    const eq = bodyRows()[0].querySelectorAll('.hit-equiv');
    expect(eq).toHaveLength(1);
    expect(eq[0].textContent).toBe('grande');
    expect(eq[0].closest('.tgt')).not.toBeNull();
  });

  it('marks source and target cells with data-side', () => {
    render(Kwic, {
      lines: [line(1, { source: 'La casa', target: 'La casa' })],
      mode: 'bilingual',
      query: 'casa',
      selected: null,
    });
    const row = bodyRows()[0];
    expect(row.querySelector('.src')).toHaveAttribute('data-side', 'source');
    expect(row.querySelector('.tgt')).toHaveAttribute('data-side', 'target');
    expect(row.querySelector('.tgt')).not.toHaveAttribute('title');
  });

  it('labels the target as a guess when likely equivalents are given', () => {
    render(Kwic, {
      lines: [line(1, { source: 'La casa', target: 'La casa grande' })],
      mode: 'bilingual',
      query: 'casa',
      selected: null,
      likelyEquiv: ['grande'],
    });
    expect(bodyRows()[0].querySelector('.tgt')?.getAttribute('title')).toMatch(/guess/i);
  });

  it('calls onselect with the original line on click', async () => {
    const onselect = vi.fn();
    const lines = [line(1), line(2)];
    render(Kwic, { lines, mode: 'kwic', query: 'casa', selected: null, onselect });
    await fireEvent.click(bodyRows()[1]);
    expect(onselect).toHaveBeenCalledWith(lines[1]);
  });
});
