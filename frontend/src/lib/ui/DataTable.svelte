<script module lang="ts">
  const collators: Record<string, Intl.Collator> = {};
  /** Sort text by the rules of the interface language (accents and case ignored, numbers by value). */
  function collatorFor(code: string): Intl.Collator {
    return (collators[code] ??= new Intl.Collator(code, { numeric: true, sensitivity: 'base' }));
  }

  let warnedDuplicates = false;
</script>

<script lang="ts" generics="Row">
  import { tick, untrack, type Snippet } from 'svelte';
  import { t, locale } from '../i18n';
  import { viewport } from '../viewport.svelte';
  import { cellValue, foldText, rowHaystack, type Column, type SortState } from './DataTable.types';

  interface Props {
    columns: Column<Row>[];
    rows: Row[];
    /**
     * Must return a unique key per row. Duplicates do not throw, but only the first
     * occurrence can be selected/highlighted, and a warning is logged once in development.
     */
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
    /**
     * Fit the table to its container instead of scrolling sideways: every column may shrink
     * (its minimum becomes 0) and clipped plain cells show their text as a tooltip.
     * Ignored below 640px, where the table scrolls sideways as usual.
     */
    fit?: boolean;
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
    fit = false,
  }: Props = $props();

  const PAGE = 10;

  /** A column width that may shrink to 0: `minmax(a, b)` keeps only its maximum, anything else becomes the maximum. */
  function shrinkable(width: string): string {
    const m = /^minmax\(\s*[^,]+,\s*(.+)\)$/.exec(width.trim());
    return `minmax(0, ${m ? m[1].trim() : width.trim()})`;
  }

  const fitting = $derived(fit && !viewport.narrow);
  const template = $derived(
    columns.map((c) => (fitting ? shrinkable(c.width ?? '1fr') : (c.width ?? '1fr'))).join(' '),
  );
  let wrap: HTMLElement | undefined = $state();
  let headEl: HTMLElement | undefined = $state();

  // Searchable text per row, rebuilt only when rows/columns change: typing in the filter does not re-fold every row.
  const haystack = $derived(rows.map((r) => rowHaystack(r, columns)));

  const view = $derived.by(() => {
    const q = foldText(filter.trim());
    let idx = rows.map((_, i) => i);
    if (q) idx = idx.filter((i) => haystack[i].includes(q));
    if (sort) {
      const col = columns.find((c) => c.key === sort!.key);
      if (col) {
        const get = col.sortValue ?? ((r: Row) => cellValue(r, col));
        const keys = new Map<number, string | number>(idx.map((i) => [i, get(rows[i])]));
        const sign = sort.dir === 'asc' ? 1 : -1;
        const collator = collatorFor(locale.code);
        idx.sort((a, b) => {
          const x = keys.get(a)!;
          const y = keys.get(b)!;
          const c =
            typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
          return c * sign || a - b;
        });
      }
    }
    // Duplicate keys would make the keyed {#each} throw; suffix later occurrences
    // (`ek` is for rendering only, `key` is the caller's rowKey).
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local scratch map, not state
    const seen = new Map<string | number, number>();
    return idx.map((i) => {
      const key = rowKey(rows[i], i);
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      if (n > 0 && import.meta.env.DEV && !warnedDuplicates) {
        warnedDuplicates = true;
        console.warn(`DataTable: duplicate rowKey "${key}"; keys must be unique.`);
      }
      return { row: rows[i], key, ek: n === 0 ? key : `${key}\u0000dup${n}` };
    });
  });

  // --- Virtual scrolling (T26). Above VIRTUAL_MIN rows only the rows near the viewport are in the DOM,
  // between two spacers that stand for the rest. Row heights are measured (a bilingual concordance line
  // wraps), cached by row key, and estimated by their average until measured, so the scrollbar stays
  // plausible and the rows never jump while they are being measured.
  const VIRTUAL_MIN = 400;
  const OVERSCAN = 8;
  const FALLBACK_VIEW = 600; // no layout (tests): assume a viewport this tall
  const FALLBACK_ROW = 28;
  let scrollTop = $state(0);
  let viewH = $state(0);
  let measured = $state(0); // bumped when a new height was recorded, so the window is recomputed
  const heights: Record<string, number> = {};
  const virtual = $derived(view.length > VIRTUAL_MIN);

  const estimate = (): number => {
    const known = Object.values(heights);
    return known.length ? known.reduce((a, b) => a + b, 0) / known.length : FALLBACK_ROW;
  };

  const windowOf = $derived.by(() => {
    const n = view.length;
    if (!virtual) return { start: 0, end: n, top: 0, bottom: 0 };
    void measured;
    const est = estimate();
    const h = (i: number) => heights[view[i].ek] ?? est;
    const vh = viewH || FALLBACK_VIEW;
    const y0 = Math.max(0, scrollTop - est); // the sticky header covers the first row's worth
    let first = 0;
    let acc = 0;
    while (first < n - 1 && acc + h(first) <= y0) acc += h(first++);
    let last = first;
    let bottom = acc;
    while (last < n && bottom < y0 + vh) bottom += h(last++);
    const start = Math.max(0, first - OVERSCAN);
    const end = Math.min(n, last + OVERSCAN);
    let top = 0;
    for (let i = 0; i < start; i++) top += h(i);
    let below = 0;
    for (let i = end; i < n; i++) below += h(i);
    return { start, end, top, bottom: below };
  });
  const shown = $derived(view.slice(windowOf.start, windowOf.end));

  // The height of the scroll area (it changes with the window and the panes around it).
  $effect(() => {
    const el = wrap;
    if (!el) return;
    viewH = el.clientHeight;
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => (viewH = el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Record the height of the rows now on screen.
  $effect(() => {
    if (!virtual || !wrap) return;
    void shown;
    let changed = false;
    for (const el of wrap.querySelectorAll<HTMLElement>('.body[data-ek]')) {
      const h = el.getBoundingClientRect().height;
      const k = el.dataset.ek!;
      if (h > 0 && Math.abs((heights[k] ?? 0) - h) > 0.5) {
        heights[k] = h;
        changed = true;
      }
    }
    if (changed) untrack(() => measured++);
  });

  /** Scroll so the row at view index `index` is on screen (it may not be in the DOM yet). */
  function scrollToIndex(index: number): void {
    if (!wrap || !virtual) return;
    const est = estimate();
    let top = 0;
    for (let i = 0; i < index; i++) top += heights[view[i].ek] ?? est;
    const bottom = top + (heights[view[index].ek] ?? est);
    const head = headEl?.offsetHeight || est;
    const room = (wrap.clientHeight || FALLBACK_VIEW) - head;
    if (top < wrap.scrollTop) wrap.scrollTop = top;
    else if (bottom > wrap.scrollTop + room) wrap.scrollTop = bottom - room;
    scrollTop = wrap.scrollTop;
  }

  // Selection is tracked by key. A bindable prop assigned locally may be wrapped in a
  // reactive proxy, so object identity against `rows` is never relied on; callbacks
  // always receive the original row object.
  let selectedKey: string | number | undefined = $state.raw(undefined);
  let ownRow: Row | null = null; // last raw row this component assigned to `selected`

  $effect(() => {
    const s = selected;
    if (s == null) {
      selectedKey = undefined;
      return;
    }
    // Resolve the key of a (possibly programmatically set) selection.
    let k: string | number | undefined;
    const i = rows.indexOf(s);
    if (i >= 0) k = rowKey(rows[i], i);
    else {
      const j = rows.findIndex((r, n) => rowKey(r, n) === rowKey(s, n));
      if (j >= 0) k = rowKey(rows[j], j);
    }
    const current = view; // dependency: re-reconcile when the visible rows change
    untrack(() => {
      k ??= selectedKey;
      selectedKey = k;
      if (k === undefined) return;
      const entry = current.find((v) => v.key === k);
      if (!entry) {
        select(null);
      } else if (entry.row !== ownRow && entry.row !== s) {
        // rows refetched (or selection set programmatically): point at the current
        // object for that key, without firing onselect
        ownRow = entry.row;
        selected = entry.row;
      }
    });
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
    ownRow = row;
    selected = row;
    onselect?.(row);
  }

  async function reveal(index: number) {
    scrollToIndex(index);
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
    if (e.target !== e.currentTarget || e.ctrlKey || e.altKey || e.metaKey) return;
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

<div
  class="dt"
  class:fit={fitting}
  bind:this={wrap}
  onscroll={() => {
    if (virtual && wrap) scrollTop = wrap.scrollTop;
  }}
>
  <div
    class="grid"
    role="grid"
    tabindex="0"
    aria-busy={loading}
    aria-rowcount={view.length + 1}
    data-virtual={virtual || undefined}
    {onkeydown}
  >
    <div class="row head" role="row" aria-rowindex={1} bind:this={headEl} style:grid-template-columns={template}>
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
    {#if windowOf.top > 0}<div class="spacer" role="presentation" style:height="{windowOf.top}px"></div>{/if}
    {#each shown as v, k (v.ek)}
      {@const i = windowOf.start + k}
      <!-- Keyboard handling lives on the grid (roving selection), not on each row. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
      <div
        class="row body {rowClass?.(v.row) ?? ''}"
        class:selected={v.ek === selectedKey}
        role="row"
        data-index={i}
        data-ek={v.ek}
        aria-rowindex={i + 2}
        aria-selected={v.ek === selectedKey}
        style:grid-template-columns={template}
        onclick={() => select(v.row, v.key)}
        ondblclick={() => onactivate?.(v.row)}
      >
        {#each columns as col (col.key)}
          <div class="td" class:num={col.num} role="gridcell" title={fitting && !cell ? String(cellValue(v.row, col)) : undefined}>
            {#if cell}{@render cell(v.row, col)}{:else}{cellValue(v.row, col)}{/if}
          </div>
        {/each}
      </div>
    {/each}
    {#if windowOf.bottom > 0}<div class="spacer" role="presentation" style:height="{windowOf.bottom}px"></div>{/if}
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
    background: var(--panel);
    color: var(--fg);
  }
  .grid {
    min-width: max-content;
    outline: none;
  }
  .fit .grid {
    min-width: 0;
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
    font-size: 0.7em; /* literal: sort glyph scales with its header */
    margin-left: 0.25em;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .body {
    /* keeps scrollIntoView({block:'nearest'}) from hiding the row under the sticky header */
    scroll-margin-top: var(--row-h);
    border-bottom: 1px solid var(--line);
    cursor: default;
  }
  .body:hover {
    background: var(--surface);
  }
  /* soft selection: tinted row, normal text (accent text is not safe on --accent-soft), accent bar on the left edge */
  .body.selected {
    background: var(--accent-soft);
    color: var(--fg);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  /* status badges keep their own colours: a panel pill stays legible on the tinted row */
  .body.selected :global(.badge) {
    background: var(--panel);
  }
  .status {
    padding: 1rem;
    color: var(--muted);
    text-align: center;
  }
</style>
