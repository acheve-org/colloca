import { describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Host from './DataTableHost.svelte';
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
    expect(dt).toBeLessThan(2000); // generous: CI runners are slow; this only guards against pathological slowdowns
    expect(grid()).toHaveAttribute('aria-rowcount', '1112'); // 1111 matches + the header; only a window is in the DOM
    const w = texts(0) as string[];
    expect([...w].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))).toEqual(w);
    await fireEvent.click(header('Count'));
    expect(texts(1)[0]).toBe('1');
  });

  it('PageDown/PageUp jump by a page and clamp', async () => {
    const rows = mk(Array.from({ length: 30 }, (_, i) => `w${i}`));
    const onselect = vi.fn();
    render(DataTable<R>, { columns, rows, rowKey, onselect });
    const g = grid();
    await fireEvent.keyDown(g, { key: 'PageDown' });
    expect(onselect).toHaveBeenLastCalledWith(rows[9]);
    await fireEvent.keyDown(g, { key: 'PageDown' });
    expect(onselect).toHaveBeenLastCalledWith(rows[19]);
    await fireEvent.keyDown(g, { key: 'PageDown' });
    expect(onselect).toHaveBeenLastCalledWith(rows[29]);
    await fireEvent.keyDown(g, { key: 'PageUp' });
    expect(onselect).toHaveBeenLastCalledWith(rows[19]);
  });

  it('ArrowUp / End with no selection pick the last row, Home the first', async () => {
    const rows = mk(['a', 'b', 'c']);
    const onselect = vi.fn();
    const { unmount } = render(DataTable<R>, { columns, rows, rowKey, onselect });
    await fireEvent.keyDown(grid(), { key: 'ArrowUp' });
    expect(onselect).toHaveBeenLastCalledWith(rows[2]);
    unmount();
    onselect.mockClear();
    const r2 = render(DataTable<R>, { columns, rows, rowKey, onselect });
    await fireEvent.keyDown(grid(), { key: 'Home' });
    expect(onselect).toHaveBeenLastCalledWith(rows[0]);
    r2.unmount();
    render(DataTable<R>, { columns, rows, rowKey, onselect });
    await fireEvent.keyDown(grid(), { key: 'End' });
    expect(onselect).toHaveBeenLastCalledWith(rows[2]);
  });

  it('click selects, rowClass applies, loading shows state', async () => {
    const rows = mk(['a', 'b']);
    const onselect = vi.fn();
    const { unmount } = render(DataTable<R>, { columns, rows, rowKey, onselect, rowClass: (r: R) => `x-${r.id}` });
    await fireEvent.click(bodyRows()[1]);
    expect(onselect).toHaveBeenLastCalledWith(rows[1]);
    expect(bodyRows()[1]).toHaveAttribute('aria-selected', 'true');
    expect(bodyRows()[0]).toHaveClass('x-0');
    unmount();
    render(DataTable<R>, { columns, rows: [], rowKey, loading: true });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(grid()).toHaveAttribute('aria-busy', 'true');
  });

  describe('selection identity and reconciliation', () => {
    const hostRows = (): R[] => [
      { id: 1, word: 'alpha', n: 1 },
      { id: 2, word: 'beta', n: 2 },
      { id: 3, word: 'gamma', n: 3 },
    ];
    type Probe = { selected: R | null; set: (r: R | null) => void; setFilter: (f: string) => void; setRows: (r: R[]) => void };
    const hostProps = (rows: ReturnType<typeof hostRows>, extra = {}) => ({
      rows,
      columns,
      probe: { selected: null, set() {}, setFilter() {}, setRows() {} } as Probe,
      ...extra,
    });

    it('bind, onselect and onactivate hand back the original row object', async () => {
      const rows = hostRows();
      const onselect = vi.fn();
      const onactivate = vi.fn();
      const props = hostProps(rows, { onselect, onactivate });
      render(Host, props);
      await fireEvent.keyDown(grid(), { key: 'ArrowDown' });
      await fireEvent.keyDown(grid(), { key: 'ArrowDown' });
      expect(onselect.mock.lastCall![0]).toBe(rows[1]);
      expect(props.probe.selected).toBe(rows[1]);
      await fireEvent.keyDown(grid(), { key: 'Enter' });
      expect(onactivate.mock.lastCall![0]).toBe(rows[1]);
    });

    it('a programmatically set selection is highlighted', async () => {
      const rows = hostRows();
      const props = hostProps(rows);
      render(Host, props);
      props.probe.set({ ...rows[2] }); // different object, same key
      await tick();
      expect(bodyRows()[2]).toHaveAttribute('aria-selected', 'true');
      props.probe.set(rows[0]);
      await tick();
      expect(bodyRows()[0]).toHaveAttribute('aria-selected', 'true');
      expect(bodyRows()[2]).toHaveAttribute('aria-selected', 'false');
    });

    it('filtering out the selected row clears the selection', async () => {
      const rows = hostRows();
      const onselect = vi.fn();
      const props = hostProps(rows, { onselect });
      render(Host, props);
      await fireEvent.click(bodyRows()[0]);
      props.probe.setFilter('gam');
      await tick();
      await tick();
      expect(props.probe.selected).toBeNull();
      expect(onselect).toHaveBeenLastCalledWith(null);
    });

    it('replacing rows with the same keys re-points selected at the new object', async () => {
      const rows = hostRows();
      const onselect = vi.fn();
      const props = hostProps(rows, { onselect });
      render(Host, props);
      await fireEvent.click(bodyRows()[1]);
      const fresh = hostRows();
      onselect.mockClear();
      props.probe.setRows(fresh);
      await tick();
      await tick();
      expect(props.probe.selected).toBe(fresh[1]);
      expect(onselect).not.toHaveBeenCalled();
      expect(bodyRows()[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('replacing rows without the selected key clears the selection', async () => {
      const props = hostProps(hostRows());
      render(Host, props);
      await fireEvent.click(bodyRows()[1]);
      props.probe.setRows([{ id: 9, word: 'zeta', n: 9 }]);
      await tick();
      await tick();
      expect(props.probe.selected).toBeNull();
    });
  });

  it('duplicate rowKeys do not throw', () => {
    const rows = mk(['a', 'b', 'c']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => render(DataTable<R>, { columns, rows, rowKey: () => 1 })).not.toThrow();
    expect(bodyRows()).toHaveLength(3);
    warn.mockRestore();
  });

  it('ignores keys typed in cell inputs and modified keys', async () => {
    const rows = [{ id: 1, word: 'a', n: 1 }, { id: 2, word: 'b', n: 2 }];
    const onselect = vi.fn();
    render(Host, { rows, columns, onselect, withInput: true, probe: { selected: null, set() {}, setFilter() {}, setRows() {} } });
    const input = screen.getAllByLabelText('edit')[0];
    const notPrevented = await fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(notPrevented).toBe(true);
    expect(onselect).not.toHaveBeenCalled();
    await fireEvent.keyDown(grid(), { key: 'ArrowDown', ctrlKey: true });
    expect(onselect).not.toHaveBeenCalled();
  });
});

describe('DataTable virtual scrolling', () => {
  const big = (n: number): R[] => Array.from({ length: n }, (_, i) => ({ id: i, word: `w${String(i).padStart(5, '0')}`, n: i }));
  const dt = () => document.querySelector('.dt') as HTMLElement;
  const spacers = () => [...document.querySelectorAll<HTMLElement>('.spacer')].map((e) => parseFloat(e.style.height));
  const indexes = () => bodyRows().map((r) => Number(r.getAttribute('data-index')));

  it('keeps small tables whole: every row is in the DOM below the threshold', () => {
    render(DataTable<R>, { columns, rows: big(300), rowKey });
    expect(bodyRows()).toHaveLength(300);
    expect(document.querySelector('.spacer')).toBeNull();
    expect(grid()).not.toHaveAttribute('data-virtual');
  });

  it('renders only a window of a large table and says how many rows there are', () => {
    render(DataTable<R>, { columns, rows: big(20000), rowKey });
    expect(bodyRows().length).toBeLessThan(80);
    expect(grid()).toHaveAttribute('aria-rowcount', '20001');
    expect(grid()).toHaveAttribute('data-virtual');
    expect(indexes()[0]).toBe(0);
    expect(bodyRows()[0]).toHaveAttribute('aria-rowindex', '2');
    // the spacer below stands for the rows that are not rendered
    const [below] = spacers();
    expect(below).toBe((20000 - bodyRows().length) * 28);
  });

  it('follows the scroll position, with spacers above and below', async () => {
    render(DataTable<R>, { columns, rows: big(20000), rowKey });
    dt().scrollTop = 28 * 5000;
    await fireEvent.scroll(dt());
    const ix = indexes();
    expect(ix[0]).toBeGreaterThan(4900);
    expect(ix[0]).toBeLessThan(5000);
    expect(ix).toContain(5000);
    expect(texts(0)).toContain('w05000');
    const [top, bottom] = spacers();
    expect(top).toBe(ix[0] * 28);
    expect(top + bottom + ix.length * 28).toBe(20000 * 28);
  });

  it('keyboard navigation reaches rows that are not rendered yet (End, Home, PageDown)', async () => {
    const onselect = vi.fn();
    const rows = big(20000);
    render(DataTable<R>, { columns, rows, rowKey, onselect });
    await fireEvent.keyDown(grid(), { key: 'End' });
    expect(onselect).toHaveBeenLastCalledWith(rows[19999]);
    expect(texts(0)).toContain('w19999');
    expect(document.querySelector('.body.selected')).not.toBeNull();
    await fireEvent.keyDown(grid(), { key: 'Home' });
    expect(onselect).toHaveBeenLastCalledWith(rows[0]);
    expect(texts(0)[0]).toBe('w00000');
    await fireEvent.keyDown(grid(), { key: 'PageDown' });
    expect(onselect).toHaveBeenLastCalledWith(rows[10]);
  });

  it('sorting and filtering keep working on the whole data, not on the window', async () => {
    render(DataTable<R>, { columns, rows: big(5000), rowKey });
    await fireEvent.click(header('Count'));
    await fireEvent.click(header('Count'));
    expect(texts(0)[0]).toBe('w04999'); // descending: the last row of the data comes first
  });

  it('a filter that leaves few rows drops back to the plain table', () => {
    render(DataTable<R>, { columns, rows: big(5000), rowKey, filter: 'w0004' });
    expect(bodyRows()).toHaveLength(10);
    expect(grid()).not.toHaveAttribute('data-virtual');
    expect(document.querySelector('.spacer')).toBeNull();
  });

  it('clicking a row in the window selects it and the click handler gets the original row', async () => {
    const onselect = vi.fn();
    const rows = big(5000);
    render(DataTable<R>, { columns, rows, rowKey, onselect });
    await fireEvent.click(bodyRows()[3]);
    expect(onselect).toHaveBeenLastCalledWith(rows[3]);
    expect(bodyRows()[3]).toHaveAttribute('aria-selected', 'true');
  });
});
