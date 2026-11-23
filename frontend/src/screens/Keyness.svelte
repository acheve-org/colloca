<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from '../lib/api';
  import { corpusStore, scopeParams } from '../lib/corpus.svelte';
  import { csvUrl } from '../lib/csv';
  import { initialParams, keynessMemo, toInt, useRunner } from '../lib/explore.svelte';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import { go } from '../lib/router.svelte';
  import { openTerm } from '../lib/term.svelte';
  import type { Corpus, KeynessRow } from '../lib/types';
  import type { Column } from '../lib/ui/DataTable.types';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import ExploreScreen from './ExploreScreen.svelte';
  import ExploreTable from './ExploreTable.svelte';

  /** '' = the language's base corpus (the API's default), a number = another corpus of the language. */
  const NONE = 'none';

  const initial = initialParams();
  let ref = $state(initial.ref ?? '');
  let minFreq = $state<number | null>(toInt(initial.min, 3));
  let pos = $state(initial.pos ?? '');

  let refs = $state.raw<Corpus[]>([]);
  let refsLoaded = $state(false);

  interface Result {
    path: string;
    params: Record<string, string | number>;
  }
  let rows = $state.raw<KeynessRow[]>([]);
  let result = $state.raw<Result | null>(null);

  const runner = useRunner({
    reset: () => {
      rows = [];
      result = null;
      ref = '';
    },
    // A restored route runs once the reference choices are known and `ref` is one of them.
    autoRun: Object.keys(initial).length > 0,
    ready: () => refsLoaded && refOptions.some((o) => o.value === ref),
    run: () => run(),
  });

  const current = $derived(corpusStore.current);
  const refOptions = $derived.by(() => {
    if (!current) return [];
    const base = refs.find((r) => r.lang === current.lang && r.tokens > 0);
    const words = (c: Corpus) => c.tokens.toLocaleString();
    const opts = [
      ...(base ? [{ value: '', label: t('ex.ky.base', { name: base.name, words: words(base) }) }] : []),
      ...corpusStore.list
        .filter((c) => c.id !== current.id && c.lang === current.lang)
        .map((c) => ({ value: String(c.id), label: t('ex.ky.other', { name: c.name, words: words(c) }) })),
    ];
    return opts.length ? opts : [{ value: NONE, label: t('ex.ky.none') }];
  });

  // Keep the selection valid for the options (language changes with the corpus).
  $effect(() => {
    if (!refsLoaded || !corpusStore.loaded || !current) return;
    if (!refOptions.some((o) => o.value === ref)) ref = refOptions[0].value;
  });

  const csvHref = $derived(result ? csvUrl(result.path, result.params) : '');
  const columns = $derived.by<Column<KeynessRow>[]>(() => [
    { key: 'item', label: t('ex.col.lemma'), width: 'minmax(12rem, 2fr)' },
    { key: 'pos', label: t('ex.col.pos'), width: '6rem' },
    { key: 'freq', label: t('ex.col.freq'), num: true },
    { key: 'ref_freq', label: t('ex.col.refFreq'), num: true },
    { key: 'per_million', label: t('ex.col.perM'), num: true },
    { key: 'ref_per_million', label: t('ex.col.refPerM'), num: true },
    { key: 'log_ratio', label: t('ex.col.logRatio'), num: true },
    { key: 'll', label: t('ex.col.ll'), num: true },
  ]);

  async function loadRefs(): Promise<void> {
    try {
      refs = await get<Corpus[]>('/api/references');
    } catch (err) {
      messages.say(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      refsLoaded = true;
    }
  }

  function run(): void {
    if (ref === NONE) {
      messages.say(t('ex.ky.needRef'), 'err');
      return;
    }
    const min = toInt(minFreq, 3);
    minFreq = min;
    const memo = { ref, min_freq: min, pos: pos.trim() };
    const params = { ...memo, ...scopeParams() };
    runner.exec(
      (id) => get<KeynessRow[]>(`/api/corpora/${id}/keyness`, params),
      (r, id) => {
        rows = r;
        result = { path: `/api/corpora/${id}/keyness`, params };
        keynessMemo.last = memo;
        go('keyness', { ref, min: String(min), pos: pos.trim() });
      },
    );
  }

  onMount(() => {
    loadRefs(); // the base corpora do not depend on the current corpus; refOptions filters by language
  });
</script>

<ExploreScreen label={t('ex.ky.toolbar')} runLabel={t('ex.run.compare')} onrun={run} {csvHref}>
  {#snippet fields()}
    <Field label={t('ex.ky.ref')}><Select label={t('ex.ky.ref')} bind:value={ref} options={refOptions} /></Field>
    <Field label={t('ex.minFreq')}><input type="number" min="1" bind:value={minFreq} /></Field>
    <Field label={t('ex.pos')}><input bind:value={pos} placeholder="NOUN,ADJ" size="10" /></Field>
  {/snippet}

  {#if result}
    <ExploreTable
      {columns}
      {rows}
      loading={runner.loading}
      summary={t('ex.freq.summary', { n: rows.length })}
      note={t('ex.ky.help')}
      unit="lemma"
      onterm={(r) => openTerm({ source: r.item, pos: r.pos, origin: 'keyness' })}
    />
  {:else}
    <EmptyState title={t('ex.ky.start')} hint={t('ex.ky.help')} />
  {/if}
</ExploreScreen>
