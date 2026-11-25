<script lang="ts">
  import { onMount } from 'svelte';
  import { corpusStore } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import { clearScope, refreshScope, refreshScopeSoon, scopeSummary, scopeView, startScope } from '../lib/scope.svelte';
  import Button from '../lib/ui/Button.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';

  const uid = $props.id();
  const scope = $derived(corpusStore.scope);

  const typeOptions = $derived([
    { value: '', label: t('filter.anyType') },
    ...scopeView.facets.text_types.map((x) => ({ value: x.text_type, label: `${x.text_type} (${x.docs})` })),
    // keep a value set before the facets arrived (or no longer present) selectable
    ...(scope.type && !scopeView.facets.text_types.some((x) => x.text_type === scope.type)
      ? [{ value: scope.type, label: scope.type }]
      : []),
  ]);

  onMount(() => startScope());
</script>

<div class="scope" role="group" aria-label={t('filter.label')}>
  <span class="lead">{t('filter.only')}</span>
  <Field label={t('filter.tags')}>
    <input
      bind:value={scope.tags}
      list="{uid}-tags"
      placeholder={t('filter.tagsPlaceholder')}
      size="14"
      oninput={refreshScopeSoon}
    />
  </Field>
  <datalist id="{uid}-tags">
    {#each scopeView.facets.tags as x (x.tag)}<option value={x.tag}>{t('filter.docs', { docs: x.docs })}</option>{/each}
  </datalist>
  <Field label={t('filter.type')}>
    <Select label={t('filter.type')} bind:value={scope.type} options={typeOptions} onchange={refreshScope} />
  </Field>
  <Field label={t('filter.from')}>
    <input bind:value={scope.from} placeholder={scopeView.facets.date_min || t('filter.fromPlaceholder')} size="8" oninput={refreshScopeSoon} />
  </Field>
  <Field label={t('filter.to')}>
    <input bind:value={scope.to} placeholder={scopeView.facets.date_max || t('filter.toPlaceholder')} size="8" oninput={refreshScopeSoon} />
  </Field>
  <Button onclick={clearScope}>{t('scope.clear')}</Button>
  <span class="summary" class:on={scopeView.info?.filtered} class:err={!!scopeView.error} aria-live="polite">{scopeSummary()}</span>
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
