<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from '../lib/api';
  import { CORPUS_CHANGED, corpusStore, scopeParams } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import type { Facets, Project, ScopeInfo } from '../lib/types';
  import Button from '../lib/ui/Button.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';

  const uid = $props.id();
  const scope = $derived(corpusStore.scope);

  let facets = $state.raw<Facets>({ tags: [], text_types: [], date_min: '', date_max: '' });
  let projects = $state.raw<Project[]>([]);
  let info = $state.raw<ScopeInfo | null>(null);
  let infoError = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  const typeOptions = $derived([
    { value: '', label: t('filter.anyType') },
    ...facets.text_types.map((x) => ({ value: x.text_type, label: `${x.text_type} (${x.docs})` })),
    // keep a value set before the facets arrived (or no longer present) selectable
    ...(scope.type && !facets.text_types.some((x) => x.text_type === scope.type)
      ? [{ value: scope.type, label: scope.type }]
      : []),
  ]);
  const projectOptions = $derived([
    { value: '', label: t('filter.anyProject') },
    { value: 'none', label: t('filter.noProject') },
    ...projects.map((p) => ({ value: String(p.id), label: p.name })),
  ]);

  const summary = $derived.by(() => {
    if (infoError) return infoError;
    if (!info) return '';
    if (!info.filtered) return t('scope.all');
    return t('filter.summary', {
      docs: info.docs,
      total: info.total_docs,
      words: info.words.toLocaleString(),
      totalWords: info.total_words.toLocaleString(),
    });
  });

  async function refreshScope(): Promise<void> {
    const id = corpusStore.currentId;
    if (id === null) return;
    const n = ++seq;
    try {
      const r = await get<ScopeInfo>(`/api/corpora/${id}/scope`, scopeParams());
      if (n !== seq) return;
      info = r;
      infoError = '';
    } catch (err) {
      if (n !== seq) return;
      info = null;
      infoError = err instanceof Error ? err.message : String(err);
    }
  }

  async function refreshFacets(): Promise<void> {
    const id = corpusStore.currentId;
    if (id === null) return;
    try {
      const f = await get<Facets>(`/api/corpora/${id}/facets`);
      if (corpusStore.currentId !== id) return;
      facets = f;
    } catch {
      // the summary line reports errors; facets only feed suggestions
    }
    await refreshScope();
  }

  function debounced(): void {
    clearTimeout(timer);
    timer = setTimeout(refreshScope, 350);
  }

  function clear(): void {
    corpusStore.clearScope();
    refreshScope();
  }

  onMount(() => {
    const onChange = () => {
      facets = { tags: [], text_types: [], date_min: '', date_max: '' };
      info = null;
      infoError = '';
      refreshFacets();
    };
    window.addEventListener(CORPUS_CHANGED, onChange);
    refreshFacets();
    get<Project[]>('/api/projects')
      .then((p) => (projects = p))
      .catch(() => {});
    return () => {
      window.removeEventListener(CORPUS_CHANGED, onChange);
      clearTimeout(timer);
    };
  });
</script>

<div class="scope" role="group" aria-label={t('filter.label')}>
  <span class="lead">{t('filter.only')}</span>
  <Field label={t('filter.tags')}>
    <input
      bind:value={scope.tags}
      list="{uid}-tags"
      placeholder={t('filter.tagsPlaceholder')}
      size="14"
      oninput={debounced}
    />
  </Field>
  <datalist id="{uid}-tags">
    {#each facets.tags as x (x.tag)}<option value={x.tag}>{t('filter.docs', { docs: x.docs })}</option>{/each}
  </datalist>
  <Field label={t('filter.type')}>
    <Select label={t('filter.type')} bind:value={scope.type} options={typeOptions} onchange={refreshScope} />
  </Field>
  <Field label={t('filter.from')}>
    <input bind:value={scope.from} placeholder={facets.date_min || t('filter.fromPlaceholder')} size="8" oninput={debounced} />
  </Field>
  <Field label={t('filter.to')}>
    <input bind:value={scope.to} placeholder={facets.date_max || t('filter.toPlaceholder')} size="8" oninput={debounced} />
  </Field>
  {#if projects.length}
    <Field label={t('filter.project')}>
      <Select label={t('filter.project')} bind:value={scope.project} options={projectOptions} />
    </Field>
  {/if}
  <Button onclick={clear}>{t('scope.clear')}</Button>
  <span class="summary" class:on={info?.filtered} class:err={!!infoError} aria-live="polite">{summary}</span>
</div>

<style>
  .scope {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-3) var(--s-2);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .lead {
    align-self: center;
    margin-top: 14px;
    color: var(--muted);
    font-size: var(--fs-small);
    font-weight: 600;
  }
  .summary {
    align-self: center;
    margin-top: 14px;
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .summary.on {
    color: var(--accent);
    font-weight: 600;
  }
  .summary.err {
    color: var(--danger);
  }
</style>
