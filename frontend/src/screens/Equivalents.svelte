<script lang="ts">
  import { get } from '../lib/api';
  import { scopeParams } from '../lib/corpus.svelte';
  import { csvUrl } from '../lib/csv';
  import { initialParams, toInt, useRunner } from '../lib/explore.svelte';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import { go } from '../lib/router.svelte';
  import { openTerm } from '../lib/term.svelte';
  import type { EquivalentRow, EquivalentsResult } from '../lib/types';
  import type { Column } from '../lib/ui/DataTable.types';
  import ReadyHint from '../lib/ui/ReadyHint.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import ExploreScreen from './ExploreScreen.svelte';
  import ExploreTable from './ExploreTable.svelte';

  const initial = initialParams();
  let q = $state(initial.q ?? '');
  let unit = $state(initial.unit === 'form' ? 'form' : 'lemma');
  let minFreq = $state<number | null>(toInt(initial.min, 2));
  let pos = $state(initial.pos ?? '');

  interface Result {
    path: string;
    params: Record<string, string | number>;
    query: string;
    segments: number;
  }
  let rows = $state.raw<EquivalentRow[]>([]);
  let result = $state.raw<Result | null>(null);

  const runner = useRunner({
    reset: () => {
      rows = [];
      result = null;
    },
    autoRun: !!initial.q?.trim(),
    run: () => run(),
  });

  const unitOptions = $derived([
    { value: 'lemma', label: t('ex.unit.lemma') },
    { value: 'form', label: t('ex.unit.exact') },
  ]);
  const csvHref = $derived(result ? csvUrl(result.path, result.params) : '');
  const columns = $derived.by<Column<EquivalentRow>[]>(() => [
    { key: 'item', label: t('ex.col.equivalent'), width: 'minmax(12rem, 2fr)' },
    { key: 'pos', label: t('ex.col.pos'), width: '6rem' },
    { key: 'cooc', label: t('ex.col.together'), num: true },
    { key: 'node_segments', label: t('ex.col.sourceSegs'), num: true },
    { key: 'target_segments', label: t('ex.col.targetSegs'), num: true },
    { key: 'dice', label: t('ex.col.dice'), num: true },
    { key: 'logdice', label: t('ex.col.logdice'), num: true },
  ]);

  function run(): void {
    const query = q.trim();
    if (!query) {
      messages.say(t('ex.eq.typeSource'), 'err');
      return;
    }
    const min = toInt(minFreq, 2);
    minFreq = min;
    const params = { q: query, unit, min_freq: min, pos: pos.trim(), ...scopeParams() };
    runner.exec(
      (id) => get<EquivalentsResult>(`/api/corpora/${id}/equivalents`, params),
      (res, id) => {
        rows = res.rows;
        result = { path: `/api/corpora/${id}/equivalents`, params, query, segments: res.node_segments };
        go('equivalents', { q: query, unit, min: String(min), pos: pos.trim() });
      },
    );
  }
</script>

<ExploreScreen label={t('ex.eq.toolbar')} runLabel={t('ex.run.find')} onrun={run} pending={!result && runner.idle} {csvHref}>
  {#snippet fields()}
    <Field label={t('ex.eq.source')}>
      <input bind:value={q} placeholder={t('ex.eq.sourcePlaceholder')} size="24" autocomplete="off" spellcheck="false" />
    </Field>
    <Field label={t('ex.eq.match')}><Select label={t('ex.eq.match')} bind:value={unit} options={unitOptions} /></Field>
    <Field label={t('ex.eq.minSegs')}><input type="number" min="1" bind:value={minFreq} /></Field>
    <Field label={t('ex.pos')}><input bind:value={pos} placeholder="NOUN" size="8" /></Field>
  {/snippet}

  {#if result}
    <!-- Items are target-language lemmas: not searchable in this (source) corpus, so no word links. -->
    <ExploreTable
      {columns}
      {rows}
      loading={runner.loading}
      summary={t(result.segments === 1 ? 'ex.eq.summary1' : 'ex.eq.summary', { q: result.query, n: result.segments })}
      note={t('ex.eq.help')}
      onterm={(r) => openTerm({ source: result!.query, target: r.item, origin: 'equivalent' })}
    />
  {:else if !runner.loading}
    <ReadyHint title={t('ex.eq.start')} hint={t('ex.eq.help')} />
  {/if}
</ExploreScreen>
