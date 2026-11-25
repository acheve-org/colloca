import { tick } from 'svelte';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setViewportForTests } from '../src/lib/viewport.svelte';
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

  it('uses the server marks: only the hit occurrence in the source, the guess dotted in the target', () => {
    render(Kwic, {
      lines: [
        line(1, {
          source: 'El contrato y el contrato nuevo.',
          target: 'Il contratto e il contratto nuovo.',
          source_marks: [{ start: 17, end: 25 }],
          target_marks: [{ start: 3, end: 12, score: 0.8, guess: true }],
        }),
      ],
      mode: 'bilingual',
      query: 'contrato',
      selected: null,
    });
    const row = bodyRows()[0];
    const q = row.querySelectorAll('.hit-query');
    expect(q).toHaveLength(1);
    const before = Array.from(row.querySelector('.src')!.childNodes)
      .slice(0, Array.from(row.querySelector('.src')!.childNodes).indexOf(q[0]))
      .map((n) => n.textContent)
      .join('');
    expect(before).toBe('El contrato y el '); // the second occurrence is marked, not the first
    const eq = row.querySelectorAll('.hit-equiv');
    expect(eq).toHaveLength(1);
    expect(eq[0].textContent).toBe('contratto');
    expect(row.querySelector('.tgt')?.getAttribute('title')).toMatch(/guess/i);
  });

  it('shows an approved termbase translation as a term hit, without the guess label', () => {
    render(Kwic, {
      lines: [
        line(1, {
          source: 'El contrato.',
          target: 'Il contratto.',
          source_marks: [{ start: 3, end: 11 }],
          target_marks: [{ start: 3, end: 12, score: 1, guess: false }],
        }),
      ],
      mode: 'bilingual',
      query: 'contrato',
      selected: null,
    });
    const row = bodyRows()[0];
    expect(row.querySelector('.tgt .hit-term')?.textContent).toBe('contratto');
    expect(row.querySelector('.hit-equiv')).toBeNull();
    expect(row.querySelector('.tgt')).not.toHaveAttribute('title');
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

  it('marks termbase hits with the approved translation on hover, and forbidden ones with a warning', () => {
    const mark = (start: number, end: number, over = {}) => ({
      start, end, kind: 'term' as const, term: 'casa', of: '', translations: ['casa'], forbidden: [], ids: [1], ...over,
    });
    render(Kwic, {
      lines: [
        line(1, {
          source: 'La casa es grande.',
          target: 'La dimora è grande.',
          source_terms: [mark(3, 7)],
          target_terms: [mark(3, 9, { kind: 'forbidden', term: 'dimora', translations: ['casa'] })],
        }),
      ],
      mode: 'bilingual',
      query: 'casa',
      selected: null,
    });
    const row = bodyRows()[0];
    // the query word is also a term: it keeps the query look, gains the term underline and the tooltip
    const q = row.querySelector('.src .hit-query');
    expect(q).toHaveClass('in-term');
    expect(q).toHaveAttribute('title', expect.stringContaining('Approved translation: casa'));
    const bad = row.querySelector('.tgt .hit-forbidden');
    expect(bad?.textContent).toBe('dimora');
    expect(bad).toHaveAttribute('title', expect.stringContaining('Forbidden translation'));
    expect(bad).toHaveAttribute('title', expect.stringContaining('Use: casa'));
  });

  it('marks terms in KWIC context columns', () => {
    render(Kwic, {
      lines: [
        line(1, {
          right: 'de arrendamiento',
          right_terms: [{ start: 0, end: 16, kind: 'term', term: 'x', of: '', translations: [], forbidden: ['y'], ids: [1] }],
        }),
      ],
      mode: 'kwic',
      query: 'casa',
      selected: null,
    });
    const t = bodyRows()[0].querySelector('.hit-term');
    expect(t?.textContent).toBe('de arrendamiento');
    expect(t).toHaveAttribute('title', expect.stringContaining('Avoid: y'));
  });
});

describe('Kwic cards (narrow)', () => {
  afterEach(() => __setViewportForTests({ narrow: false }));
  const narrow = () => __setViewportForTests({ narrow: true });
  const cards = () => screen.getAllByRole('option');

  it('renders one card per hit with the full sentence, node highlighted, and a muted meta line', () => {
    narrow();
    render(Kwic, { lines: [line(1), line(2)], mode: 'kwic', query: 'casa', selected: null });
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.getByRole('listbox', { name: 'Hit list' })).toBeInTheDocument();
    expect(cards()).toHaveLength(2);
    const text = cards()[0].querySelector('.card-text')!;
    expect(text.textContent).toBe('left 1 casa right 1');
    expect(within(cards()[0]).getByText('casa')).toHaveClass('hit-query');
    const meta = cards()[0].querySelector('.card-meta')!;
    expect(meta.textContent).toContain('doc1');
    expect(meta.textContent).toContain('1');
  });

  it('renders lines with empty context and keeps long words breakable', () => {
    narrow();
    render(Kwic, { lines: [line(1, { left: '', right: '' })], mode: 'kwic', query: 'casa', selected: null });
    expect(cards()[0].querySelector('.card-text')!.textContent!.trim()).toBe('casa');
    const src = import.meta.glob('../src/lib/ui/Kwic.svelte', { query: '?raw', import: 'default', eager: true });
    expect(Object.values(src)[0] as string).toMatch(/\.card-text[^}]*overflow-wrap:\s*anywhere/s);
  });

  it('click selects and calls onselect; aria-selected follows; Enter and double-click activate', async () => {
    narrow();
    const onselect = vi.fn();
    const onactivate = vi.fn();
    const lines = [line(1), line(2)];
    render(Kwic, { lines, mode: 'kwic', query: 'casa', selected: null, onselect, onactivate });
    await fireEvent.click(cards()[1]);
    expect(onselect).toHaveBeenCalledWith(lines[1]);
    expect(cards()[1]).toHaveAttribute('aria-selected', 'true');
    expect(cards()[0]).toHaveAttribute('aria-selected', 'false');
    expect(cards()[1]).toHaveAttribute('tabindex', '0');
    expect(cards()[0]).toHaveAttribute('tabindex', '-1');
    await fireEvent.keyDown(cards()[1], { key: 'Enter' });
    expect(onactivate).toHaveBeenCalledWith(lines[1]);
    await fireEvent.dblClick(cards()[0]);
    expect(onactivate).toHaveBeenCalledWith(lines[0]);
  });

  it('ArrowDown and ArrowUp move the selection', async () => {
    narrow();
    const onselect = vi.fn();
    const lines = [line(1), line(2), line(3)];
    render(Kwic, { lines, mode: 'kwic', query: 'casa', selected: null, onselect });
    await fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(onselect).toHaveBeenLastCalledWith(lines[0]);
    await fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(onselect).toHaveBeenLastCalledWith(lines[1]);
    await fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' });
    expect(onselect).toHaveBeenLastCalledWith(lines[0]);
    expect(cards()[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter on a focused, unselected card selects and activates that card', async () => {
    narrow();
    const onactivate = vi.fn();
    const lines = [line(1), line(2), line(3)];
    render(Kwic, { lines, mode: 'kwic', query: 'casa', selected: null, onactivate });
    cards()[1].focus();
    await fireEvent.keyDown(cards()[1], { key: 'Enter' });
    expect(onactivate).toHaveBeenCalledWith(lines[1]);
    expect(cards()[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowDown from a focused unselected card moves to the next card', async () => {
    narrow();
    const onselect = vi.fn();
    const lines = [line(1), line(2), line(3)];
    render(Kwic, { lines, mode: 'kwic', query: 'casa', selected: null, onselect });
    cards()[1].focus();
    await fireEvent.keyDown(cards()[1], { key: 'ArrowDown' });
    expect(onselect).toHaveBeenLastCalledWith(lines[2]);
  });

  it('bilingual mode shows source then target with highlights', () => {
    narrow();
    render(Kwic, {
      lines: [line(1, { source: 'La casa es grande.', target: 'La casa è grande.' })],
      mode: 'bilingual',
      query: 'casa',
      selected: null,
      likelyEquiv: ['grande'],
    });
    const c = cards()[0];
    const segs = c.querySelectorAll('.seg');
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveClass('src');
    expect(segs[1]).toHaveClass('tgt');
    expect(segs[0].querySelector('.hit-query')!.textContent).toBe('casa');
    expect(segs[1].querySelector('.hit-equiv')!.textContent).toBe('grande');
  });

  it('keeps the selected line selected when switching between cards and table', async () => {
    narrow();
    const lines = [line(1), line(2)];
    render(Kwic, { lines, mode: 'kwic', query: 'casa', selected: lines[1] });
    expect(cards()[1]).toHaveAttribute('aria-selected', 'true');
    __setViewportForTests({ narrow: false });
    await tick();
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(bodyRows()[1]).toHaveAttribute('aria-selected', 'true');
    __setViewportForTests({ narrow: true });
    await tick();
    expect(cards()[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('filters the cards with the quick filter', () => {
    narrow();
    render(Kwic, { lines: [line(1), line(2, { doc: 'zeta' })], mode: 'kwic', query: 'casa', selected: null, filter: 'ZETA' });
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent('zeta');
  });
});
