<script module lang="ts">
  const STATUSES = ['candidate', 'approved', 'forbidden'] as const;

  /** `project` in the URL: 'all' stands for the empty value, which `go()` would drop. */
  const toUrlScope = (s: string) => (s === '' ? 'all' : s);
  const fromUrlScope = (s: string) => (s === 'all' ? '' : s);
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { del, get, patch, qs } from '../lib/api';
  import { CORPUS_CHANGED, corpusStore } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import { go, route } from '../lib/router.svelte';
  import { openTerm, TERM_SAVED } from '../lib/term.svelte';
  import type { Project, Term } from '../lib/types';
  import Badge from '../lib/ui/Badge.svelte';
  import Button from '../lib/ui/Button.svelte';
  import DataTable from '../lib/ui/DataTable.svelte';
  import { cellValue, type Column } from '../lib/ui/DataTable.types';
  import DetailStrip from '../lib/ui/DetailStrip.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import Toolbar from '../lib/ui/Toolbar.svelte';

  // Form state, restored from the route so a reload keeps the filters.
  const initial = untrack(() => ({ ...route.params }));
  const hasScopeParam = initial.project !== undefined;
  let scope = $state(hasScopeParam ? fromUrlScope(initial.project) : '');
  // Like the old tab: the scope follows the current corpus until the user picks one.
  let pinned = hasScopeParam;
  let status = $state(STATUSES.includes(initial.status as (typeof STATUSES)[number]) ? initial.status : '');
  let q = $state(initial.q ?? '');
  let includeCandidates = $state(false);

  let terms = $state.raw<Term[]>([]);
  let projects = $state.raw<Project[]>([]);
  // Compared by key (id) inside DataTable, never by identity.
  let selected = $state.raw<Term | null>(null);
  let filter = $state('');
  let loading = $state(false);
  let loadedOnce = $state(false);
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  let confirmOpen = $state(false);
  let toDelete = $state.raw<Term | null>(null);

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const corpusScope = (): string => {
    const c = corpusStore.current;
    return c ? (c.project_id ? String(c.project_id) : 'none') : '';
  };

  const scopeOptions = $derived([
    { value: '', label: t('tb.scope.all') },
    { value: 'none', label: t('tb.scope.none') },
    ...projects.map((p) => ({ value: String(p.id), label: p.name })),
    // keep a scope the project list does not (yet) contain selectable
    ...(scope && scope !== 'none' && !projects.some((p) => String(p.id) === scope)
      ? [{ value: scope, label: scope }]
      : []),
  ]);
  const statusOptions = [
    { value: '', label: t('tb.status.all') },
    ...STATUSES.map((s) => ({ value: s, label: t(`badge.${s}`) })),
  ];

  // The export ignores the status filter and the search, as the old tab did.
  const exportBase = $derived({ project: scope, status: includeCandidates ? 'approved,candidate' : 'approved' });
  const exportHref = (format: string) => `/api/terms/export?${qs({ ...exportBase, format })}`;
  const exports = [
    { format: 'tbx', label: t('tb.tbx'), title: undefined },
    { format: 'tbx2', label: t('tb.tbx2'), title: t('tb.tbx2Hint') },
    { format: 'xlsx', label: t('tb.xlsx'), title: undefined },
    { format: 'csv', label: t('tb.csv'), title: undefined },
  ];

  const columns: Column<Term>[] = [
    { key: 'src_term', label: t('tb.col.source'), width: 'minmax(10rem, 1.4fr)' },
    { key: 'tgt_term', label: t('tb.col.target'), width: 'minmax(8rem, 1.2fr)' },
    { key: 'pos', label: t('tb.col.pos'), width: '7rem' },
    {
      key: 'status',
      label: t('tb.col.status'),
      width: '8rem',
      value: (r) => t(`badge.${r.status}`),
    },
    { key: 'domain', label: t('tb.col.domain'), width: '8rem' },
    { key: 'context', label: t('tb.col.example'), width: 'minmax(10rem, 2fr)' },
    { key: 'updated', label: t('tb.col.updated'), width: '10rem' },
  ];

  const count = $derived(terms.length === 1 ? t('tb.count1') : t('tb.count', { n: terms.length }));

  async function load(): Promise<void> {
    const n = ++seq;
    loading = true; // previous rows stay visible (and selected) while loading
    const params = { project: scope, status, q: q.trim() };
    try {
      const rows = await get<Term[]>('/api/terms', params);
      if (n !== seq) return;
      terms = rows;
      loadedOnce = true;
      // Persist only a load that worked.
      go('termbase', { project: toUrlScope(scope), status, q: params.q });
    } catch (err) {
      if (n !== seq) return;
      messages.say(errMsg(err), 'err');
    } finally {
      if (n === seq) loading = false;
    }
  }

  function loadSoon(): void {
    clearTimeout(timer);
    timer = setTimeout(load, 300);
  }

  function onScope(): void {
    pinned = true;
    load();
  }

  async function loadProjects(): Promise<void> {
    try {
      projects = await get<Project[]>('/api/projects');
    } catch (err) {
      messages.say(errMsg(err), 'err');
    }
  }

  function syncScope(): void {
    if (!pinned) scope = corpusScope();
  }

  function onCorpusChanged(): void {
    syncScope();
    load();
  }

  function edit(r: Term): void {
    openTerm({
      id: r.id,
      source: r.src_term,
      target: r.tgt_term,
      pos: r.pos,
      status: r.status as 'candidate' | 'approved' | 'forbidden',
      domain: r.domain,
      definition: r.definition,
      notes: r.notes,
      example: r.context,
      exampleSource: r.context_source,
      srcLang: r.src_lang,
      tgtLang: r.tgt_lang,
      origin: r.origin,
    });
  }

  async function setStatus(r: Term, next: 'approved' | 'forbidden'): Promise<void> {
    try {
      await patch(`/api/terms/${r.id}`, { status: next });
      const updated = { ...r, status: next };
      terms = terms.map((x) => (x.id === r.id ? updated : x));
      if (selected?.id === r.id) selected = updated;
      messages.say(t('tb.updated'), 'ok');
    } catch (err) {
      messages.say(errMsg(err), 'err');
    }
  }

  function askDelete(r: Term): void {
    toDelete = r;
    confirmOpen = true;
  }

  async function confirmDelete(): Promise<void> {
    const r = toDelete;
    confirmOpen = false;
    if (!r) return;
    try {
      await del(`/api/terms/${r.id}`);
      terms = terms.filter((x) => x.id !== r.id);
      if (selected?.id === r.id) selected = null;
      messages.say(t('tb.deleted'), 'ok');
    } catch (err) {
      messages.say(errMsg(err), 'err');
    }
  }

  // The termbase is global: it loads with or without a corpus, once the corpus store knows
  // the current one (the default scope depends on it).
  let autoRan = false;
  $effect(() => {
    if (autoRan || !corpusStore.loaded) return;
    autoRan = true;
    untrack(() => {
      syncScope();
      load();
    });
  });

  onMount(() => {
    window.addEventListener(CORPUS_CHANGED, onCorpusChanged);
    window.addEventListener(TERM_SAVED, load);
    loadProjects();
    return () => {
      window.removeEventListener(CORPUS_CHANGED, onCorpusChanged);
      window.removeEventListener(TERM_SAVED, load);
      clearTimeout(timer);
      seq++;
    };
  });
</script>

{#snippet cell(row: Term, col: Column<Term>)}
  {#if col.key === 'src_term'}
    <span class="src">
      <b>{row.src_term}</b>
      <span class="muted">{row.src_lang}→{row.tgt_lang}{row.project ? ` · ${row.project}` : ''}</span>
    </span>
  {:else if col.key === 'tgt_term'}
    {#if row.tgt_term}{row.tgt_term}{:else}<span class="muted">—</span>{/if}
  {:else if col.key === 'status'}
    <Badge kind={row.status as 'candidate' | 'approved' | 'forbidden'} />
  {:else if col.key === 'context'}
    <span class="ctx" title={row.context_source}>{row.context}</span>
  {:else}
    {cellValue(row, col)}
  {/if}
{/snippet}

<div class="tb">
  <form
    class="tb-form"
    onsubmit={(e) => {
      e.preventDefault();
      clearTimeout(timer);
      load();
    }}
  >
    <Toolbar label={t('tb.toolbar')}>
      <Field label={t('tb.scope')}>
        <Select label={t('tb.scope')} bind:value={scope} options={scopeOptions} onchange={onScope} />
      </Field>
      <Field label={t('tb.status')}>
        <Select label={t('tb.status')} bind:value={status} options={statusOptions} onchange={load} />
      </Field>
      <Field label={t('tb.search')}>
        <input
          class="search"
          type="search"
          bind:value={q}
          placeholder={t('tb.searchPlaceholder')}
          autocomplete="off"
          oninput={loadSoon}
        />
      </Field>
      <Button type="submit">{t('tb.reload')}</Button>
    </Toolbar>
  </form>
  <div class="export" role="group" aria-label={t('tb.exportGroup')}>
    <b>{t('tb.export')}</b>
    <span title={t('tb.includeHint')}>
      <Toggle bind:checked={includeCandidates} label={t('tb.includeCandidates')} />
    </span>
    {#each exports as e (e.format)}
      <a class="csv" href={exportHref(e.format)} title={e.title} download>{e.label}</a>
    {/each}
  </div>

  {#if loadedOnce}
    <div class="strip">
      <span class="count">{count}</span>
      {#if terms.length}
        <input
          class="filter"
          type="search"
          bind:value={filter}
          placeholder={t('cc.filter')}
          aria-label={t('cc.filter')}
        />
      {/if}
    </div>
  {/if}

  <div class="table">
    {#if loadedOnce && !terms.length && !loading}
      <EmptyState title={t('tb.empty')} hint={t('tb.emptyHint')} />
    {:else}
      <DataTable
        {columns}
        rows={terms}
        rowKey={(r) => r.id}
        bind:selected
        bind:filter
        {loading}
        {cell}
        onactivate={edit}
        emptyText={t('tb.noFilterMatch')}
      />
    {/if}
  </div>

  {#if selected}
    {@const r = selected}
    <div class="detail">
      <DetailStrip title={t('tb.detail')}>
        {#snippet actions()}
          <Button onclick={() => edit(r)}>{t('tb.edit')}</Button>
          <Button disabled={r.status === 'approved'} onclick={() => setStatus(r, 'approved')}>{t('tb.approve')}</Button>
          <Button disabled={r.status === 'forbidden'} onclick={() => setStatus(r, 'forbidden')}>{t('tb.forbid')}</Button>
          <Button variant="danger" onclick={() => askDelete(r)}>{t('tb.delete')}</Button>
        {/snippet}
        <dl>
          <dt>{t('tb.col.source')}</dt>
          <dd><b>{r.src_term}</b></dd>
          <dt>{t('tb.col.target')}</dt>
          <dd>{#if r.tgt_term}{r.tgt_term}{:else}<span class="muted">—</span>{/if}</dd>
          <dt>{t('tb.languages')}</dt>
          <dd>{r.src_lang}→{r.tgt_lang}{r.project ? ` · ${r.project}` : ''}</dd>
          <dt>{t('tb.col.status')}</dt>
          <dd><Badge kind={r.status as 'candidate' | 'approved' | 'forbidden'} /></dd>
          {#if r.pos}<dt>{t('tb.col.pos')}</dt><dd>{r.pos}</dd>{/if}
          {#if r.domain}<dt>{t('tb.col.domain')}</dt><dd>{r.domain}</dd>{/if}
          {#if r.definition}<dt>{t('tb.definition')}</dt><dd>{r.definition}</dd>{/if}
          {#if r.notes}<dt>{t('tb.notes')}</dt><dd>{r.notes}</dd>{/if}
          {#if r.context}
            <dt>{t('tb.col.example')}</dt>
            <dd>
              {r.context}
              {#if r.context_source}<span class="muted">{t('tb.exampleFrom', { doc: r.context_source })}</span>{/if}
            </dd>
          {/if}
          <dt>{t('tb.origin')}</dt>
          <dd>{r.origin}</dd>
          {#if r.updated}<dt>{t('tb.col.updated')}</dt><dd>{r.updated}</dd>{/if}
        </dl>
      </DetailStrip>
    </div>
  {/if}
</div>

<Dialog bind:open={confirmOpen} title={t('tb.confirmTitle')}>
  <p class="confirm">{t('tb.confirmBody', { term: toDelete?.src_term ?? '' })}</p>
  {#snippet footer()}
    <Button onclick={() => (confirmOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={confirmDelete}>{t('tb.delete')}</Button>
  {/snippet}
</Dialog>

<style>
  .tb {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .tb-form {
    display: contents;
  }
  .search {
    width: 16rem;
  }
  .export {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-1) var(--s-3);
    font-size: var(--fs-small);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .strip {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-3);
    font-size: var(--fs-small);
    border-bottom: 1px solid var(--line);
  }
  .count {
    font-weight: 600;
  }
  .filter {
    width: 14rem;
    margin-left: var(--s-2);
  }
  .muted {
    color: var(--muted);
  }
  .src {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }
  .src .muted {
    font-size: var(--fs-small);
  }
  .ctx {
    color: var(--muted);
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
  .detail {
    flex: none;
    max-height: 40%;
    overflow: auto;
  }
  .detail :global(.strip) {
    max-height: none;
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
  .confirm {
    margin: 0;
  }
</style>
