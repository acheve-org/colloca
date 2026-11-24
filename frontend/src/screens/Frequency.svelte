<script lang="ts">
  import { get } from '../lib/api';
  import { scopeParams } from '../lib/corpus.svelte';
  import { csvUrl } from '../lib/csv';
  import { initialParams, toInt, useRunner } from '../lib/explore.svelte';
  import { t } from '../lib/i18n';
  import { go } from '../lib/router.svelte';
  import { openTerm } from '../lib/term.svelte';
  import type { FrequencyRow } from '../lib/types';
  import type { Column } from '../lib/ui/DataTable.types';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import ExploreScreen from './ExploreScreen.svelte';
  import ExploreTable from './ExploreTable.svelte';

  const initial = initialParams();
  let unit = $state(initial.unit === 'form' ? 'form' : 'lemma');
  let pos = $state(initial.pos ?? '');
  let minFreq = $state<number | null>(toInt(initial.min, 2));
  let stop = $state(initial.stop !== '0');
  let withRef = $state(initial.ref === '1');

  interface Result {
    path: string;
    params: Record<string, string | number | boolean>;
    unit: string;
    withRef: boolean;
  }
  let rows = $state.raw<FrequencyRow[]>([]);
  let result = $state.raw<Result | null>(null);

  const runner = useRunner({
    reset: () => {
      rows = [];
      result = null;
    },
    autoRun: Object.keys(initial).length > 0,
    run: () => run(),
  });

  const unitOptions = ['lemma', 'form'].map((u) => ({ value: u, label: t(`ex.unit.${u}`) }));
  const csvHref = $derived(result ? csvUrl(result.path, result.params) : '');
  const columns = $derived.by<Column<FrequencyRow>[]>(() => [
    { key: 'item', label: t(`ex.col.${result?.unit ?? 'lemma'}`), width: 'minmax(12rem, 2fr)' },
    { key: 'pos', label: t('ex.col.pos'), width: '6rem' },
    { key: 'freq', label: t('ex.col.freq'), num: true },
    { key: 'per_million', label: t('ex.col.perMillion'), num: true },
    { key: 'docs', label: t('ex.col.docs'), num: true },
    { key: 'docs_pct', label: t('ex.col.docsPct'), num: true },
    ...(result?.withRef
      ? [{ key: 'ref_per_million', label: t('ex.col.basePerMillion'), num: true } as Column<FrequencyRow>]
      : []),
  ]);

  function run(): void {
    const min = toInt(minFreq, 2);
    minFreq = min;
    const params = {
      unit, pos: pos.trim(), min_freq: min, exclude_stop: stop, with_reference: withRef, limit: 1000,
      ...scopeParams(),
    };
    runner.exec(
      (id) => get<FrequencyRow[]>(`/api/corpora/${id}/frequency`, params),
      (r, id) => {
        rows = r;
        result = { path: `/api/corpora/${id}/frequency`, params, unit, withRef };
        go('frequency', { unit, pos: pos.trim(), min: String(min), stop: stop ? '' : '0', ref: withRef ? '1' : '' });
      },
    );
  }
</script>

<ExploreScreen label={t('ex.freq.toolbar')} runLabel={t('ex.run.show')} onrun={run} {csvHref}>
  {#snippet fields()}
    <Field label={t('ex.unit')}><Select label={t('ex.unit')} bind:value={unit} options={unitOptions} /></Field>
    <Field label={t('ex.pos')}><input bind:value={pos} placeholder="NOUN,VERB" size="12" /></Field>
    <Field label={t('ex.minFreq')}><input type="number" min="1" bind:value={minFreq} /></Field>
    <span class="switch"><Toggle bind:checked={stop} label={t('ex.hideStop')} /></span>
    <span class="switch" title={t('ex.withRefHint')}><Toggle bind:checked={withRef} label={t('ex.withRef')} /></span>
  {/snippet}

  {#if result}
    <ExploreTable
      {columns}
      {rows}
      loading={runner.loading}
      summary={t('ex.freq.summary', { n: rows.length })}
      unit={result.unit}
      review={{ origin: 'frequency', measure: 'frequency', score: 'freq' }}
      onterm={(r) => openTerm({ source: r.item, pos: r.pos, origin: 'frequency' })}
    />
  {:else}
    <EmptyState title={t('ex.freq.start')} hint={t('ex.freq.startHint')} />
  {/if}
</ExploreScreen>
