<script lang="ts" generics="Row extends { item: string; pos?: string }">
  import { type Flagged, visible } from '../lib/candidates.svelte';
  import { t } from '../lib/i18n';
  import DataTable from '../lib/ui/DataTable.svelte';
  import { cellValue, type Column } from '../lib/ui/DataTable.types';
  import ReviewActions from '../lib/ui/ReviewActions.svelte';
  import ReviewControls from '../lib/ui/ReviewControls.svelte';
  import ReviewStatus from '../lib/ui/ReviewStatus.svelte';
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
    /**
     * Candidate review (T02): adds the status column, the drop / send-to-candidates buttons and the
     * "only not in termbase" / "show dropped" switches. `origin` is the termbase origin of an accepted term,
     * `measure` names the score column `score` (a key of the row).
     */
    review?: { origin: string; measure?: string; score?: string };
  }
  let { columns, rows, loading = false, summary, note, unit, onterm, review }: Props = $props();

  // Selection compared by key inside DataTable; raw so rows are never proxied.
  let selected = $state.raw<Row | null>(null);
  let filter = $state('');

  const STATUS_KEY = '_status';
  const flagged = (r: Row) => r as Row & Flagged;
  const shown = $derived(review ? visible(rows.map(flagged)) as Row[] : rows);
  const allColumns = $derived<Column<Row>[]>([
    ...columns.slice(0, 1),
    ...(review ? [{ key: STATUS_KEY, label: t('cand.col.status'), sortable: false, width: '9rem' }] : []),
    ...columns.slice(1),
    ...(onterm
      ? [{ key: TERM_KEY, label: t('ex.col.term'), sortable: false, width: review ? '13rem' : '6rem' }]
      : []),
  ]);
  const numeric = (r: Row, k?: string): number | null => {
    const v = k ? (r as Record<string, unknown>)[k] : null;
    return typeof v === 'number' ? v : null;
  };
  const rowKey = (r: Row) => `${r.item}\u0001${r.pos ?? ''}`;
</script>

{#snippet cell(row: Row, col: Column<Row>)}
  {#if col.key === 'item' && unit}
    <WordLink word={row.item} {unit} />
  {:else if col.key === STATUS_KEY}
    <ReviewStatus row={flagged(row)} />
  {:else if col.key === TERM_KEY && review}
    <ReviewActions
      item={row.item}
      pos={row.pos ?? ''}
      origin={review.origin}
      measure={review.measure ?? 'frequency'}
      score={numeric(row, review.score ?? 'freq')}
      freq={numeric(row, 'freq')}
      flags={flagged(row)}
    />
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
  {#if review}<ReviewControls />{/if}
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
    rows={shown}
    {rowKey}
    bind:selected
    bind:filter
    {loading}
    {cell}
    emptyText={shown.length ? t('ex.noFilterMatch') : t('common.noResults')}
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
