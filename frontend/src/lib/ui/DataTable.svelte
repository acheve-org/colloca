<script module lang="ts">
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  function fold(s: string): string {
    return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  }
</script>

<script lang="ts" generics="Row">
  import { tick, type Snippet } from 'svelte';
  import { t } from '../i18n';
  import { cellValue, type Column, type SortState } from './DataTable.types';

  interface Props {
    columns: Column<Row>[];
    rows: Row[];
    rowKey: (r: Row, i: number) => string | number;
    selected?: Row | null;
    filter?: string;
    sort?: SortState | null;
    loading?: boolean;
    emptyText?: string;
    onactivate?: (r: Row) => void;
    onselect?: (r: Row | null) => void;
    cell?: Snippet<[Row, Column<Row>]>;
    rowClass?: (r: Row) => string;
  }

  let {
    columns,
    rows,
    rowKey,
    selected = $bindable(null),
    filter = $bindable(''),
    sort = $bindable(null),
    loading = false,
    emptyText,
    onactivate,
    onselect,
    cell,
    rowClass,
  }: Props = $props();

  const PAGE = 10;
  let wrap: HTMLElement | undefined = $state();

  // Searchable text per row, rebuilt only when rows/columns change.
  const haystack = $derived(
    rows.map((r) => fold(columns.map((c) => String(cellValue(r, c))).join('\u0001'))),
  );

  const view = $derived.by(() => {
    const q = fold(filter.trim());
    let idx = rows.map((_, i) => i);
    if (q) idx = idx.filter((i) => haystack[i].includes(q));
    if (sort) {
      const col = columns.find((c) => c.key === sort!.key);
      if (col) {
        const get = col.sortValue ?? ((r: Row) => cellValue(r, col));
        const keys = new Map<number, string | number>(idx.map((i) => [i, get(rows[i])]));
        const sign = sort.dir === 'asc' ? 1 : -1;
        idx.sort((a, b) => {
          const x = keys.get(a)!;
          const y = keys.get(b)!;
          const c =
            typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
          return c * sign || a - b;
        });
      }
    }
    return idx.map((i) => ({ row: rows[i], key: rowKey(rows[i], i) }));
  });

  // Selection is tracked by key: a bindable prop assigned locally is wrapped in a
  // reactive proxy, so object identity against `rows` cannot be relied on.
  let selectedKey: string | number | undefined = $state.raw(undefined);

  $effect(() => {
    const s = selected;
    if (s == null) {
      selectedKey = undefined;
      return;
    }
    const i = rows.indexOf(s);
    if (i >= 0) selectedKey = rowKey(rows[i], i);
  });

  function ariaSort(col: Column<Row>): 'ascending' | 'descending' | 'none' | undefined {
    if (col.sortable === false) return undefined;
    if (sort?.key !== col.key) return 'none';
    return sort.dir === 'asc' ? 'ascending' : 'descending';
  }

  function toggleSort(col: Column<Row>) {
    if (col.sortable === false) return;
    if (sort?.key !== col.key) sort = { key: col.key, dir: 'asc' };
    else if (sort.dir === 'asc') sort = { key: col.key, dir: 'desc' };
    else sort = null;
  }

  function select(row: Row | null, key?: string | number) {
    selectedKey = key;
    selected = row;
    onselect?.(row);
  }

  async function reveal(index: number) {
    await tick();
    const el = wrap?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }

  function moveTo(index: number) {
    if (!view.length) return;
    const i = Math.max(0, Math.min(view.length - 1, index));
    select(view[i].row, view[i].key);
    reveal(i);
  }

  function onkeydown(e: KeyboardEvent) {
    const cur = selectedKey === undefined ? -1 : view.findIndex((v) => v.key === selectedKey);
    switch (e.key) {
      case 'ArrowDown':
        moveTo(cur + 1);
        break;
      case 'ArrowUp':
        moveTo(cur < 0 ? view.length - 1 : cur - 1);
        break;
      case 'PageDown':
        moveTo(cur + PAGE);
        break;
      case 'PageUp':
        moveTo(cur < 0 ? 0 : cur - PAGE);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(view.length - 1);
        break;
      case 'Enter':
        if (cur >= 0) onactivate?.(view[cur].row);
        break;
      default:
        return;
    }
    e.preventDefault();
  }
</script>

<div class="dt" bind:this={wrap}>
  <div
    class="grid"
    role="grid"
    tabindex="0"
    aria-busy={loading}
    aria-rowcount={view.length + 1}
    {onkeydown}
  >
    <div class="row head" role="row" style:grid-template-columns={columns.map((c) => c.width ?? '1fr').join(' ')}>
      {#each columns as col (col.key)}
        <div
          class="th"
          class:num={col.num}
          class:sortable={col.sortable !== false}
          role="columnheader"
          aria-sort={ariaSort(col)}
          tabindex={col.sortable === false ? undefined : 0}
          onclick={() => toggleSort(col)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              toggleSort(col);
            }
          }}
        >
          {col.label}
          {#if sort?.key === col.key}<span class="arrow" aria-hidden="true">{sort.dir === 'asc' ? '▲' : '▼'}</span>{/if}
        </div>
      {/each}
    </div>
    {#each view as v, i (v.key)}
      <!-- Keyboard handling lives on the grid (roving selection), not on each row. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
      <div
        class="row body {rowClass?.(v.row) ?? ''}"
        class:selected={v.key === selectedKey}
        role="row"
        data-index={i}
        aria-selected={v.key === selectedKey}
        style:grid-template-columns={columns.map((c) => c.width ?? '1fr').join(' ')}
        onclick={() => select(v.row, v.key)}
        ondblclick={() => onactivate?.(v.row)}
      >
        {#each columns as col (col.key)}
          <div class="td" class:num={col.num} role="gridcell">
            {#if cell}{@render cell(v.row, col)}{:else}{cellValue(v.row, col)}{/if}
          </div>
        {/each}
      </div>
    {/each}
    {#if !view.length}
      <div class="status" role="row"><div role="gridcell">{loading ? t('table.loading') : (emptyText ?? t('common.noResults'))}</div></div>
    {/if}
  </div>
</div>

<style>
  .dt {
    overflow: auto;
    height: 100%;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
  }
  .grid {
    min-width: max-content;
    outline: none;
  }
  .grid:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .row {
    display: grid;
    min-height: var(--row-h);
    align-items: center;
  }
  .head {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font-weight: 600;
  }
  .th,
  .td {
    padding: 0 0.6rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .th.sortable {
    cursor: pointer;
    user-select: none;
  }
  .th.sortable:hover {
    color: var(--fg);
  }
  .arrow {
    font-size: 0.7em;
    margin-left: 0.25em;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .body {
    border-bottom: 1px solid var(--line);
    cursor: default;
  }
  .body:hover {
    background: var(--surface);
  }
  .body.selected {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .status {
    padding: 1rem;
    color: var(--muted);
    text-align: center;
  }
</style>
