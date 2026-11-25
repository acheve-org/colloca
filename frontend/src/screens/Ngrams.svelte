<script lang="ts">
  import { get } from '../lib/api';
  import { scopeParams } from '../lib/corpus.svelte';
  import { csvUrl } from '../lib/csv';
  import { initialParams, toInt, useRunner } from '../lib/explore.svelte';
  import { t } from '../lib/i18n';
  import { go } from '../lib/router.svelte';
  import { openTerm } from '../lib/term.svelte';
  import type { NgramRow } from '../lib/types';
  import type { Column } from '../lib/ui/DataTable.types';
  import ReadyHint from '../lib/ui/ReadyHint.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import ExploreScreen from './ExploreScreen.svelte';
  import ExploreTable from './ExploreTable.svelte';

  const NS = ['2', '3', '4', '5'];
  const initial = initialParams();
  let n = $state(NS.includes(initial.n ?? '') ? initial.n! : '3');
  let unit = $state(initial.unit === 'lemma' ? 'lemma' : 'form');
  let minFreq = $state<number | null>(toInt(initial.min, 2));
  let minDocs = $state<number | null>(toInt(initial.docs, 1));
  let edge = $state(initial.edge === '1');

  interface Result {
    path: string;
    params: Record<string, string | number | boolean>;
    n: string;
    unit: string;
  }
  let rows = $state.raw<NgramRow[]>([]);
  let result = $state.raw<Result | null>(null);

  const runner = useRunner({
    reset: () => {
      rows = [];
      result = null;
    },
    autoRun: Object.keys(initial).length > 0,
    run: () => run(),
  });

  const nOptions = NS.map((v) => ({ value: v, label: v }));
  const unitOptions = $derived(['form', 'lemma'].map((u) => ({ value: u, label: t(`ex.unit.${u}`) })));
  const csvHref = $derived(result ? csvUrl(result.path, result.params) : '');
  const columns = $derived.by<Column<NgramRow>[]>(() => [
    { key: 'item', label: t('ex.col.ngram', { n: result?.n ?? n }), width: 'minmax(14rem, 3fr)' },
    { key: 'freq', label: t('ex.col.freq'), num: true },
    { key: 'docs', label: t('ex.col.docs'), num: true },
  ]);

  function run(): void {
    const min = toInt(minFreq, 2);
    const docs = toInt(minDocs, 1);
    minFreq = min;
    minDocs = docs;
    const params = { n, unit, min_freq: min, min_docs: docs, edge_stop: edge, ...scopeParams() };
    runner.exec(
      (id) => get<NgramRow[]>(`/api/corpora/${id}/ngrams`, params),
      (r, id) => {
        rows = r;
        result = { path: `/api/corpora/${id}/ngrams`, params, n, unit };
        go('ngrams', { n, unit, min: String(min), docs: String(docs), edge: edge ? '1' : '' });
      },
    );
  }
</script>

<ExploreScreen label={t('ex.ng.toolbar')} runLabel={t('ex.run.show')} onrun={run} pending={!result && runner.idle} {csvHref}>
  {#snippet fields()}
    <Field label={t('ex.ng.n')}><Select label={t('ex.ng.n')} bind:value={n} options={nOptions} /></Field>
    <Field label={t('ex.unit')}><Select label={t('ex.unit')} bind:value={unit} options={unitOptions} /></Field>
    <Field label={t('ex.minFreq')}><input type="number" min="1" bind:value={minFreq} /></Field>
    <Field label={t('ex.ng.minDocs')}><input type="number" min="1" bind:value={minDocs} /></Field>
    <span class="switch"><Toggle bind:checked={edge} label={t('ex.ng.edge')} /></span>
  {/snippet}

  {#if result}
    <ExploreTable
      {columns}
      {rows}
      loading={runner.loading}
      summary={t('ex.ng.summary', { n: rows.length })}
      unit={result.unit}
      review={{ origin: 'ngram', measure: 'frequency', score: 'freq' }}
      onterm={(r) => openTerm({ source: r.item, origin: 'ngram' })}
    />
  {:else if !runner.loading}
    <ReadyHint title={t('ex.ng.start')} hint={t('ex.ng.startHint')} />
  {/if}
</ExploreScreen>
