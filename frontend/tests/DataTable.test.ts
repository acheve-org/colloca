import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import DataTable from '../src/lib/ui/DataTable.svelte';
import type { Column } from '../src/lib/ui/DataTable.types';

type R = { id: number; word: string; n: number };
const columns: Column<R>[] = [
  { key: 'word', label: 'Word', value: (r) => r.word },
  { key: 'n', label: 'Count', num: true, value: (r) => r.n },
];
const rowKey = (r: R) => r.id;
const mk = (words: string[], ns: number[] = []): R[] =>
  words.map((word, i) => ({ id: i, word, n: ns[i] ?? i }));

const bodyRows = () => screen.getAllByRole('row').slice(1);
const texts = (col: number) =>
  bodyRows().map((r) => r.querySelectorAll('[role="gridcell"]')[col].textContent?.trim());
const header = (name: string) => screen.getByRole('columnheader', { name });
const grid = () => screen.getByRole('grid');

describe('DataTable', () => {
  it('sorts numbers numerically, then desc, then restores original order', async () => {
    render(DataTable<R>, { columns, rows: mk(['a', 'b', 'c'], [10, 9, 100]), rowKey });
    expect(texts(1)).toEqual(['10', '9', '100']);
    await fireEvent.click(header('Count'));
    expect(texts(1)).toEqual(['9', '10', '100']);
    expect(header('Count')).toHaveAttribute('aria-sort', 'ascending');
    await fireEvent.click(header('Count'));
    expect(texts(1)).toEqual(['100', '10', '9']);
    expect(header('Count')).toHaveAttribute('aria-sort', 'descending');
    await fireEvent.click(header('Count'));
    expect(texts(1)).toEqual(['10', '9', '100']);
    expect(header('Count')).toHaveAttribute('aria-sort', 'none');
  });

  it('sorts strings accent-insensitively', async () => {
    render(DataTable<R>, { columns, rows: mk(['zeta', 'Éclair', 'eagle', 'árbol']), rowKey });
    await fireEvent.click(header('Word'));
    expect(texts(0)).toEqual(['árbol', 'eagle', 'Éclair', 'zeta']);
  });

  it('filters case- and accent-insensitively', () => {
    render(DataTable<R>, { columns, rows: mk(['Canción', 'perro', 'CANCILLER']), rowKey, filter: 'canci' });
    expect(texts(0)).toEqual(['Canción', 'CANCILLER']);
  });

  it('moves selection with the keyboard and fires onselect', async () => {
    const onselect = vi.fn();
    const rows = mk(['a', 'b', 'c']);
    render(DataTable<R>, { columns, rows, rowKey, onselect });
    const g = grid();
    g.focus();
    await fireEvent.keyDown(g, { key: 'ArrowDown' });
    expect(onselect).toHaveBeenLastCalledWith(rows[0]);
    await fireEvent.keyDown(g, { key: 'ArrowDown' });
    expect(onselect).toHaveBeenLastCalledWith(rows[1]);
    expect(bodyRows()[1]).toHaveAttribute('aria-selected', 'true');
    await fireEvent.keyDown(g, { key: 'End' });
    expect(onselect).toHaveBeenLastCalledWith(rows[2]);
    await fireEvent.keyDown(g, { key: 'ArrowUp' });
    expect(onselect).toHaveBeenLastCalledWith(rows[1]);
    await fireEvent.keyDown(g, { key: 'Home' });
    expect(onselect).toHaveBeenLastCalledWith(rows[0]);
  });

  it('calls onactivate on Enter and double-click', async () => {
    const onactivate = vi.fn();
    const rows = mk(['a', 'b']);
    render(DataTable<R>, { columns, rows, rowKey, onactivate });
    const g = grid();
    await fireEvent.keyDown(g, { key: 'ArrowDown' });
    await fireEvent.keyDown(g, { key: 'Enter' });
    expect(onactivate).toHaveBeenLastCalledWith(rows[0]);
    await fireEvent.dblClick(bodyRows()[1]);
    expect(onactivate).toHaveBeenLastCalledWith(rows[1]);
  });

  it('renders emptyText when there are no rows', () => {
    render(DataTable<R>, { columns, rows: [], rowKey, emptyText: 'Nothing here' });
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('handles 2000 rows with filter and sort quickly', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: i, word: `palabra${(i * 7919) % 2000}`, n: i }));
    const t0 = performance.now();
    render(DataTable<R>, { columns, rows, rowKey, filter: 'palabra1', sort: { key: 'word', dir: 'asc' } });
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(500);
    const w = texts(0) as string[];
    expect(w.length).toBe(1111);
    expect([...w].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))).toEqual(w);
    await fireEvent.click(header('Count'));
    expect(texts(1)[0]).toBe('1');
  });
});
