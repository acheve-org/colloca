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
  import { tick } from 'svelte';
  import { t } from '../i18n';
  import { viewport } from '../viewport.svelte';
  import { sourceRanges, targetIsGuess, targetRanges, termRanges } from '../highlight';
  import DataTable from './DataTable.svelte';
  import { cellValue, foldText, type Column } from './DataTable.types';
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

  // --- Card list (narrow screens). Same filter semantics as DataTable: the folded text of the
  // columns above, accents and case ignored.
  const cardLines = $derived.by(() => {
    const q = foldText(filter.trim());
    if (!q) return lines;
    return lines.filter((l) =>
      foldText(columns.map((c) => String(cellValue(l, c))).join('\u0001')).includes(q),
    );
  });
  const selKey = $derived(selected ? lineKey(selected) : null);
  const focusKey = $derived(
    selKey !== null && cardLines.some((l) => lineKey(l) === selKey)
      ? selKey
      : cardLines.length
        ? lineKey(cardLines[0])
        : null,
  );
  let listEl: HTMLElement | undefined = $state();

  function choose(l: ConcLine | null) {
    selected = l;
    onselect?.(l);
  }

  // A selection the filter hides is dropped, as in the table.
  $effect(() => {
    if (!viewport.narrow || selKey === null) return;
    if (!cardLines.some((l) => lineKey(l) === selKey)) choose(null);
  });

  async function moveTo(i: number) {
    if (!cardLines.length) return;
    const l = cardLines[Math.max(0, Math.min(cardLines.length - 1, i))];
    choose(l);
    await tick();
    const el = [...(listEl?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find(
      (n) => n.dataset.key === lineKey(l),
    );
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest' });
  }

  function onlistkeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // The current card is the focused one, else the selected one.
    const focusedKey = (e.target as HTMLElement | null)?.closest<HTMLElement>('[role="option"]')?.dataset.key;
    const curKey = focusedKey ?? selKey;
    const cur = curKey == null ? -1 : cardLines.findIndex((l) => lineKey(l) === curKey);
    if (e.key === 'ArrowDown') moveTo(cur + 1);
    else if (e.key === 'ArrowUp') moveTo(cur < 0 ? cardLines.length - 1 : cur - 1);
    else if (e.key === 'Enter' && cur >= 0) {
      if (lineKey(cardLines[cur]) !== selKey) choose(cardLines[cur]);
      onactivate?.(cardLines[cur]);
    } else return;
    e.preventDefault();
  }
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
  {#if viewport.narrow}
    <!-- Keyboard handling is on the list (roving selection); each card carries the roving tabindex. -->
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div class="cards" role="listbox" aria-label={t('cc.hitsList')} bind:this={listEl} onkeydown={onlistkeydown}>
      {#each cardLines as l (lineKey(l))}
        {@const key = lineKey(l)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="card"
          class:selected={key === selKey}
          role="option"
          aria-selected={key === selKey}
          tabindex={key === focusKey ? 0 : -1}
          data-key={key}
          onclick={() => choose(l)}
          ondblclick={() => onactivate?.(l)}
        >
          {#if mode === 'bilingual'}
            <div class="card-text">
              <span class="seg src" data-side="source"><Highlight text={l.source ?? ''} ranges={sourceRanges(l)} /></span>
              <span class="seg tgt" data-side="target" title={targetIsGuess(l, likelyEquiv) ? t('cc.guessHint') : undefined}><Highlight text={l.target ?? ''} ranges={targetRanges(l, likelyEquiv)} /></span>
            </div>
          {:else}
            <div class="card-text"><Highlight text={l.left} ranges={termRanges(l.left_terms)} /> <span class="hit-query"><Highlight text={l.node} ranges={termRanges(l.node_terms)} /></span> <Highlight text={l.right} ranges={termRanges(l.right_terms)} /></div>
          {/if}
          <div class="card-meta"><span class="card-n">{num(l)}</span> · <span class="doc" title={l.doc}>{l.doc}</span></div>
        </div>
      {:else}
        <div class="card-empty">{loading ? t('table.loading') : (emptyText ?? t('common.noResults'))}</div>
      {/each}
    </div>
  {:else}
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
  {/if}
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
    outline: 1px solid var(--fg);
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
  /* Narrow screens: one card per hit. */
  .cards {
    height: 100%;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-2);
    border: 1px solid var(--line);
    background: var(--panel);
  }
  .card {
    flex: none;
    padding: var(--s-2) var(--s-3);
    background: var(--panel);
    border: 2px solid var(--line);
    border-radius: var(--radius-lg);
    color: var(--fg);
    cursor: default;
  }
  .card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .card.selected {
    background: var(--accent-soft);
    border-color: var(--accent);
    box-shadow: inset 4px 0 0 var(--accent); /* left-edge bar like the table: not colour-only */
  }
  .card-text {
    overflow-wrap: anywhere;
  }
  .card-text .seg {
    display: block;
    padding: 2px 0;
  }
  .card-meta {
    margin-top: var(--s-1);
    color: var(--muted);
    font-size: var(--fs-small);
    overflow-wrap: anywhere;
  }
  .card.selected .card-meta {
    color: var(--fg);
  }
  .card-empty {
    padding: 1rem;
    color: var(--muted);
    text-align: center;
  }
</style>
