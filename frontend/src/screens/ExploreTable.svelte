<script lang="ts" generics="Row extends { item: string; pos?: string }">
  import { t } from '../lib/i18n';
  import DataTable from '../lib/ui/DataTable.svelte';
  import { cellValue, type Column } from '../lib/ui/DataTable.types';
  import WordLink from '../lib/ui/WordLink.svelte';

  /** The key of the column holding the `+ Term` button (added when `onterm` is set). */
  const TERM_KEY = '_term';

  interface Props {
    columns: Column<Row>[];
    rows: Row[];
    loading?: boolean;
    /** Count line above the table. */
    summary: string;
    /** Explanatory line under the count (muted). */
    note?: string;
    /** Makes the `item` cells links to the Concordance, searching by this unit. */
    unit?: string;
    onterm?: (r: Row) => void;
  }
  let { columns, rows, loading = false, summary, note, unit, onterm }: Props = $props();

  // Selection compared by key inside DataTable; raw so rows are never proxied.
  let selected = $state.raw<Row | null>(null);
  let filter = $state('');

  const allColumns = $derived<Column<Row>[]>(
    onterm ? [...columns, { key: TERM_KEY, label: t('ex.col.term'), sortable: false, width: '6rem' }] : columns,
  );
  const rowKey = (r: Row) => `${r.item}\u0001${r.pos ?? ''}`;
</script>

{#snippet cell(row: Row, col: Column<Row>)}
  {#if col.key === 'item' && unit}
    <WordLink word={row.item} {unit} />
  {:else if col.key === TERM_KEY}
    <button
      type="button"
      class="term"
      title={t('cc.addTermHint')}
      onclick={(e) => {
        e.stopPropagation();
        onterm?.(row);
      }}>{t('cc.addTerm')}</button
    >
  {:else}
    {cellValue(row, col)}
  {/if}
{/snippet}

<div class="strip">
  <span class="count">{summary}</span>
  <input
    class="filter"
    type="search"
    bind:value={filter}
    placeholder={t('cc.filter')}
    aria-label={t('cc.filter')}
  />
</div>
{#if note}<p class="note">{note}</p>{/if}
<div class="table">
  <DataTable
    columns={allColumns}
    {rows}
    {rowKey}
    bind:selected
    bind:filter
    {loading}
    {cell}
    emptyText={rows.length ? t('ex.noFilterMatch') : t('common.noResults')}
  />
</div>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-3);
    font-size: var(--fs-small);
    border-bottom: 1px solid var(--line);
  }
  .count {
    font-weight: 600;
  }
  .filter {
    width: 14rem;
    margin-left: var(--s-2);
  }
  .note {
    margin: 0;
    padding: var(--s-1) var(--s-3);
    color: var(--muted);
    font-size: var(--fs-small);
    border-bottom: 1px solid var(--line);
  }
  .table {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .table :global(.dt) {
    border-width: 0;
  }
  .term {
    height: auto;
    padding: 0 var(--s-2);
    font-size: var(--fs-small);
  }
</style>
