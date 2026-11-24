<script module lang="ts">
  const ACCEPT = '.docx,.pdf,.odt,.rtf,.xlsx,.csv,.tsv,.xlf,.xliff,.srt,.vtt,.txt,.md,.html,.htm';
  type Kind = 'term' | 'forbidden';
</script>

<script lang="ts">
  import { analysis } from '../lib/analysis.svelte';
  import { qs } from '../lib/api';
  import { type Flagged, visible } from '../lib/candidates.svelte';
  import { corpusStore, scopeParams } from '../lib/corpus.svelte';
  import { toInt } from '../lib/explore.svelte';
  import { findRanges } from '../lib/highlight';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import type { JobGap, JobKeyTerm, JobKnownTerm, JobPhrase } from '../lib/types';
  import Badge from '../lib/ui/Badge.svelte';
  import Button from '../lib/ui/Button.svelte';
  import DataTable from '../lib/ui/DataTable.svelte';
  import { cellValue, type Column } from '../lib/ui/DataTable.types';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Highlight from '../lib/ui/Highlight.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import Toolbar from '../lib/ui/Toolbar.svelte';
  import ReviewActions from '../lib/ui/ReviewActions.svelte';
  import ReviewControls from '../lib/ui/ReviewControls.svelte';
  import ReviewStatus from '../lib/ui/ReviewStatus.svelte';
  import WordLink from '../lib/ui/WordLink.svelte';
  import ScopeFilter from './ScopeFilter.svelte';

  /** The key of the column holding the `+ Term` button. */
  const TERM_KEY = '_term';
  const STATUS_KEY = '_status';

  // The analysis (report, running job, pasted text) lives in `analysis`, so it survives
  // leaving this screen; the options below are per visit.
  let file = $state.raw<File | null>(null);
  let minFreq = $state<number | null>(2);
  let minCorpus = $state<number | null>(3);
  let force = $state(false);

  const report = $derived(analysis.report);
  const busy = $derived(analysis.busy);
  const job = $derived(analysis.job);
  const error = $derived(analysis.error);

  // Selected rows, compared by key inside DataTable; cleared when a new report arrives.
  let selKnown = $state.raw<JobKnownTerm | null>(null);
  let selGap = $state.raw<JobGap | null>(null);
  let selKey = $state.raw<JobKeyTerm | null>(null);
  let selPhrase = $state.raw<JobPhrase | null>(null);
  $effect.pre(() => {
    void analysis.reportJob;
    selKnown = selGap = selKey = selPhrase = null;
  });

  function analyse(): void {
    const id = corpusStore.currentId;
    if (id === null) {
      messages.say(t('corpus.selectFirst'), 'err');
      return;
    }
    if (!file && !analysis.text.trim()) {
      messages.say(t('job.needInput'), 'err');
      return;
    }
    const form = new FormData();
    if (file) form.append('file', file);
    else form.append('text', analysis.text);
    void analysis.start({
      corpusId: id,
      form,
      params: {
        min_freq: toInt(minFreq, 2),
        min_corpus_freq: toInt(minCorpus, 3),
        force_language: force,
        ...scopeParams(),
      },
      source: file?.name ?? '',
    });
  }

  // ------------------------------------------------------------------ report
  const pct = (v: number) => `${v}%`;
  const sectionUrl = (name: string) =>
    `/api/jobs/${analysis.reportJob}/result?${qs({ section: name, format: 'csv' })}`;
  const glossaryUrl = (fmt: string, ids: number[]) =>
    `/api/terms/export?${qs({ format: fmt, ids: ids.join(',') })}`;

  const summary = $derived(report?.summary);
  const termIds = $derived(report ? report.known_terms.flatMap((k) => k.ids) : []);

  // + room for a horizontal scrollbar, which wide tables (the known terms) show.
  const tableHeight = (n: number) => `min(calc(${Math.max(n, 1) + 1} * var(--row-h) + 18px), 20rem)`;

  // The tables below hide dropped terms (and, on request, those already in the termbase).
  const gaps = $derived(report ? visible(report.gaps as Flagged[]) as JobGap[] : []);
  const keyTerms = $derived(report ? visible(report.key_terms as Flagged[]) as JobKeyTerm[] : []);
  const phrases = $derived(report ? visible(report.phrases as Flagged[]) as JobPhrase[] : []);
  const statusCol = { key: STATUS_KEY, label: t('cand.col.status'), sortable: false, width: '9rem' };

  const lemmaCols = $derived<Column<JobGap>[]>([
    { key: 'item', label: t('job.col.lemma'), width: 'minmax(12rem, 2fr)' },
    statusCol,
    { key: 'pos', label: t('ex.col.pos'), width: '6rem' },
    { key: 'job_freq', label: t('job.col.inText'), num: true },
    { key: 'corpus_freq', label: t('job.col.inCorpus'), num: true },
    { key: 'termbase', label: t('job.col.termbase'), width: 'minmax(8rem, 1fr)' },
    { key: TERM_KEY, label: t('job.col.term'), sortable: false, width: '13rem' },
  ]);
  const keyCols = $derived<Column<JobKeyTerm>[]>([
    ...lemmaCols.slice(0, 5),
    ...(summary?.reference
      ? [
          { key: 'base_per_million', label: t('job.col.baseM'), num: true },
          { key: 'll', label: t('job.col.ll'), num: true },
        ]
      : []),
    ...lemmaCols.slice(5),
  ] as Column<JobKeyTerm>[]);
  const phraseCols = $derived<Column<JobPhrase>[]>([
    { key: 'item', label: t('job.col.phrase'), width: 'minmax(12rem, 2fr)' },
    statusCol,
    { key: 'job_freq', label: t('job.col.inText'), num: true },
    { key: 'corpus_freq', label: t('job.col.inCorpus'), num: true },
    { key: TERM_KEY, label: t('job.col.term'), sortable: false, width: '13rem' },
  ]);
  const knownCols = $derived<Column<JobKnownTerm>[]>([
    { key: 'item', label: t('job.known.term'), width: 'minmax(10rem, 1fr)' },
    { key: 'occurrences', label: t('job.known.times'), num: true, width: '6rem' },
    {
      key: 'translations',
      label: t('job.known.translations'),
      width: 'minmax(14rem, 2fr)',
      value: (k) => k.translations.map((x) => x.term).join(' '),
    },
    { key: 'example', label: t('job.known.example'), width: 'minmax(20rem, 4fr)' },
  ]);

  const lemmaKey = (r: JobGap) => `${r.item}\u0001${r.pos}`;
  const exampleKind = (k: JobKnownTerm): Kind =>
    k.translations.length && k.translations.every((x) => x.status === 'forbidden') ? 'forbidden' : 'term';
</script>

{#snippet termbaseCell(tb: string)}
  <!-- The backend marks an entry without a target term "(candidate)": show the Candidate badge. -->
  {#if tb === '(candidate)'}<Badge kind="candidate" />{:else if tb}<Badge kind="approved" label={tb} />{/if}
{/snippet}

{#snippet lemmaCell(row: JobGap, col: Column<JobGap>)}
  {#if col.key === 'item'}
    <WordLink word={row.item} unit="lemma" />
  {:else if col.key === 'termbase'}
    {@render termbaseCell(row.termbase)}
  {:else if col.key === STATUS_KEY}
    <ReviewStatus {row} />
  {:else if col.key === TERM_KEY}
    <ReviewActions
      item={row.item}
      pos={row.pos}
      origin="job"
      measure={'ll' in row && row.ll !== null ? 'log-likelihood' : 'frequency in text'}
      score={'ll' in row && typeof row.ll === 'number' ? row.ll : row.job_freq}
      freq={row.job_freq}
      flags={row}
    />
  {:else}
    {cellValue(row, col)}
  {/if}
{/snippet}

{#snippet keyCell(row: JobKeyTerm, col: Column<JobKeyTerm>)}
  {@render lemmaCell(row, col as Column<JobGap>)}
{/snippet}

{#snippet phraseCell(row: JobPhrase, col: Column<JobPhrase>)}
  {#if col.key === 'item'}
    <WordLink word={row.item} unit="form" />
  {:else if col.key === STATUS_KEY}
    <ReviewStatus {row} />
  {:else if col.key === TERM_KEY}
    <ReviewActions
      item={row.item}
      origin="job"
      measure="frequency in text"
      score={row.job_freq}
      freq={row.job_freq}
      flags={row}
    />
  {:else}
    {cellValue(row, col)}
  {/if}
{/snippet}

{#snippet knownCell(row: JobKnownTerm, col: Column<JobKnownTerm>)}
  {#if col.key === 'item'}
    <b>{row.item}</b>
  {:else if col.key === 'translations'}
    {#each row.translations as tr (tr.id)}
      <span
        class="tr"
        title={tr.status === 'forbidden'
          ? `${t('badge.forbidden')} — ${t('job.known.avoid')}`
          : t(`badge.${tr.status}`)}
      >
        <Badge
          kind={tr.status as 'candidate' | 'approved' | 'admitted' | 'superseded' | 'forbidden'}
          label={`${tr.term || '—'}${tr.status === 'forbidden' ? ' ✗' : ''}`}
        />
      </span>
    {/each}
  {:else if col.key === 'example'}
    <span class="ctx" title={row.example}>
      <Highlight
        text={row.example}
        ranges={findRanges(row.example, [row.item], exampleKind(row), { accentInsensitive: true })}
      />
    </span>
  {:else}
    {cellValue(row, col)}
  {/if}
{/snippet}

{#snippet stat(label: string, value: string | number, hint = '')}
  <div class="stat" title={hint || undefined}><b>{value}</b><span>{label}</span></div>
{/snippet}

{#snippet csv(section: string, label: string)}
  <a class="csv" href={sectionUrl(section)} download aria-label={t('job.csvOf', { section: label })}>{t('job.csv')}</a>
{/snippet}

<div class="job">
  {#if corpusStore.currentId === null}
    {#if corpusStore.loaded}<EmptyState title={t('corpus.selectFirst')} />{/if}
  {:else}
    <Toolbar label={t('job.toolbar')}>
      <Field label={t('job.file')}>
        <input
          type="file"
          accept={ACCEPT}
          onchange={(e) => (file = e.currentTarget.files?.[0] ?? null)}
        />
      </Field>
      <Field label={t('job.minFreq')}>
        <input type="number" min="1" bind:value={minFreq} title={t('job.minFreqHint')} />
      </Field>
      <Field label={t('job.minCorpus')}>
        <input type="number" min="1" bind:value={minCorpus} title={t('job.minCorpusHint')} />
      </Field>
      <div class="force"><Toggle bind:checked={force} label={t('job.force')} /></div>
      <div class="actions">
        <Button variant="primary" disabled={busy} onclick={analyse}>{t('job.go')}</Button>
        <span class="progress" aria-live="polite">
          {#if busy}
            {#if job && job.status !== 'queued'}
              <progress max="100" value={Math.round((job.progress || 0) * 100)}></progress>
              {t('job.running')}
            {:else}
              {t('job.queued')}
            {/if}
          {/if}
        </span>
      </div>
    </Toolbar>
    <ScopeFilter />
    <div class="body">
      <p class="intro">{t('job.intro')}</p>
      <textarea
        rows="5"
        bind:value={analysis.text}
        aria-label={t('job.paste')}
        placeholder={t('job.pastePlaceholder')}
      ></textarea>
      {#if error}<p class="error" role="alert">{t('job.failed', { error })}</p>{/if}

      {#if report && summary}
        <p class="muted">
          {analysis.source ? t('job.reportOf', { source: analysis.source }) : t('job.reportOfPasted')}
        </p>
        <div class="stats">
          {@render stat(t('job.stat.words'), summary.words.toLocaleString())}
          {@render stat(t('job.stat.distinct'), summary.distinct_lemmas, t('job.stat.distinctHint'))}
          {@render stat(
            t('job.stat.covered', { n: summary.min_corpus_freq }),
            pct(summary.coverage_tokens_pct),
            t('job.stat.coveredHint'),
          )}
          {@render stat(t('job.stat.seen'), pct(summary.coverage_seen_pct), t('job.stat.seenHint'))}
          {@render stat(t('job.stat.gaps'), summary.uncovered_types, t('job.stat.gapsHint'))}
          {@render stat(t('job.stat.terms'), `${summary.termbase_terms_found} / ${summary.termbase_size}`)}
        </div>
        {#if !summary.corpus_words}<p class="error">{t('job.emptyCorpus')}</p>{/if}
        {#if summary.language_check === 'uncertain'}<p class="muted">{t('job.uncertain')}</p>{/if}

        <h3>
          {t('job.known')}
          {@render csv('known_terms', t('job.known'))}
          {#if termIds.length}
            <span class="glossary">
              · {t('job.glossary')}
              <a class="csv" href={glossaryUrl('tbx2', termIds)} download>{t('job.glossary.tbx')}</a>
              <a class="csv" href={glossaryUrl('xlsx', termIds)} download>{t('job.glossary.xlsx')}</a>
              <a class="csv" href={glossaryUrl('csv', termIds)} download aria-label={t('job.glossary.csvLabel')}>{t('job.glossary.csv')}</a>
            </span>
          {/if}
        </h3>
        <div class="table" style:height={tableHeight(report.known_terms.length)}>
          <DataTable
            columns={knownCols}
            rows={report.known_terms}
            rowKey={(r) => r.item}
            bind:selected={selKnown}
            cell={knownCell}
            emptyText={summary.termbase_size ? t('job.known.empty') : t('job.known.emptyTb')}
          />
        </div>

        <h3>{t('job.gaps')} {@render csv('gaps', t('job.section.gaps'))} <ReviewControls /></h3>
        <div class="table" style:height={tableHeight(gaps.length)}>
          <DataTable columns={lemmaCols} rows={gaps} rowKey={lemmaKey} bind:selected={selGap} cell={lemmaCell} />
        </div>

        <h3>{summary.reference ? t('job.keys.ref') : t('job.keys.noref')} {@render csv('key_terms', t('job.section.keys'))}</h3>
        <div class="table" style:height={tableHeight(keyTerms.length)}>
          <DataTable columns={keyCols} rows={keyTerms} rowKey={lemmaKey} bind:selected={selKey} cell={keyCell} />
        </div>

        <h3>{t('job.phrases')} {@render csv('phrases', t('job.phrases'))}</h3>
        <div class="table" style:height={tableHeight(phrases.length)}>
          <DataTable
            columns={phraseCols}
            rows={phrases}
            rowKey={(r) => r.item}
            bind:selected={selPhrase}
            cell={phraseCell}
          />
        </div>
      {:else if !busy && !error}
        <EmptyState title={t('job.start')} hint={t('job.startHint')} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .job {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .force {
    align-self: center;
    margin-top: 14px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .progress {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .progress progress {
    width: 8rem;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3) var(--s-4);
  }
  .intro,
  .muted {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .error {
    margin: 0;
    color: var(--danger);
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .stat {
    display: flex;
    flex-direction: column;
    min-width: 6.5rem;
    padding: var(--s-1) var(--s-3);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .stat b {
    font-size: 1.35rem;
    font-variant-numeric: tabular-nums;
  }
  .stat span {
    color: var(--muted);
    font-size: var(--fs-small);
  }
  h3 {
    margin: var(--s-2) 0 0;
    font-size: var(--fs-base);
  }
  .csv,
  .glossary {
    margin-left: var(--s-1);
    font-size: var(--fs-small);
    font-weight: normal;
  }
  .glossary {
    color: var(--muted);
  }
  .table {
    flex: none;
  }
  .tr {
    margin-right: var(--s-1);
  }
  .ctx {
    color: var(--muted);
  }
</style>
