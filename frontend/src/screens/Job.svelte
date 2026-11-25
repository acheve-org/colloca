<script module lang="ts">
  const ACCEPT = '.docx,.pdf,.odt,.rtf,.xlsx,.csv,.tsv,.xlf,.xliff,.srt,.vtt,.txt,.md,.html,.htm';
  type Kind = 'term' | 'forbidden';
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { analysis } from '../lib/analysis.svelte';
  import { ApiError, del, get, post, qs } from '../lib/api';
  import { type Flagged, visible } from '../lib/candidates.svelte';
  import { CORPUS_CHANGED, corpusStore, scopeParams } from '../lib/corpus.svelte';
  import { toInt } from '../lib/explore.svelte';
  import { findRanges, termRanges } from '../lib/highlight';
  import { t, fmt } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import type { CheckTextResult, JobGap, JobKeyTerm, JobKnownTerm, JobPhrase, SavedReport } from '../lib/types';
  import Badge from '../lib/ui/Badge.svelte';
  import Button from '../lib/ui/Button.svelte';
  import DataTable from '../lib/ui/DataTable.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
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

  /** The key of the column holding the `+ Term` button. */
  const TERM_KEY = '_term';
  const STATUS_KEY = '_status';

  // The analysis (report, running job, pasted text) lives in `analysis`, so it survives
  // leaving this screen; the options below are per visit.
  let file = $state.raw<File | null>(null);
  let minFreq = $state<number | null>(2);
  let minCorpus = $state<number | null>(3);
  let force = $state(false);
  let keepText = $state(false);
  let leverage = $state(false);

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
    void analysis.version;
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
        keep_text: keepText,
        leverage,
        ...scopeParams(),
      },
      source: file?.name ?? '',
    });
  }

  // ------------------------------------------------------------------ report
  const pct = (v: number) => `${v}%`;
  const leverageHint = (l: { segments: number; bands: Record<string, { segments: number }> }) =>
    t('job.stat.leverageHint', {
      n: l.segments,
      b100: l.bands['100']?.segments ?? 0,
      b95: l.bands['95-99']?.segments ?? 0,
      b85: l.bands['85-94']?.segments ?? 0,
      b75: l.bands['75-84']?.segments ?? 0,
      none: l.bands.below75?.segments ?? 0,
    });
  const sectionUrl = (name: string) => `${analysis.resultPath}?${qs({ section: name, format: 'csv' })}`;
  const workbookUrl = $derived(`${analysis.resultPath}?${qs({ format: 'xlsx' })}`);

  // ------------------------------------------------------------------ saved reports (T11)
  let saved = $state.raw<SavedReport[]>([]);
  let delTarget = $state.raw<SavedReport | null>(null);
  let delOpen = $state(false);
  let textResult = $state.raw<CheckTextResult | null>(null);
  let textOpen = $state(false);

  async function loadSaved(): Promise<void> {
    const id = corpusStore.currentId;
    if (id === null) {
      saved = [];
      return;
    }
    try {
      const rows = await get<SavedReport[]>(`/api/corpora/${id}/reports`);
      if (corpusStore.currentId === id) saved = rows;
    } catch {
      saved = [];
    }
  }
  onMount(() => {
    void loadSaved();
    window.addEventListener(CORPUS_CHANGED, loadSaved);
    return () => window.removeEventListener(CORPUS_CHANGED, loadSaved);
  });
  $effect(() => {
    void corpusStore.currentId;
    void loadSaved();
  });

  const fail = (err: unknown) => messages.say(err instanceof ApiError || err instanceof Error ? err.message : String(err), 'err');

  async function saveReport(): Promise<void> {
    try {
      await analysis.save('');
      messages.say(t('job.saved'), 'ok');
      await loadSaved();
    } catch (err) {
      fail(err);
    }
  }
  async function openReport(r: SavedReport): Promise<void> {
    try {
      await analysis.openSaved(r.id);
      textResult = null;
      textOpen = false;
    } catch (err) {
      fail(err);
    }
  }
  function askDelete(r: SavedReport): void {
    delTarget = r;
    delOpen = true;
  }
  async function doDelete(): Promise<void> {
    const r = delTarget;
    delOpen = false;
    if (!r) return;
    try {
      await del(`/api/reports/${r.id}`);
      if (analysis.savedId === r.id) analysis.reset();
      messages.say(t('job.deleted'), 'ok');
      await loadSaved();
    } catch (err) {
      fail(err);
    }
  }
  /** The kept text, with the termbase hits marked (the same marking as Check text). */
  async function showText(): Promise<void> {
    const id = analysis.savedId;
    const cid = corpusStore.currentId;
    if (id === null || cid === null) return;
    try {
      const { text, lang } = await get<{ text: string; lang: string }>(`/api/reports/${id}/text`);
      textResult = await post<CheckTextResult>(`/api/corpora/${cid}/check-text`, { text, lang });
      textOpen = true;
    } catch (err) {
      fail(err);
    }
  }
  const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');
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
  const statusCol = $derived({ key: STATUS_KEY, label: t('cand.col.status'), sortable: false, width: '9rem' });

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
      <div class="force" title={t('job.keepTextHint')}><Toggle bind:checked={keepText} label={t('job.keepText')} /></div>
      {#if corpusStore.aligned}
        <div class="force" title={t('job.leverageHint')}><Toggle bind:checked={leverage} label={t('job.leverage')} /></div>
      {/if}
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
    <div class="body">
      <p class="intro">{t('job.intro')}</p>
      <textarea
        rows="5"
        bind:value={analysis.text}
        aria-label={t('job.paste')}
        placeholder={t('job.pastePlaceholder')}
      ></textarea>
      {#if error}<p class="error" role="alert">{t('job.failed', { error })}</p>{/if}

      {#if saved.length}
        <section aria-labelledby="saved-h">
          <h3 id="saved-h">{t('job.savedTitle')}</h3>
          <ul class="saved">
            {#each saved as r (r.id)}
              <li class:open={analysis.savedId === r.id}>
                <span class="grow">
                  <b>{r.title}</b>
                  <span class="muted">
                    {when(r.created)} · {t('job.savedMeta', { words: fmt(r.words ?? 0), pct: r.coverage_tokens_pct ?? 0, gaps: r.gaps ?? 0 })}
                    {#if r.has_text} · {t('job.textKept')}{/if}
                  </span>
                </span>
                <Button onclick={() => openReport(r)} ariaLabel={t('job.openOf', { title: r.title })}>{t('job.open')}</Button>
                <a class="csv" href={`/api/reports/${r.id}/result?${qs({ format: 'xlsx' })}`} download>{t('job.excel')}</a>
                <Button variant="danger" onclick={() => askDelete(r)} ariaLabel={t('job.deleteOf', { title: r.title })}>{t('common.delete')}</Button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if report && summary}
        <p class="muted">
          {analysis.source ? t('job.reportOf', { source: analysis.source }) : t('job.reportOfPasted')}
        </p>
        <div class="reportbar">
          {#if analysis.title}<b>{analysis.title}</b>{/if}
          {#if analysis.savedId === null}
            <Button onclick={saveReport}>{t('job.save')}</Button>
          {:else}
            <span class="muted">{t('job.savedState')}</span>
          {/if}
          <a class="csv" href={workbookUrl} download>{t('job.excelAll')}</a>
          {#if analysis.hasText}<Button onclick={showText}>{t('job.showText')}</Button>{/if}
        </div>
        {#if textOpen && textResult}
          <section class="text" aria-label={t('job.textTitle')}>
            <h3>{t('job.textTitle')}</h3>
            <ol class="lines">
              {#each textResult.lines as l, i (i)}
                <li><Highlight text={l.text} ranges={termRanges(l.marks)} /></li>
              {/each}
            </ol>
            <p class="muted">{t('chk.legend')}</p>
          </section>
        {/if}
        <div class="stats">
          {@render stat(t('job.stat.words'), fmt(summary.words))}
          {@render stat(t('job.stat.distinct'), summary.distinct_lemmas, t('job.stat.distinctHint'))}
          {@render stat(
            t('job.stat.covered', { n: summary.min_corpus_freq }),
            pct(summary.coverage_tokens_pct),
            t('job.stat.coveredHint'),
          )}
          {@render stat(t('job.stat.seen'), pct(summary.coverage_seen_pct), t('job.stat.seenHint'))}
          {@render stat(t('job.stat.gaps'), summary.uncovered_types, t('job.stat.gapsHint'))}
          {@render stat(t('job.stat.terms'), `${summary.termbase_terms_found} / ${summary.termbase_size}`)}
          {#if summary.leverage}
            {@render stat(t('job.stat.leverage'), pct(summary.leverage.covered_pct), leverageHint(summary.leverage))}
          {/if}
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

<Dialog bind:open={delOpen} title={t('job.confirmTitle')}>
  <p>{t('job.confirmBody', { title: delTarget?.title ?? '' })}</p>
  <div class="actions">
    <Button onclick={() => (delOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={doDelete}>{t('common.delete')}</Button>
  </div>
</Dialog>

<style>
  .saved {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .saved li {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .saved li.open {
    border-color: var(--accent);
  }
  .saved .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .reportbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .lines {
    margin: 0;
    padding-left: 1.6rem;
    line-height: 1.7;
  }
  .text {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-2) var(--s-3);
    background: var(--bg);
    max-height: 22rem;
    overflow: auto;
  }
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
