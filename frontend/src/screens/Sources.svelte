<script module lang="ts">
  const LANG_BADGE: Record<string, string> = { mismatch: 'src.check.mismatch', uncertain: 'src.check.uncertain' };

  const emptyFacets = () => ({ tags: [], text_types: [], date_min: '', date_max: '' });
</script>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { del, get, post } from '../lib/api';
  import { act, still, watch, work } from '../lib/addDocuments.svelte';
  import { CORPUS_CHANGED, corpusStore } from '../lib/corpus.svelte';
  import { hrefFor } from '../lib/router.svelte';
  import { t, fmt } from '../lib/i18n';
  import { JOBS_DONE, jobLogs } from '../lib/jobs.svelte';
  import { messages } from '../lib/messages.svelte';
  import { viewport } from '../lib/viewport.svelte';
  import type { Doc, Facets, Job, NearDupMatch, NearDupReport } from '../lib/types';
  import BulkEditDocumentsDialog from './BulkEditDocumentsDialog.svelte';
  import EditDocumentDialog from './EditDocumentDialog.svelte';
  import TmxExport from './TmxExport.svelte';
  import ActionMenu from '../lib/ui/ActionMenu.svelte';
  import Badge from '../lib/ui/Badge.svelte';
  import Button from '../lib/ui/Button.svelte';
  import CorpusSizeGauge from '../lib/ui/CorpusSizeGauge.svelte';
  import DataTable from '../lib/ui/DataTable.svelte';
  import { cellValue, rowMatchesFilter, type Column } from '../lib/ui/DataTable.types';
  import Dialog from '../lib/ui/Dialog.svelte';
  import NoCorpus from '../lib/ui/NoCorpus.svelte';
  import ReadyHint from '../lib/ui/ReadyHint.svelte';
  import Field from '../lib/ui/Field.svelte';
  import SidePanel from '../lib/ui/SidePanel.svelte';
  import MethodTiles from '../lib/ui/add/MethodTiles.svelte';

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const hasCorpus = $derived(corpusStore.currentId !== null);

  // Documents table
  let docs = $state.raw<Doc[]>([]);
  // Compared by key (id) inside DataTable, never by identity.
  let selected = $state.raw<Doc | null>(null);
  let filter = $state('');
  let loading = $state(false);
  let loadedOnce = $state(false);
  let facets = $state.raw<Facets>(emptyFacets());
  // Jobs are followed app-wide (lib/jobs): leaving this screen does not stop them.
  const jobLog = $derived.by(() => {
    const id = corpusStore.currentId;
    return id === null ? [] : (jobLogs.by[id] ?? []).slice(-8).reverse();
  });
  let tableEl: HTMLElement | undefined = $state();
  let seq = 0;

  // Dialogs
  let editOpen = $state(false);
  let editing = $state.raw<Doc | null>(null);
  let delOpen = $state(false);
  let toDelete = $state.raw<Doc | null>(null);

  // Documents ticked for the bulk actions (ids), apart from the highlighted row that the side panel shows.
  const checked = new SvelteSet<number>();
  let bulkEditOpen = $state(false);
  let bulkDelOpen = $state(false);

  // Near-duplicates: the decision on a held import, and the report on the whole corpus.
  let dupOpen = $state(false);
  let dupPct = $state(85);
  let dupReport = $state.raw<NearDupReport | null>(null);
  let dupBusy = $state(false);

  const matchesOf = (j: Job): NearDupMatch[] =>
    j.code === 'near_duplicate' && Array.isArray(j.result?.matches) ? (j.result.matches as NearDupMatch[]) : [];

  async function resolveJob(j: Job, action: 'import' | 'replace' | 'skip'): Promise<void> {
    await act('resolve', async (id) => {
      try {
        await post(`/api/jobs/${j.id}/resolve`, { action });
      } catch {
        messages.say(t('dup.gone'), 'err');
        return;
      }
      if (!still(id)) return;
      messages.say(t('dup.done'), 'ok');
      watch(action !== 'skip');
    });
  }

  async function findDuplicates(): Promise<void> {
    const id = corpusStore.currentId;
    if (id === null) return;
    dupBusy = true;
    try {
      const r = await get<NearDupReport>(`/api/corpora/${id}/near-duplicates`, { threshold: dupPct / 100 });
      if (corpusStore.currentId === id) dupReport = r;
    } catch (err) {
      messages.say(errMsg(err), 'err');
    } finally {
      dupBusy = false;
    }
  }

  function openDuplicates(): void {
    dupReport = null;
    dupOpen = true;
    findDuplicates();
  }

  async function removeDuplicate(d: { id: number; title: string }): Promise<void> {
    await act('delete', async (id) => {
      await del(`/api/documents/${d.id}`);
      if (!still(id)) return;
      messages.say(t('dup.removed', { title: d.title }), 'ok');
      refresh();
      corpusStore.reload().catch((err) => messages.say(errMsg(err), 'err'));
      await findDuplicates();
    });
  }

  const staleCount = $derived(docs.filter((d) => d.stale).length);
  const count = $derived(docs.length === 1 ? t('src.count1') : t('src.count', { n: docs.length }));

  function checks(d: Doc): { kind: 'candidate' | 'neutral' | 'approved'; label: string; title: string }[] {
    const out: { kind: 'candidate' | 'neutral' | 'approved'; label: string; title: string }[] = [];
    if (LANG_BADGE[d.lang_check]) {
      out.push({ kind: 'candidate', label: t(LANG_BADGE[d.lang_check]), title: t('src.check.langHint', { v: d.lang_check }) });
    }
    if (d.stale) out.push({ kind: 'neutral', label: t('src.check.stale'), title: d.pipeline });
    if (d.segmented && d.pair_doc_id) out.push({ kind: 'approved', label: t('src.check.aligned'), title: t('src.check.alignedHint') });
    return out;
  }

  const columns: Column<Doc>[] = [
    { key: 'sel', label: '', width: '2.5rem', sortable: false, value: () => '' },
    { key: 'title', label: t('src.col.title'), width: 'minmax(12rem, 2fr)', value: (d) => `${d.title} ${d.author}` },
    { key: 'text_type', label: t('src.col.type'), width: '8rem' },
    { key: 'doc_date', label: t('src.col.date'), width: '6.5rem' },
    { key: 'tags', label: t('src.col.tags'), width: 'minmax(8rem, 1fr)', value: (d) => d.tags.join(', ') },
    { key: 'n_tokens', label: t('src.col.words'), num: true, width: '6rem' },
    { key: 'checks', label: t('src.col.checks'), width: '10rem', value: (d) => checks(d).map((c) => c.label).join(' ') },
  ];

  // ---------------------------------------------------------------- bulk selection
  /** The documents the filter shows: "select all" ticks only these. */
  const shownDocs = $derived(docs.filter((d) => rowMatchesFilter(d, columns, filter)));
  const allShownChecked = $derived(shownDocs.length > 0 && shownDocs.every((d) => checked.has(d.id)));
  const someShownChecked = $derived(shownDocs.some((d) => checked.has(d.id)));
  const checkedIds = $derived([...checked]);

  function toggleRow(id: number, on: boolean): void {
    if (on) checked.add(id);
    else checked.delete(id);
  }

  function toggleAll(on: boolean): void {
    for (const d of shownDocs) toggleRow(d.id, on);
  }

  /** Drop ticks on documents that are no longer listed. */
  function pruneChecked(rows: Doc[]): void {
    const ids = new Set(rows.map((r) => r.id));
    for (const id of [...checked]) if (!ids.has(id)) checked.delete(id);
  }

  async function confirmBulkDelete(): Promise<void> {
    bulkDelOpen = false;
    const ids = [...checked];
    if (!ids.length) return;
    await act('delete', async (id) => {
      seq++; // a list response in flight predates the delete
      loading = false;
      const res = await post<{ deleted: number }>('/api/documents/delete', { ids });
      if (!still(id)) return;
      const gone = new Set(ids);
      docs = docs.filter((x) => !gone.has(x.id));
      checked.clear();
      if (selected && gone.has(selected.id)) selected = null;
      messages.say(t('src.bulkRemoved', { n: res.deleted }), 'ok');
      loadFacets();
      corpusStore.reload().catch((err) => messages.say(errMsg(err), 'err'));
      await tick();
      tableEl?.querySelector<HTMLElement>('[role="grid"]')?.focus();
    });
  }

  // ---------------------------------------------------------------- loading
  async function loadDocs(): Promise<void> {
    const id = corpusStore.currentId;
    if (id === null) return;
    const n = ++seq;
    loading = true; // previous rows stay visible (and selected) while loading
    try {
      const rows = await get<Doc[]>(`/api/corpora/${id}/documents`);
      if (n !== seq) return;
      docs = rows;
      pruneChecked(rows);
      loadedOnce = true;
      if (selected) selected = rows.find((r) => r.id === selected!.id) ?? null;
    } catch (err) {
      if (n !== seq) return;
      messages.say(errMsg(err), 'err');
    } finally {
      if (n === seq) loading = false;
    }
  }

  async function loadFacets(): Promise<void> {
    const id = corpusStore.currentId;
    if (id === null) return;
    try {
      const f = await get<Facets>(`/api/corpora/${id}/facets`);
      if (corpusStore.currentId === id) facets = f;
    } catch {
      // facets only feed the suggestions
    }
  }

  function refresh(): void {
    loadDocs();
    loadFacets();
  }

  function onJobsDone(e: Event): void {
    if ((e as CustomEvent<{ id: number }>).detail?.id === corpusStore.currentId) refresh();
  }

  function start(): void {
    refresh();
    watch(false);
  }

  function onCorpusChanged(): void {
    autoRan = true;
    seq++;
    loading = false;
    docs = [];
    selected = null;
    checked.clear();
    filter = '';
    loadedOnce = false;
    facets = emptyFacets();
    if (corpusStore.currentId !== null) start();
  }

  let autoRan = false;
  $effect(() => {
    if (autoRan || !corpusStore.loaded || corpusStore.currentId === null) return;
    autoRan = true;
    untrack(start);
  });

  onMount(() => {
    window.addEventListener(CORPUS_CHANGED, onCorpusChanged);
    window.addEventListener(JOBS_DONE, onJobsDone);
    return () => {
      window.removeEventListener(CORPUS_CHANGED, onCorpusChanged);
      window.removeEventListener(JOBS_DONE, onJobsDone);
      seq++;
    };
  });

  // ---------------------------------------------------------------- actions
  const reannotate = () =>
    act('reann', async (id) => {
      await post(`/api/corpora/${id}/reannotate`, undefined, { only_stale: true });
      if (!still(id)) return;
      messages.say(t('src.reann.started'), 'ok');
      watch(true);
    });

  function openEdit(d: Doc): void {
    editing = d;
    editOpen = true;
  }

  /** In the documents grid: Esc closes the panel, Space ticks or unticks the highlighted document. */
  function onTableKey(e: KeyboardEvent): void {
    if (selected === null) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      selected = null;
    } else if (e.key === ' ' && (e.target as HTMLElement).getAttribute('role') === 'grid') {
      e.preventDefault();
      toggleRow(selected.id, !checked.has(selected.id));
    }
  }

  function askDelete(d: Doc): void {
    toDelete = d;
    delOpen = true;
  }

  async function confirmDelete(): Promise<void> {
    const d = toDelete;
    delOpen = false;
    if (!d) return;
    await act('delete', async (id) => {
      seq++; // a list response in flight predates the delete
      loading = false;
      await del(`/api/documents/${d.id}`);
      if (!still(id)) return;
      docs = docs.filter((x) => x.id !== d.id);
      checked.delete(d.id);
      if (selected?.id === d.id) selected = null;
      messages.say(t('src.docRemoved'), 'ok');
      loadFacets();
      corpusStore.reload().catch((err) => messages.say(errMsg(err), 'err'));
      await tick();
      tableEl?.querySelector<HTMLElement>('[role="grid"]')?.focus();
    });
  }

  function jobState(j: Job): { cls: string; text: string; pct?: number } {
    if (j.code === 'skipped' || j.code === 'resolved') return { cls: 'muted', text: t(`dup.${j.code}`) };
    if (j.status === 'error') return { cls: 'err', text: j.error };
    if (j.status === 'done') {
      const segs = Number(j.result?.segments ?? 0);
      const warnings = Array.isArray(j.result?.warnings) ? (j.result.warnings as string[]) : [];
      let text = t('jobs.done');
      if (segs) text += ` — ${t('src.job.segments', { n: segs })}`;
      if (warnings.length) text += ` — ${warnings.join(' ')}`;
      return { cls: 'ok', text };
    }
    if (j.status === 'running') {
      const pct = Math.round((j.progress || 0) * 100);
      return { cls: '', text: `${pct}%`, pct };
    }
    return { cls: 'muted', text: t('jobs.queued') };
  }
</script>

{#snippet cell(d: Doc, col: Column<Doc>)}
  {#if col.key === 'sel'}
    <input
      type="checkbox"
      checked={checked.has(d.id)}
      aria-label={t('src.selectRow', { title: d.title })}
      onclick={(e) => e.stopPropagation()}
      ondblclick={(e) => e.stopPropagation()}
      onchange={(e) => toggleRow(d.id, e.currentTarget.checked)}
    />
  {:else if col.key === 'title'}
    <span class="title" title={d.source}>
      <span>{d.title}</span>
      {#if d.author}<span class="muted">{d.author}</span>{/if}
    </span>
  {:else if col.key === 'doc_date'}
    <span class="muted">{d.doc_date}</span>
  {:else if col.key === 'tags'}
    <span class="badges">{#each d.tags as tag (tag)}<Badge kind="neutral" label={tag} />{/each}</span>
  {:else if col.key === 'n_tokens'}
    {fmt(d.n_tokens)}
  {:else if col.key === 'checks'}
    <span class="badges">
      {#each checks(d) as c (c.label)}<span title={c.title}><Badge kind={c.kind} label={c.label} /></span>{/each}
    </span>
  {:else}
    {cellValue(d, col)}
  {/if}
{/snippet}

{#snippet jobRow(j: Job)}
  {@const s = jobState(j)}
  <li class="job">
    <span class="jlabel">{j.label}</span>
    {#if s.pct !== undefined}<progress max="100" value={s.pct}></progress>{/if}
    <span class={s.cls}>{s.text}</span>
    {#if matchesOf(j).length}
      {@const ms = matchesOf(j)}
      <div class="dup">
        <p>{t('dup.found', { n: ms.length })}</p>
        <ul>
          {#each ms as m (m.id)}
            <li>
              <strong>{t('dup.match', { title: m.title, pct: Math.round(m.similarity * 100) })}</strong>
              <span class="muted">{t('dup.shared', { shared: m.shared_units, total: m.units })}</span>
              {#if m.changed.length}
                <span class="muted">{t('dup.changed')}</span>
                <ul class="changed">{#each m.changed as c, i (i)}<li>{c}</li>{/each}</ul>
              {/if}
            </li>
          {/each}
        </ul>
        <div class="dup-actions">
          <Button disabled={work.busy !== null} onclick={() => resolveJob(j, 'import')}>{t('dup.import')}</Button>
          <Button disabled={work.busy !== null} onclick={() => resolveJob(j, 'replace')}>{t('dup.replace', { title: ms[0].title })}</Button>
          <Button disabled={work.busy !== null} onclick={() => resolveJob(j, 'skip')}>{t('dup.skip')}</Button>
        </div>
      </div>
    {/if}
  </li>
{/snippet}

<div class="sources">
  {#if !hasCorpus}
    {#if corpusStore.loaded}<NoCorpus />{/if}
  {:else}
    <!-- One line (wrapping when narrow): count, size gauge, filter, then the actions on the right. -->
    <!-- While documents are ticked, this same line carries their actions (no bar is inserted above the table,
         so the rows do not move on the first tick). -->
    <div class="toolbar" class:picking={checked.size > 0}>
      <h2 class="sr-only">{t('src.documents')}</h2>
      {#if docs.length}
        <input
          type="checkbox"
          checked={allShownChecked}
          indeterminate={someShownChecked && !allShownChecked}
          disabled={!shownDocs.length}
          aria-label={t('src.selectAll')}
          title={t('src.selectAll')}
          onchange={(e) => toggleAll(e.currentTarget.checked)}
        />
      {/if}
      {#if loadedOnce}
        <span class="count" aria-live="polite">{checked.size ? t('src.selected', { n: checked.size }) : count}</span>
      {/if}
      <CorpusSizeGauge {docs} />
      {#if docs.length}
        <input class="filter" type="search" bind:value={filter} placeholder={t('cc.filter')} aria-label={t('cc.filter')} />
      {/if}
      {#if checked.size}
        <span class="actions" role="group" aria-label={t('src.bulk')}>
          <Button disabled={work.busy !== null} onclick={() => (bulkEditOpen = true)}>{t('src.bulkEdit')}</Button>
          <Button variant="danger" disabled={work.busy !== null} onclick={() => (bulkDelOpen = true)}>
            {t('src.bulkRemove')}
          </Button>
          <Button onclick={() => checked.clear()}>{t('src.bulkClear')}</Button>
        </span>
      {:else}
        <span class="actions">
          {#if staleCount}
            <span class="stale">
              <span class="muted">{staleCount === 1 ? t('src.reann.info1') : t('src.reann.info', { n: staleCount })}</span>
              <Button disabled={work.busy !== null} onclick={reannotate}>{t('src.reann.go')}</Button>
            </span>
          {/if}
          <Button disabled={work.busy !== null || !docs.length} onclick={openDuplicates}>{t('dup.find')}</Button>
          <TmxExport mode="button" />
          <ActionMenu label={t('src.more')} items={[{ label: t('src.reload'), onclick: refresh }]} />
          <a class="linkbtn" href={hrefFor('sources-add')}>{t('add.add')}</a>
        </span>
      {/if}
    </div>

    {#if jobLog.length}
      <ul class="jobs" aria-live="polite" aria-label={t('jobs.label')}>
        {#each jobLog as j (j.id)}{@render jobRow(j)}{/each}
      </ul>
    {/if}

    <!-- The table scrolls on its own; the selected document's panel sits beside it (over it when narrower). -->
    <div class="split">
      <!-- svelte-ignore a11y_no_static_element_interactions (Esc in the documents grid closes the panel, Space ticks) -->
      <div class="table" bind:this={tableEl} onkeydown={onTableKey}>
        {#if loadedOnce && !docs.length && !loading}
          <ReadyHint title={t('src.empty')} hint={t('src.emptyHint')} />
          <MethodTiles />
        {:else}
          <DataTable
            fit
            {columns}
            rows={docs}
            rowKey={(d) => d.id}
            bind:selected
            bind:filter
            {loading}
            {cell}
            onactivate={openEdit}
            emptyText={t('src.noFilterMatch')}
          />
        {/if}
      </div>

      <!-- Selecting with the arrow keys opens the panel but leaves focus in the table, so Enter still edits.
           Below 640px the panel covers the page, so it takes focus there. -->
      <SidePanel open={selected !== null} title={selected?.title ?? ''} focusOnOpen={viewport.narrow} onclose={() => (selected = null)}>
        {#if selected}
          {@const d = selected}
          <dl>
            <dt>{t('src.col.title')}</dt>
            <dd>{d.title}</dd>
            {#if d.author}<dt>{t('src.meta.author')}</dt><dd>{d.author}</dd>{/if}
            {#if d.source}<dt>{t('src.source')}</dt><dd class="mono">{d.source}</dd>{/if}
            <dt>{t('src.kind')}</dt>
            <dd>{d.kind}</dd>
            {#if d.text_type}<dt>{t('src.col.type')}</dt><dd>{d.text_type}</dd>{/if}
            {#if d.doc_date}<dt>{t('src.col.date')}</dt><dd>{d.doc_date}</dd>{/if}
            {#if d.tags.length}<dt>{t('src.col.tags')}</dt><dd>{d.tags.join(', ')}</dd>{/if}
            <dt>{t('src.size')}</dt>
            <dd>{t('src.sizeValue', { words: fmt(d.n_tokens), chars: fmt(d.chars) })}</dd>
            <dt>{t('src.model')}</dt>
            <dd>{d.pipeline}{d.stale ? ` (${t('src.check.stale')})` : ''}</dd>
            <dt>{t('src.langCheck')}</dt>
            <dd>{d.lang_check}</dd>
            {#if d.segmented && d.pair_doc_id}<dt>{t('src.check.aligned')}</dt><dd>{t('src.check.alignedHint')}</dd>{/if}
            <dt>{t('src.added')}</dt>
            <dd>{d.added}</dd>
          </dl>
          <div class="panel-actions">
            <a class="linkbtn" href={hrefFor('sources-read', { doc: String(d.id) })}>{t('src.read')}</a>
            <Button disabled={work.busy !== null} onclick={() => openEdit(d)}>{t('src.edit')}</Button>
            <ActionMenu
              label={t('src.moreFor', { title: d.title })}
              disabled={work.busy !== null}
              items={[
                ...(d.stale ? [{ label: t('src.reann.short'), onclick: reannotate }] : []),
                { label: t('src.remove'), onclick: () => askDelete(d), danger: true },
              ]}
            />
          </div>
        {/if}
      </SidePanel>
    </div>
  {/if}
</div>

<EditDocumentDialog bind:open={editOpen} doc={editing} {facets} onsaved={refresh} />
<BulkEditDocumentsDialog bind:open={bulkEditOpen} ids={checkedIds} {facets} onsaved={refresh} />

<Dialog bind:open={bulkDelOpen} title={t('src.bulkConfirmTitle')}>
  <p class="confirm">{t('src.bulkConfirmBody', { n: checked.size })}</p>
  {#snippet footer()}
    <Button onclick={() => (bulkDelOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={confirmBulkDelete}>{t('src.bulkRemove')}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={dupOpen} title={t('dup.title')} wide>
  <form
    class="row"
    onsubmit={(e) => {
      e.preventDefault();
      findDuplicates();
    }}
  >
    <Field label={t('dup.threshold')}>
      <input type="number" min="50" max="100" step="1" bind:value={dupPct} />
    </Field>
    <button type="submit" disabled={dupBusy}>{t('dup.run')}</button>
  </form>
  {#if dupReport}
    <p class="muted" aria-live="polite">
      {dupReport.pairs.length
        ? t('dup.summary', { n: dupReport.pairs.length, docs: dupReport.documents })
        : t('dup.none', { n: dupReport.documents })}
    </p>
    <ul class="dup-pairs">
      {#each dupReport.pairs as p (`${p.a.id}-${p.b.id}`)}
        <li>
          <strong>{t('dup.pair', { pct: Math.round(p.similarity * 100) })}</strong>
          {#each [p.a, p.b] as d (d.id)}
            <div class="dup-doc">
              <span>{d.title} <span class="muted">({d.added}, {fmt(d.n_tokens)})</span></span>
              <Button variant="danger" disabled={work.busy !== null} onclick={() => removeDuplicate(d)}>{t('dup.remove', { title: d.title })}</Button>
            </div>
          {/each}
        </li>
      {/each}
    </ul>
  {/if}
  {#snippet footer()}
    <Button onclick={() => (dupOpen = false)}>{t('dup.close')}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={delOpen} title={t('src.confirmTitle')}>
  <p class="confirm">{t('src.confirmBody', { title: toDelete?.title ?? '' })}</p>
  {#snippet footer()}
    <Button onclick={() => (delOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={confirmDelete}>{t('src.remove')}</Button>
  {/snippet}
</Dialog>

<style>
  /* The toolbar and the job log on top; the documents table fills the rest of the height. */
  .sources {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--s-2);
  }
  .job {
    flex-wrap: wrap;
  }
  .dup {
    flex-basis: 100%;
    padding: var(--s-1) 0 var(--s-2) var(--s-3);
  }
  .dup p {
    margin: 0;
  }
  .dup ul {
    margin: var(--s-1) 0;
    padding-left: var(--s-3);
  }
  .changed {
    font-style: italic;
    overflow-wrap: anywhere;
  }
  .dup-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .dup-pairs {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .dup-pairs > li {
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--line);
  }
  .dup-doc {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    padding: var(--s-1) 0;
  }
  .jobs {
    margin: 0;
    padding: var(--s-1) var(--s-3);
    list-style: none;
    font-size: var(--fs-small);
  }
  .job {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .jlabel {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  progress {
    width: 8rem;
    accent-color: var(--accent);
  }
  .err {
    color: var(--danger);
  }
  .ok {
    color: var(--status-approved);
  }
  .muted {
    color: var(--muted);
  }
  .toolbar {
    position: relative; /* the size gauge's popover spans it on phones */
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-3);
    font-size: var(--fs-small);
    border-bottom: 1px solid var(--line);
  }
  /* A link that looks like the primary button. */
  .linkbtn {
    display: inline-flex;
    align-items: center;
    height: calc(var(--row-h) - var(--s-1));
    padding: 0 var(--s-2);
    background: var(--accent);
    color: var(--accent-fg);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    text-decoration: none;
  }
  .count {
    font-weight: 600;
  }
  /* ticked documents: the toolbar takes the selected-row tint */
  .toolbar.picking {
    background: var(--accent-soft);
  }
  .filter {
    width: 14rem;
  }
  .stale {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
  }
  .actions {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-left: auto;
  }
  .split {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    min-height: 18rem;
  }
  .table {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    overflow: hidden; /* DataTable scrolls itself */
  }
  .table :global(.dt) {
    border-width: 0;
  }
  .title {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
    min-width: 0;
  }
  .title .muted {
    font-size: var(--fs-small);
  }
  .badges {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }
  .panel-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--s-1) var(--s-3);
    margin: 0;
  }
  dt {
    color: var(--muted);
    font-size: var(--fs-small);
    font-weight: 600;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-small);
  }
  .confirm {
    margin: 0;
  }
</style>
