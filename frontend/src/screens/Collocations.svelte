<script lang="ts">
  import { get } from '../lib/api';
  import { scopeParams } from '../lib/corpus.svelte';
  import { csvUrl } from '../lib/csv';
  import { initialParams, toInt, useRunner } from '../lib/explore.svelte';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import { go } from '../lib/router.svelte';
  import { openTerm } from '../lib/term.svelte';
  import type { CollocationResult, CollocationRow } from '../lib/types';
  import type { Column } from '../lib/ui/DataTable.types';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import ExploreScreen from './ExploreScreen.svelte';
  import ExploreTable from './ExploreTable.svelte';

  const initial = initialParams();
  let q = $state(initial.q ?? '');
  let left = $state<number | null>(toInt(initial.left, 4, 0, 15));
  let right = $state<number | null>(toInt(initial.right, 4, 0, 15));
  let minFreq = $state<number | null>(toInt(initial.min, 2));
  let pos = $state(initial.pos ?? '');
  let stop = $state(initial.stop !== '0');
  let withRef = $state(initial.ref === '1');

  interface Result {
    path: string;
    params: Record<string, string | number | boolean>;
    query: string;
    nodeFreq: number;
    withRef: boolean;
  }
  let rows = $state.raw<CollocationRow[]>([]);
  let result = $state.raw<Result | null>(null);

  const runner = useRunner({
    reset: () => {
      rows = [];
      result = null;
    },
    autoRun: !!initial.q?.trim(),
    run: () => run(),
  });

  const csvHref = $derived(result ? csvUrl(result.path, result.params) : '');
  const columns = $derived.by<Column<CollocationRow>[]>(() => [
    { key: 'item', label: t('ex.col.collocate'), width: 'minmax(12rem, 2fr)' },
    { key: 'pos', label: t('ex.col.pos'), width: '6rem' },
    { key: 'cooc', label: t('ex.col.cooc'), num: true },
    { key: 'freq', label: t('ex.col.corpusFreq'), num: true },
    { key: 'docs', label: t('ex.col.docs'), num: true },
    { key: 'logdice', label: t('ex.col.logdice'), num: true },
    { key: 'mi', label: t('ex.col.mi'), num: true },
    { key: 'tscore', label: t('ex.col.tscore'), num: true },
    { key: 'll', label: t('ex.col.ll'), num: true },
    ...(result?.withRef
      ? [{ key: 'ref_per_million', label: t('ex.col.basePerMillion'), num: true } as Column<CollocationRow>]
      : []),
  ]);

  function run(): void {
    const query = q.trim();
    if (!query) {
      messages.say(t('ex.colloc.typeNode'), 'err');
      return;
    }
    const l = toInt(left, 4, 0, 15);
    const r = toInt(right, 4, 0, 15);
    const min = toInt(minFreq, 2);
    left = l;
    right = r;
    minFreq = min;
    const params = {
      q: query, left: l, right: r, min_freq: min, pos: pos.trim(), exclude_stop: stop, with_reference: withRef,
      ...scopeParams(),
    };
    runner.exec(
      (id) => get<CollocationResult>(`/api/corpora/${id}/collocations`, params),
      (res, id) => {
        rows = res.rows;
        result = { path: `/api/corpora/${id}/collocations`, params, query, nodeFreq: res.node_freq, withRef };
        go('collocations', {
          q: query, left: String(l), right: String(r), min: String(min), pos: pos.trim(),
          stop: stop ? '' : '0', ref: withRef ? '1' : '',
        });
      },
    );
  }
</script>

<ExploreScreen label={t('ex.colloc.toolbar')} runLabel={t('ex.run.find')} onrun={run} {csvHref}>
  {#snippet fields()}
    <Field label={t('ex.colloc.node')}>
      <input bind:value={q} placeholder={t('ex.colloc.nodePlaceholder')} size="20" autocomplete="off" spellcheck="false" />
    </Field>
    <Field label={t('ex.left')}><input type="number" min="0" max="15" bind:value={left} /></Field>
    <Field label={t('ex.right')}><input type="number" min="0" max="15" bind:value={right} /></Field>
    <Field label={t('ex.minFreq')}><input type="number" min="1" bind:value={minFreq} /></Field>
    <Field label={t('ex.pos')}><input bind:value={pos} placeholder="VERB" size="8" /></Field>
    <span class="switch"><Toggle bind:checked={stop} label={t('ex.hideStop')} /></span>
    <span class="switch" title={t('ex.withRefHint')}><Toggle bind:checked={withRef} label={t('ex.withRef')} /></span>
  {/snippet}

  {#if result}
    <ExploreTable
      {columns}
      {rows}
      loading={runner.loading}
      summary={t('ex.colloc.summary', { q: result.query, n: result.nodeFreq })}
      unit="lemma"
      review={{ origin: 'collocation', measure: 'log-likelihood', score: 'll' }}
      onterm={(r) => openTerm({ source: r.item, pos: r.pos, origin: 'collocation' })}
    />
  {:else}
    <EmptyState title={t('ex.colloc.start')} hint={t('ex.colloc.startHint')} />
  {/if}
</ExploreScreen>
