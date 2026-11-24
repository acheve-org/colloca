<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from '../lib/api';
  import {
    accept,
    basket,
    type Candidate,
    dropTerms,
    type Flagged,
    flagsFor,
    inTermbase,
    isDropped,
    normTerm,
    removeCandidates,
    restoreTerms,
    setTranslation,
    STOPLIST_CHANGED,
    syncBasket,
    visible,
  } from '../lib/candidates.svelte';
  import { CORPUS_CHANGED, corpusStore } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import { TERM_SAVED } from '../lib/term.svelte';
  import DataTable from '../lib/ui/DataTable.svelte';
  import { cellValue, type Column } from '../lib/ui/DataTable.types';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import ReviewControls from '../lib/ui/ReviewControls.svelte';
  import ReviewStatus from '../lib/ui/ReviewStatus.svelte';
  import WordLink from '../lib/ui/WordLink.svelte';

  type Row = Candidate & Flagged;

  // The server's flags of the basket's terms (in termbase, dropped), refreshed on every change.
  let flags = $state.raw<Record<string, Flagged>>({});
  let stop = $state.raw<{ term: string; created: string }[]>([]);
  let selected = $state.raw<Row | null>(null);
  let filter = $state('');

  const rows = $derived<Row[]>(
    basket.items.map((c) => ({ ...c, in_termbase: flags[normTerm(c.item)]?.in_termbase ?? '', dropped: flags[normTerm(c.item)]?.dropped ?? false })),
  );
  const shown = $derived(visible(rows));

  const columns = $derived<Column<Row>[]>([
    { key: '_status', label: t('cand.col.status'), sortable: false, width: '9rem',
      value: (r) => (isDropped(r) ? 'dropped' : inTermbase(r) ? 'in termbase' : 'candidate') },
    { key: 'item', label: t('cand.col.term'), width: 'minmax(12rem, 2fr)' },
    { key: 'pos', label: t('ex.col.pos'), width: '6rem' },
    { key: 'score', label: t('cand.col.score'), num: true, width: '11rem',
      value: (r) => (r.score === null ? '' : t('cand.measure', { measure: r.measure, score: r.score })),
      sortValue: (r) => r.score ?? 0 },
    { key: 'freq', label: t('ex.col.freq'), num: true },
    { key: 'origin', label: t('cand.col.origin'), width: '7rem' },
    { key: 'example', label: t('cand.col.example'), width: 'minmax(14rem, 3fr)' },
    { key: 'translation', label: t('cand.col.translation'), sortable: false, width: 'minmax(10rem, 1.5fr)' },
    { key: '_actions', label: t('cand.col.actions'), sortable: false, width: '15rem' },
  ]);

  async function refresh(): Promise<void> {
    syncBasket();
    const id = corpusStore.currentId;
    if (id === null) return;
    const [f, s] = await Promise.all([
      flagsFor(basket.items.map((c) => c.item)),
      get<{ term: string; created: string }[]>(`/api/corpora/${id}/rejections`).catch(() => []),
    ]);
    flags = Object.fromEntries(f.map((x, i) => [normTerm(basket.items[i]?.item ?? x.item), x]));
    stop = s;
  }

  async function doAccept(c: Row): Promise<void> {
    if (await accept(c)) {
      removeCandidates([c.item]);
      await refresh();
    }
  }

  onMount(() => {
    void refresh();
    const again = () => void refresh();
    const onCorpus = () => {
      flags = {};
      void refresh();
    };
    window.addEventListener(TERM_SAVED, again);
    window.addEventListener(STOPLIST_CHANGED, again);
    window.addEventListener(CORPUS_CHANGED, onCorpus);
    return () => {
      window.removeEventListener(TERM_SAVED, again);
      window.removeEventListener(STOPLIST_CHANGED, again);
      window.removeEventListener(CORPUS_CHANGED, onCorpus);
    };
  });
</script>

{#snippet cell(row: Row, col: Column<Row>)}
  {#if col.key === '_status'}
    <ReviewStatus row={row} />
  {:else if col.key === 'item'}
    <WordLink word={row.item} unit={row.item.includes(' ') ? 'form' : 'lemma'} />
  {:else if col.key === 'translation'}
    <input
      class="tr"
      value={row.translation}
      aria-label={t('cand.col.translation')}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      oninput={(e) => setTranslation(row.item, e.currentTarget.value)}
    />
  {:else if col.key === '_actions'}
    <span class="actions">
      <button type="button" title={t('cand.acceptHint')} onclick={(e) => { e.stopPropagation(); void doAccept(row); }}
        >{t('cand.accept')}</button
      >
      {#if isDropped(row)}
        <button type="button" onclick={(e) => { e.stopPropagation(); void restoreTerms([row.item]); }}
          >{t('cand.restore')}</button
        >
      {:else}
        <button type="button" onclick={(e) => { e.stopPropagation(); void dropTerms([row.item]); }}
          >{t('cand.drop')}</button
        >
      {/if}
      <button type="button" onclick={(e) => { e.stopPropagation(); removeCandidates([row.item]); void refresh(); }}
        >{t('cand.remove')}</button
      >
    </span>
  {:else}
    {cellValue(row, col)}
  {/if}
{/snippet}

<div class="cand">
  {#if corpusStore.currentId === null}
    {#if corpusStore.loaded}<EmptyState title={t('corpus.selectFirst')} />{/if}
  {:else}
    <div class="strip">
      <span class="count">{t('cand.summary', { n: shown.length })}</span>
      <ReviewControls />
      <input class="filter" type="search" bind:value={filter} placeholder={t('cc.filter')} aria-label={t('cc.filter')} />
    </div>
    <p class="note">{t('cand.intro')}</p>
    {#if basket.items.length}
      <div class="table">
        <DataTable
          {columns}
          rows={shown}
          rowKey={(r) => normTerm(r.item)}
          bind:selected
          bind:filter
          {cell}
          emptyText={t('ex.noFilterMatch')}
        />
      </div>
    {:else}
      <EmptyState title={t('cand.empty')} hint={t('cand.emptyHint')} />
    {/if}
    <details class="stop" open={stop.length > 0}>
      <summary>{t('cand.stoplist', { n: stop.length })}</summary>
      <p class="note">{t('cand.stoplistHint')}</p>
      {#if stop.length}
        <ul>
          {#each stop as s (s.term)}
            <li>
              <span>{s.term}</span>
              <button type="button" onclick={() => restoreTerms([s.term])}>{t('cand.restore')}</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="note">{t('cand.stoplistEmpty')}</p>
      {/if}
    </details>
  {/if}
</div>

<style>
  .cand {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
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
  }
  .table {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 12rem;
  }
  .stop {
    padding: var(--s-2) var(--s-3);
    border-top: 1px solid var(--line);
  }
  .stop ul {
    margin: 0;
    padding: 0 var(--s-3);
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .stop li {
    display: inline-flex;
    gap: var(--s-1);
    align-items: center;
  }
  .tr {
    width: 100%;
  }
  .actions {
    display: inline-flex;
    gap: var(--s-1);
  }
  button {
    height: auto;
    padding: 0 var(--s-2);
    font-size: var(--fs-small);
  }
</style>
