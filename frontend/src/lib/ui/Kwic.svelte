<script module lang="ts">
  import type { ConcLine } from '../types';

  /** Unique key of a concordance hit (document + token position). */
  export function lineKey(l: ConcLine): string {
    return `${l.doc_id}:${l.pos}`;
  }

  /** Words of the left context, nearest first: sorts like the API's "left context" sort. */
  function leftSortKey(l: ConcLine): string {
    return l.left.toLowerCase().split(/\s+/).filter(Boolean).reverse().join(' ');
  }
</script>

<script lang="ts">
  import { t } from '../i18n';
  import { sourceRanges, targetIsGuess, targetRanges, termRanges } from '../highlight';
  import DataTable from './DataTable.svelte';
  import type { Column } from './DataTable.types';
  import Highlight from './Highlight.svelte';

  interface Props {
    lines: ConcLine[];
    mode: 'kwic' | 'bilingual';
    query: string;
    selected?: ConcLine | null;
    onselect?: (l: ConcLine | null) => void;
    onactivate?: (l: ConcLine) => void;
    /** Likely equivalents (statistical guesses) highlighted in the target segment. */
    likelyEquiv?: string[];
    filter?: string;
    loading?: boolean;
    emptyText?: string;
  }

  let {
    lines,
    mode,
    query,
    selected = $bindable(null),
    onselect,
    onactivate,
    likelyEquiv = [],
    filter = $bindable(''),
    loading = false,
    emptyText,
  }: Props = $props();

  // Hit number by key, so the rows passed to DataTable stay the caller's objects.
  const order = $derived(new Map(lines.map((l, i) => [lineKey(l), i + 1])));
  const num = (l: ConcLine) => order.get(lineKey(l)) ?? 0;

  // Node column sized to the longest node shown (each row is its own grid).
  const nodeWidth = $derived(
    `${Math.min(28, Math.max(6, query.length, ...lines.map((l) => l.node.length))) + 2}ch`,
  );

  const columns = $derived.by<Column<ConcLine>[]>(() => {
    const n: Column<ConcLine> = { key: 'n', label: t('cc.n'), num: true, width: '3.5rem', value: num };
    const doc: Column<ConcLine> = { key: 'doc', label: t('cc.document'), width: '12rem' };
    if (mode === 'bilingual') {
      return [
        n,
        { key: 'source', label: t('cc.source'), width: 'minmax(0, 1fr)', value: (l) => l.source ?? '' },
        { key: 'target', label: t('cc.target'), width: 'minmax(0, 1fr)', value: (l) => l.target ?? '' },
        doc,
      ];
    }
    return [
      n,
      { key: 'left', label: t('cc.left'), width: 'minmax(0, 1fr)', sortValue: leftSortKey },
      { key: 'node', label: t('cc.node'), width: nodeWidth },
      { key: 'right', label: t('cc.right'), width: 'minmax(0, 1fr)' },
      doc,
    ];
  });
</script>

{#snippet cell(l: ConcLine, col: Column<ConcLine>)}
  {#if col.key === 'n'}
    {num(l)}
  {:else if col.key === 'left'}
    <span class="left"><span><Highlight text={l.left} ranges={termRanges(l.left_terms)} /></span></span>
  {:else if col.key === 'node'}
    <span class="node"><span class="hit-query"><Highlight text={l.node} ranges={termRanges(l.node_terms)} /></span></span>
  {:else if col.key === 'right'}
    <Highlight text={l.right} ranges={termRanges(l.right_terms)} />
  {:else if col.key === 'source'}
    <span class="seg src" data-side="source"><Highlight text={l.source ?? ''} ranges={sourceRanges(l)} /></span>
  {:else if col.key === 'target'}
    <span class="seg tgt" data-side="target" title={targetIsGuess(l, likelyEquiv) ? t('cc.guessHint') : undefined}><Highlight text={l.target ?? ''} ranges={targetRanges(l, likelyEquiv)} /></span>
  {:else}
    <span class="doc" title={l.doc}>{l.doc}</span>
  {/if}
{/snippet}

<div class="kwic" class:bilingual={mode === 'bilingual'}>
  <DataTable
    {columns}
    rows={lines}
    rowKey={lineKey}
    bind:selected
    bind:filter
    {loading}
    {emptyText}
    {onselect}
    {onactivate}
    {cell}
  />
</div>

<style>
  .kwic {
    flex: 1;
    min-height: 0;
  }
  /* Context columns are fluid (minmax(0, 1fr)): fit the pane instead of growing to the longest line. */
  .kwic :global(.grid) {
    min-width: 0;
  }
  /* Left context: right-aligned and clipped on the left, so the words next to the node stay visible. */
  .left {
    display: flex;
    justify-content: flex-end;
    overflow: hidden;
  }
  .left > span {
    flex: none;
  }
  .node {
    display: block;
    text-align: center;
  }
  .kwic :global(.selected .hit-query) {
    outline: 1px solid var(--accent-fg);
  }
  .seg {
    display: block;
    padding: 3px 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .doc {
    color: var(--muted);
  }
  .kwic :global(.selected .doc) {
    color: inherit;
  }
</style>
