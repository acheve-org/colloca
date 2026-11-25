<script lang="ts">
  import { get } from '../lib/api';
  import { scopeParams } from '../lib/corpus.svelte';
  import { initialParams, useRunner } from '../lib/explore.svelte';
  import { fmt, t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import { go } from '../lib/router.svelte';
  import { openTerm } from '../lib/term.svelte';
  import type { RelatedResult, RelatedRow } from '../lib/types';
  import type { Column } from '../lib/ui/DataTable.types';
  import ReadyHint from '../lib/ui/ReadyHint.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import ExploreScreen from './ExploreScreen.svelte';
  import ExploreTable from './ExploreTable.svelte';

  const SOURCES = ['corpus', 'model', 'both'];
  const initial = initialParams();
  let q = $state(initial.q ?? '');
  let source = $state(SOURCES.includes(initial.src ?? '') ? (initial.src as string) : 'corpus');
  let pos = $state(initial.pos ?? '');
  let withBase = $state(initial.base === '1');

  let result = $state.raw<RelatedResult | null>(null);

  const runner = useRunner({
    reset: () => {
      result = null;
    },
    autoRun: !!initial.q?.trim(),
    run: () => run(),
  });

  const sourceOptions = $derived(SOURCES.map((s) => ({ value: s, label: t(`rel.source.${s}`) })));
  const columns = $derived<Column<RelatedRow>[]>([
    { key: 'item', label: t('rel.col.item'), width: 'minmax(12rem, 2fr)' },
    { key: 'pos', label: t('ex.col.pos'), width: '6rem' },
    { key: 'similarity', label: t('rel.col.similarity'), num: true },
    { key: 'freq', label: t('rel.col.freq'), num: true, value: (r) => r.freq ?? '' },
  ]);

  function run(): void {
    const word = q.trim();
    if (!word) {
      messages.say(t('rel.typeWord'), 'err');
      return;
    }
    runner.exec(
      (id) => get<RelatedResult>(`/api/corpora/${id}/related`, { q: word, source, pos: pos.trim(), with_base: withBase, limit: 30, ...scopeParams() }),
      (r) => {
        result = r;
        go('related', { q: word, src: source, pos: pos.trim(), base: withBase ? '1' : '' });
      },
    );
  }

  const shown = $derived(
    (['corpus', 'model'] as const).filter((s) => result && s in result.sources),
  );
</script>

<ExploreScreen label={t('rel.toolbar')} runLabel={t('rel.run')} onrun={run} pending={!result && runner.idle}>
  {#snippet fields()}
    <Field label={t('rel.word')}>
      <input bind:value={q} placeholder={t('rel.wordPlaceholder')} size="20" autocomplete="off" spellcheck="false" />
    </Field>
    <Field label={t('rel.sourceLabel')}><Select label={t('rel.sourceLabel')} bind:value={source} options={sourceOptions} /></Field>
    <Field label={t('ex.pos')}><input bind:value={pos} placeholder="NOUN" size="8" /></Field>
    <span class="switch" title={t('rel.withBaseHint')}><Toggle bind:checked={withBase} label={t('rel.withBase')} /></span>
  {/snippet}

  {#if result}
    <p class="notice">{t('rel.statistical')}</p>
    {#each shown as s (s)}
      {@const info = result.sources[s]!}
      {@const rows = result.related[s] ?? []}
      <section aria-labelledby="rel-{s}">
        <h3 id="rel-{s}">{t(`rel.heading.${s}`, { q: result.query })}</h3>
        {#if s === 'corpus' && info.trained}
          <p class="muted">{t('rel.corpusInfo', { n: fmt(info.tokens ?? 0), v: fmt(info.vocabulary ?? 0) })}</p>
          {#if info.small}<p class="muted warn">{t('rel.small')}</p>{/if}
        {/if}
        {#if s === 'model' && info.name}<p class="muted">{t('rel.modelInfo', { name: info.name })}</p>{/if}
        {#if rows.length}
          <ExploreTable
            {columns}
            {rows}
            summary={t('rel.count', { n: rows.length })}
            unit="lemma"
            onterm={(r) => openTerm({ source: r.item, pos: r.pos, origin: 'manual' })}
          />
        {:else}
          <p class="empty">{info.reason || t('rel.none')}</p>
        {/if}
      </section>
    {/each}
  {:else if !runner.loading}
    <ReadyHint title={t('rel.start')} hint={t('rel.startHint')} />
  {/if}
</ExploreScreen>

<style>
  .notice,
  .muted,
  .empty {
    margin: 0;
    padding: var(--s-1) var(--s-3);
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .notice {
    border-bottom: 1px solid var(--line);
    font-weight: 600;
  }
  .warn {
    color: var(--fg);
  }
  h3 {
    margin: var(--s-2) var(--s-3) 0;
    font-size: var(--fs-base);
  }
  section {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
</style>
