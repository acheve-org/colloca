<script module lang="ts">
  const STATUSES = ['candidate', 'approved', 'admitted', 'superseded', 'forbidden'] as const;
  type Status = (typeof STATUSES)[number];

  /** `project` in the URL: 'all' stands for the empty value, which `go()` would drop. */
  const toUrlScope = (s: string) => (s === '' ? 'all' : s);
  const fromUrlScope = (s: string) => (s === 'all' ? '' : s);
</script>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { del, get, patch, post, qs } from '../lib/api';
  import { CORPUS_CHANGED, corpusStore } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import { go, route } from '../lib/router.svelte';
  import { openTerm, TERM_POS, TERM_SAVED, termStore } from '../lib/term.svelte';
  import type { Project, Term } from '../lib/types';
  import Badge from '../lib/ui/Badge.svelte';
  import Button from '../lib/ui/Button.svelte';
  import DataTable from '../lib/ui/DataTable.svelte';
  import { cellValue, type Column, type SortState } from '../lib/ui/DataTable.types';
  import DetailStrip from '../lib/ui/DetailStrip.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import Toolbar from '../lib/ui/Toolbar.svelte';
  import TermImport from './TermImport.svelte';

  // Form state, restored from the route so a reload keeps the filters.
  const initial = untrack(() => ({ ...route.params }));
  const hasScopeParam = initial.project !== undefined;
  let scope = $state(hasScopeParam ? fromUrlScope(initial.project) : '');
  // Like the old tab: the scope follows the current corpus until the user picks one.
  let pinned = hasScopeParam;
  let status = $state(STATUSES.includes(initial.status as (typeof STATUSES)[number]) ? initial.status : '');
  let q = $state(initial.q ?? '');
  let domain = $state(initial.domain ?? '');
  let pos = $state(initial.pos ?? '');
  let since = $state(initial.since ?? '');
  let sort = $state<SortState | null>(null);
  let includeCandidates = $state(false);
  // Entries ticked for the bulk actions (ids; a new Set per change).
  const checked = new SvelteSet<number>();
  let bulkStatus = $state('');
  let bulkDomain = $state('');
  let bulkConfirmOpen = $state(false);
  // Every domain seen while no domain filter narrowed the list, so the filter keeps its choices.
  let domainChoices = $state.raw<string[]>([]);

  let terms = $state.raw<Term[]>([]);
  let projects = $state.raw<Project[]>([]);
  // Compared by key (id) inside DataTable, never by identity.
  let selected = $state.raw<Term | null>(null);
  let filter = $state('');
  let loading = $state(false);
  let loadedOnce = $state(false);
  // Id of the row with a mutation in flight: its actions are disabled meanwhile.
  let busyId = $state<number | null>(null);
  let tableEl: HTMLElement | undefined = $state();
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  let importOpen = $state(false);
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
  const exportBase = $derived({
    project: scope,
    status: includeCandidates ? 'approved,admitted,candidate' : 'approved,admitted',
  });
  const exportHref = (format: string) => `/api/terms/export?${qs({ ...exportBase, format })}`;
  const exports = [
    { format: 'tbx', label: t('tb.tbx'), title: undefined },
    { format: 'tbx2', label: t('tb.tbx2'), title: t('tb.tbx2Hint') },
    { format: 'xlsx', label: t('tb.xlsx'), title: undefined },
    { format: 'csv', label: t('tb.csv'), title: undefined },
  ];

  const columns: Column<Term>[] = [
    { key: 'sel', label: '', width: '2.5rem', sortable: false, value: () => '' },
    { key: 'src_term', label: t('tb.col.source'), width: 'minmax(10rem, 1.4fr)' },
    { key: 'tgt_term', label: t('tb.col.target'), width: 'minmax(8rem, 1.2fr)' },
    { key: 'pos', label: t('tb.col.pos'), width: '7rem' },
    {
      key: 'status',
      label: t('tb.col.status'),
      width: '9.5rem',
      value: (r) => t(`badge.${r.status}`),
    },
    { key: 'domain', label: t('tb.col.domain'), width: '8rem' },
    { key: 'context', label: t('tb.col.example'), width: 'minmax(10rem, 2fr)' },
    { key: 'updated', label: t('tb.col.updated'), width: '10rem' },
  ];

  const domainOptions = $derived([
    { value: '', label: t('tb.domain.all') },
    ...[...new Set([...domainChoices, ...(domain ? [domain] : [])])].sort().map((d) => ({ value: d, label: d })),
  ]);
  const posOptions = $derived([{ value: '', label: t('tb.pos.all') }, ...TERM_POS.map((p) => ({ value: p, label: p }))]);
  const bulkOptions = $derived([
    { value: '', label: t('tb.bulkStatus') },
    ...STATUSES.map((s) => ({ value: s, label: t(`badge.${s}`) })),
  ]);
  const filtered = $derived(!!(status || domain || pos || since || q.trim()));

  const count = $derived(terms.length === 1 ? t('tb.count1') : t('tb.count', { n: terms.length }));

  async function load(): Promise<void> {
    const n = ++seq;
    loading = true; // previous rows stay visible (and selected) while loading
    const params = {
      project: scope,
      status,
      q: q.trim(),
      domain,
      pos,
      modified_since: since,
      sort: sort?.key ?? '',
      dir: sort?.dir ?? '',
    };
    try {
      const rows = await get<Term[]>('/api/terms', params);
      if (n !== seq) return;
      terms = rows;
      const seen = [...new Set(rows.map((x) => x.domain).filter(Boolean))].sort();
      termStore.domains = seen;
      if (!domain) domainChoices = seen;
      const ids = new Set(rows.map((x) => x.id));
      for (const id of [...checked]) if (!ids.has(id)) checked.delete(id);
      loadedOnce = true;
      // Persist only a load that worked.
      go('termbase', { project: toUrlScope(scope), status, q: params.q, domain, pos, since });
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

  function edit(row: Term): void {
    const r = terms.find((x) => x.id === row.id) ?? row;
    if (busyId === r.id) return;
    openTerm({
      id: r.id,
      source: r.src_term,
      target: r.tgt_term,
      pos: r.pos,
      status: r.status as Status,
      domain: r.domain,
      definition: r.definition,
      notes: r.notes,
      example: r.context,
      exampleSource: r.context_source,
      srcLang: r.src_lang,
      tgtLang: r.tgt_lang,
      origin: r.origin,
      srcGender: r.src_gender,
      srcNumber: r.src_number,
      srcNote: r.src_note,
      tgtGender: r.tgt_gender,
      tgtNumber: r.tgt_number,
      tgtNote: r.tgt_note,
    });
  }

  /** Add a row to the selected entry's concept: another source term (`source`) or another translation. */
  function addToConcept(r: Term, kind: 'source' | 'translation'): void {
    if (r.concept_id == null) return;
    openTerm({
      source: kind === 'source' ? '' : r.src_term,
      target: kind === 'source' ? r.tgt_term : '',
      pos: r.pos,
      domain: r.domain,
      status: 'approved',
      conceptId: r.concept_id,
      projectId: r.project_id,
      srcLang: r.src_lang,
      tgtLang: r.tgt_lang,
      srcGender: kind === 'source' ? '' : r.src_gender,
      srcNumber: kind === 'source' ? '' : r.src_number,
      tgtGender: kind === 'source' ? r.tgt_gender : '',
      tgtNumber: kind === 'source' ? r.tgt_number : '',
    });
  }

  /** The other rows of the selected entry's concept (its synonyms), from the entries loaded. */
  const relatives = (r: Term) =>
    r.concept_id == null ? [] : terms.filter((x) => x.concept_id === r.concept_id && x.id !== r.id);
  const termData = (g?: string, n?: string) =>
    [g ? t(`term.gender.${g}`) : '', n ? t(`term.number.${n}`) : ''].filter(Boolean).join(', ');

  async function setStatus(r: Term, next: 'approved' | 'forbidden'): Promise<void> {
    if (busyId !== null) return;
    busyId = r.id;
    // a list response still in flight predates this change
    seq++;
    loading = false;
    try {
      await patch(`/api/terms/${r.id}`, { status: next });
      const updated = { ...r, status: next };
      terms = terms.map((x) => (x.id === r.id ? updated : x));
      if (selected?.id === r.id) selected = updated;
      messages.say(t('tb.updated'), 'ok');
    } catch (err) {
      messages.say(errMsg(err), 'err');
    } finally {
      busyId = null;
    }
  }

  /** Inline edit of one field; on failure the control is put back to the stored value. */
  async function inlineEdit(r: Term, field: 'status' | 'tgt_term', el: HTMLInputElement | HTMLSelectElement) {
    const value = el.value.trim();
    if (value === r[field] || busyId !== null) {
      el.value = r[field];
      return;
    }
    busyId = r.id;
    seq++; // a list response still in flight predates this change
    loading = false;
    try {
      await patch(`/api/terms/${r.id}`, { [field]: value });
      const updated = { ...r, [field]: value };
      terms = terms.map((x) => (x.id === r.id ? updated : x));
      if (selected?.id === r.id) selected = updated;
    } catch (err) {
      el.value = r[field];
      messages.say(errMsg(err), 'err');
    } finally {
      busyId = null;
    }
  }

  function toggleRow(id: number, on: boolean): void {
    if (on) checked.add(id);
    else checked.delete(id);
  }

  function toggleAll(on: boolean): void {
    checked.clear();
    if (on) for (const x of terms) checked.add(x.id);
  }

  async function bulkApply(changes: { status?: string; domain?: string }): Promise<void> {
    if (busyId !== null || !checked.size) return;
    busyId = -1;
    try {
      const res = await patch<{ updated: number }>('/api/terms', { ids: [...checked], ...changes });
      messages.say(t('tb.bulkDone', { n: res.updated }), 'ok');
      bulkStatus = '';
      bulkDomain = '';
      await load();
    } catch (err) {
      bulkStatus = '';
      messages.say(errMsg(err), 'err');
    } finally {
      busyId = null;
    }
  }

  async function bulkDelete(): Promise<void> {
    bulkConfirmOpen = false;
    if (busyId !== null || !checked.size) return;
    busyId = -1;
    try {
      const res = await post<{ deleted: number }>('/api/terms/delete', { ids: [...checked] });
      checked.clear();
      selected = null;
      messages.say(t('tb.bulkDeleted', { n: res.deleted }), 'ok');
      await load();
    } catch (err) {
      messages.say(errMsg(err), 'err');
    } finally {
      busyId = null;
    }
  }

  function clearFilters(): void {
    status = domain = pos = since = q = '';
    clearTimeout(timer);
    load();
  }

  function askDelete(r: Term): void {
    toDelete = r;
    confirmOpen = true;
  }

  async function confirmDelete(): Promise<void> {
    const r = toDelete;
    confirmOpen = false;
    if (!r || busyId !== null) return;
    busyId = r.id;
    seq++;
    loading = false;
    try {
      await del(`/api/terms/${r.id}`);
      terms = terms.filter((x) => x.id !== r.id);
      if (selected?.id === r.id) selected = null;
      messages.say(t('tb.deleted'), 'ok');
      await tick();
      tableEl?.querySelector<HTMLElement>('[role="grid"]')?.focus();
    } catch (err) {
      messages.say(errMsg(err), 'err');
    } finally {
      busyId = null;
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

  // Sorting also goes to the server, so a termbase longer than the page limit is cut after sorting.
  let sortSeen: string | undefined;
  $effect(() => {
    const key = sort ? `${sort.key}:${sort.dir}` : '';
    untrack(() => {
      if (sortSeen !== undefined && sortSeen !== key && loadedOnce) load();
      sortSeen = key;
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
  {:else if col.key === 'sel'}
    <input
      type="checkbox"
      checked={checked.has(row.id)}
      aria-label={t('tb.selectRow', { term: row.src_term })}
      onclick={(e) => e.stopPropagation()}
      onchange={(e) => toggleRow(row.id, e.currentTarget.checked)}
    />
  {:else if col.key === 'tgt_term'}
    <input
      class="inline"
      value={row.tgt_term}
      placeholder="—"
      aria-label={t('tb.editTarget', { term: row.src_term })}
      disabled={busyId === row.id}
      maxlength="200"
      onclick={(e) => e.stopPropagation()}
      onchange={(e) => inlineEdit(row, 'tgt_term', e.currentTarget)}
    />
  {:else if col.key === 'status'}
    <select
      class="inline status {row.status}"
      value={row.status}
      aria-label={t('tb.editStatus', { term: row.src_term })}
      disabled={busyId === row.id}
      onclick={(e) => e.stopPropagation()}
      onchange={(e) => inlineEdit(row, 'status', e.currentTarget)}
    >
      {#each STATUSES as s (s)}
        <option value={s}>{t(`badge.${s}`)}</option>
      {/each}
    </select>
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
      <Field label={t('tb.domain')}>
        <Select label={t('tb.domain')} bind:value={domain} options={domainOptions} onchange={load} />
      </Field>
      <Field label={t('tb.pos')}>
        <Select label={t('tb.pos')} bind:value={pos} options={posOptions} onchange={load} />
      </Field>
      <Field label={t('tb.modified')}>
        <input type="date" aria-label={t('tb.modified')} bind:value={since} onchange={load} />
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
      {#if filtered}<Button onclick={clearFilters}>{t('tb.clearFilters')}</Button>{/if}
    </Toolbar>
  </form>
  <div class="export" role="group" aria-label={t('tb.exportGroup')}>
    <Button onclick={() => (importOpen = true)}>{t('imp.open')}</Button>
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
      <input
        type="checkbox"
        checked={terms.length > 0 && checked.size === terms.length}
        disabled={!terms.length || !!filter.trim()}
        aria-label={t('tb.selectAll')}
        title={t('tb.selectAll')}
        onchange={(e) => toggleAll(e.currentTarget.checked)}
      />
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

  {#if checked.size}
    <div class="bulk" role="group" aria-label={t('tb.bulk')}>
      <b>{t('tb.selected', { n: checked.size })}</b>
      <Select
        label={t('tb.bulkStatus')}
        bind:value={bulkStatus}
        options={bulkOptions}
        disabled={busyId !== null}
        onchange={(v) => v && bulkApply({ status: v })}
      />
      <input
        class="bulk-domain"
        bind:value={bulkDomain}
        placeholder={t('tb.bulkDomainPlaceholder')}
        aria-label={t('tb.bulkDomain')}
        maxlength="80"
      />
      <Button disabled={busyId !== null} onclick={() => bulkApply({ domain: bulkDomain })}>
        {t('tb.bulkApply')}
      </Button>
      <Button variant="danger" disabled={busyId !== null} onclick={() => (bulkConfirmOpen = true)}>
        {t('tb.bulkDelete')}
      </Button>
    </div>
  {/if}

  <div class="table" bind:this={tableEl}>
    {#if loadedOnce && !terms.length && !loading}
      <EmptyState title={t('tb.empty')} hint={t('tb.emptyHint')} />
    {:else}
      <DataTable
        {columns}
        rows={terms}
        rowKey={(r) => r.id}
        bind:selected
        bind:filter
        bind:sort
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
          <Button disabled={busyId === r.id} onclick={() => edit(r)}>{t('tb.edit')}</Button>
          <Button disabled={busyId === r.id || r.status === 'approved'} onclick={() => setStatus(r, 'approved')}>{t('tb.approve')}</Button>
          <Button disabled={busyId === r.id || r.status === 'forbidden'} onclick={() => setStatus(r, 'forbidden')}>{t('tb.forbid')}</Button>
          <Button disabled={busyId === r.id || r.concept_id == null} onclick={() => addToConcept(r, 'translation')}>{t('tb.addTranslation')}</Button>
          <Button disabled={busyId === r.id || r.concept_id == null} onclick={() => addToConcept(r, 'source')}>{t('tb.addSynonym')}</Button>
          <Button variant="danger" disabled={busyId === r.id} onclick={() => askDelete(r)}>{t('tb.delete')}</Button>
        {/snippet}
        <dl>
          <dt>{t('tb.col.source')}</dt>
          <dd><b>{r.src_term}</b></dd>
          <dt>{t('tb.col.target')}</dt>
          <dd>{#if r.tgt_term}{r.tgt_term}{:else}<span class="muted">—</span>{/if}</dd>
          <dt>{t('tb.languages')}</dt>
          <dd>{r.src_lang}→{r.tgt_lang}{r.project ? ` · ${r.project}` : ''}</dd>
          <dt>{t('tb.col.status')}</dt>
          <dd><Badge kind={r.status as Status} /></dd>
          {#if termData(r.src_gender, r.src_number)}<dt>{t('tb.srcData')}</dt><dd>{termData(r.src_gender, r.src_number)}</dd>{/if}
          {#if termData(r.tgt_gender, r.tgt_number)}<dt>{t('tb.tgtData')}</dt><dd>{termData(r.tgt_gender, r.tgt_number)}</dd>{/if}
          {#if r.src_note}<dt>{t('term.srcNote')}</dt><dd>{r.src_note}</dd>{/if}
          {#if r.tgt_note}<dt>{t('term.tgtNote')}</dt><dd>{r.tgt_note}</dd>{/if}
          {#if relatives(r).length}
            <dt>{t('tb.concept')}</dt>
            <dd>
              <ul class="concept">
                {#each relatives(r) as x (x.id)}<li>{x.src_term} → {x.tgt_term || '—'} <Badge kind={x.status as Status} /></li>{/each}
              </ul>
            </dd>
          {/if}
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

<TermImport bind:open={importOpen} {projects} {scope} onimported={load} />

<Dialog bind:open={confirmOpen} title={t('tb.confirmTitle')}>
  <p class="confirm">{t('tb.confirmBody', { term: toDelete?.src_term ?? '' })}</p>
  {#snippet footer()}
    <Button onclick={() => (confirmOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={confirmDelete}>{t('tb.delete')}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={bulkConfirmOpen} title={t('tb.bulkConfirmTitle')}>
  <p class="confirm">{t('tb.bulkConfirmBody', { n: checked.size })}</p>
  {#snippet footer()}
    <Button onclick={() => (bulkConfirmOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={bulkDelete}>{t('tb.bulkDelete')}</Button>
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
  .bulk {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-3);
    font-size: var(--fs-small);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .bulk-domain {
    width: 10rem;
  }
  .inline {
    width: 100%;
    min-width: 0;
  }
  select.status.approved,
  select.status.admitted {
    color: var(--status-approved);
  }
  select.status.candidate {
    color: var(--status-candidate);
  }
  select.status.forbidden {
    color: var(--status-forbidden);
  }
  select.status.superseded {
    color: var(--muted);
    font-style: italic;
  }
  .filter {
    width: 14rem;
    margin-left: var(--s-2);
  }
  .concept {
    margin: 0;
    padding-left: 1.1rem;
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
