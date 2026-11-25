<script lang="ts">
  import { get } from '../lib/api';
  import { scopeParams } from '../lib/corpus.svelte';
  import { csvUrl } from '../lib/csv';
  import { initialParams, useRunner } from '../lib/explore.svelte';
  import { fmt, t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import { go } from '../lib/router.svelte';
  import type { ConcLine, DispersionDoc, DispersionMark, DispersionResult } from '../lib/types';
  import type { Column } from '../lib/ui/DataTable.types';
  import DataTable from '../lib/ui/DataTable.svelte';
  import DocViewer from '../lib/ui/DocViewer.svelte';
  import ReadyHint from '../lib/ui/ReadyHint.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import ExploreScreen from './ExploreScreen.svelte';

  const initial = initialParams();
  let q = $state(initial.q ?? '');
  let unit = $state(initial.unit === 'form' ? 'form' : 'lemma');
  let caseSensitive = $state(initial.case === '1');
  let advanced = $state(initial.adv === '1');

  interface Result {
    path: string;
    params: Record<string, string | number | boolean>;
    query: string;
    data: DispersionResult;
  }
  let result = $state.raw<Result | null>(null);
  let selected = $state.raw<DispersionDoc | null>(null);
  let filter = $state('');

  const runner = useRunner({
    reset: () => {
      result = null;
      selected = null;
      viewerOpen = false;
    },
    autoRun: !!initial.q,
    run: () => run(),
  });

  const unitOptions = $derived(['lemma', 'form'].map((u) => ({ value: u, label: t(`ex.unit.${u}`) })));
  const csvHref = $derived(result ? csvUrl(result.path, result.params) : '');
  const docs = $derived(result?.data.docs ?? []);
  const MARK_CAP = 2000;
  const capped = $derived(docs.some((d) => d.hits > d.marks.length));

  const columns = $derived<Column<DispersionDoc>[]>([
    { key: 'title', label: t('dp.col.doc'), width: 'minmax(10rem, 1.2fr)' },
    { key: 'hits', label: t('dp.col.hits'), num: true, width: '6rem' },
    { key: 'per_million', label: t('dp.col.perMillion'), num: true, width: '7rem', value: (d) => d.per_million },
    { key: 'plot', label: t('dp.col.plot'), sortable: false, width: 'minmax(16rem, 3fr)', value: () => '' },
  ]);

  function run(): void {
    const query = q.trim();
    if (!query) {
      messages.say(t('dp.typeQuery'), 'err');
      return;
    }
    const params = { q: query, unit, case_sensitive: caseSensitive, advanced, ...scopeParams() };
    runner.exec(
      (id) => get<DispersionResult>(`/api/corpora/${id}/dispersion`, params),
      (data, id) => {
        result = { path: `/api/corpora/${id}/dispersion`, params, query, data };
        selected = null;
        go('dispersion', { q: query, unit, case: caseSensitive ? '1' : '', adv: advanced ? '1' : '' });
      },
    );
  }

  // --- reading a hit: the shared document viewer, stepping through every mark of the plot in order
  interface Spot {
    doc: DispersionDoc;
    mark: DispersionMark;
  }
  const spots = $derived<Spot[]>(docs.flatMap((doc) => doc.marks.map((mark) => ({ doc, mark }))));
  let viewerOpen = $state(false);
  let current = $state.raw<Spot | null>(null);
  const index = $derived(current ? spots.findIndex((s) => s.doc === current!.doc && s.mark === current!.mark) : -1);

  function asHit(s: Spot | null): ConcLine | null {
    if (!s) return null;
    return {
      doc_id: s.doc.doc_id,
      doc: s.doc.title,
      pos: s.mark.pos,
      matches: [s.mark.pos, s.mark.pos + s.mark.span - 1],
      left: '',
      node: '',
      right: '',
    };
  }
  function open(s: Spot): void {
    current = s;
    viewerOpen = true;
  }
  function step(by: number): void {
    const next = spots[index + by];
    if (next) current = next;
  }
  function openFirst(doc: DispersionDoc): void {
    if (doc.marks.length) open({ doc, mark: doc.marks[0] });
  }
  /** A click on the bar opens the mark nearest to where it landed. */
  function onPlotClick(e: MouseEvent, doc: DispersionDoc): void {
    if (!doc.marks.length) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const at = box.width ? (e.clientX - box.left) / box.width : 0;
    let best = doc.marks[0];
    for (const m of doc.marks) if (Math.abs(m.at - at) < Math.abs(best.at - at)) best = m;
    open({ doc, mark: best });
  }

  const summary = $derived(
    result
      ? t(result.data.total === 1 ? 'dp.summary1' : 'dp.summary', {
          q: result.query,
          hits: fmt(result.data.total),
          range: result.data.range,
          docs: docs.length,
        })
      : '',
  );
</script>

{#snippet cell(d: DispersionDoc, col: Column<DispersionDoc>)}
  {#if col.key === 'plot'}
    <!-- The bar is a pointer shortcut; the keyboard path is the row (Enter) and the viewer's previous/next. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <div
      class="plot"
      class:empty={!d.hits}
      role="img"
      aria-label={d.hits ? t('dp.plotLabel', { hits: d.hits, title: d.title }) : t('dp.plotNone', { title: d.title })}
      onclick={(e) => onPlotClick(e, d)}
    >
      {#each d.marks as m (m.pos)}<span class="mark" style:left="{m.at * 100}%"></span>{/each}
    </div>
  {:else if col.key === 'hits' || col.key === 'per_million'}
    {fmt(col.key === 'hits' ? d.hits : d.per_million)}
  {:else}
    {d.title}
  {/if}
{/snippet}

<ExploreScreen label={t('dp.toolbar')} runLabel={t('dp.run')} onrun={run} pending={!result && runner.idle} {csvHref}>
  {#snippet fields()}
    <Field label={t('dp.query')}>
      <input bind:value={q} placeholder={t('dp.queryPlaceholder')} size="22" autocomplete="off" spellcheck="false" />
    </Field>
    <Field label={t('cc.unit')}><Select label={t('cc.unit')} bind:value={unit} options={unitOptions} /></Field>
    <span class="switch" title={t('cc.caseHint')}><Toggle bind:checked={caseSensitive} label={t('cc.case')} /></span>
    <span class="switch" title={t('cc.advancedHint')}><Toggle bind:checked={advanced} label={t('cc.advanced')} /></span>
  {/snippet}

  {#if result}
    <div class="strip"><span class="count">{summary}</span></div>
    <p class="note">{t('dp.note')}{capped ? ' ' + t('dp.capped', { n: MARK_CAP }) : ''}</p>
    <div class="table">
      <DataTable
        {columns}
        rows={docs}
        rowKey={(d) => d.doc_id}
        bind:selected
        bind:filter
        loading={runner.loading}
        {cell}
        onactivate={openFirst}
        emptyText={docs.length ? t('ex.noFilterMatch') : t('common.noResults')}
      />
    </div>
  {:else if !runner.loading}
    <ReadyHint title={t('dp.start')} hint={t('dp.startHint')} />
  {/if}
</ExploreScreen>

<DocViewer
  bind:open={viewerOpen}
  hit={asHit(current)}
  index={index + 1}
  total={spots.length}
  onprev={() => step(-1)}
  onnext={() => step(1)}
/>

<style>
  .strip {
    padding: var(--s-1) var(--s-3);
    font-size: var(--fs-small);
    border-bottom: 1px solid var(--line);
  }
  .count {
    font-weight: 600;
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
    min-height: 0;
  }
  .table :global(.dt) {
    border-width: 0;
  }
  .plot {
    position: relative;
    width: 100%;
    height: 18px;
    background: var(--surface);
    border: 1px solid var(--line);
    cursor: pointer;
  }
  .plot.empty {
    cursor: default;
  }
  .mark {
    position: absolute;
    top: 1px;
    bottom: 1px;
    width: 2px;
    margin-left: -1px;
    background: var(--hit-query-fg);
  }
</style>
