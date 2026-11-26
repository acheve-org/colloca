<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { corpusStore } from '../corpus.svelte';
  import { t } from '../i18n';
  import { route } from '../router.svelte';
  import {
    clearScope,
    clearScopePart,
    loadScope,
    refreshScope,
    refreshScopeSoon,
    scopeActive,
    scopeChips,
    scopeSummary,
    scopeView,
    startScope,
  } from '../scope.svelte';
  import Button from './Button.svelte';
  import { dismiss } from './dismiss';
  import Field from './Field.svelte';
  import Select from './Select.svelte';

  const uid = $props.id();
  const scope = $derived(corpusStore.scope);
  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let tagsInput = $state<HTMLInputElement | null>(null);

  const active = $derived(scopeActive());
  const chips = $derived(scopeChips());
  const ready = $derived(scopeView.info !== null || !!scopeView.error);
  const filtered = $derived(!!scopeView.info?.filtered);
  const pillText = $derived(
    scopeView.info?.filtered
      ? t('scope.summary', { docs: scopeView.info.docs, total: scopeView.info.total_docs })
      : t('scope.all'),
  );

  const typeOptions = $derived([
    { value: '', label: t('filter.anyType') },
    ...scopeView.facets.text_types.map((x) => ({ value: x.text_type, label: `${x.text_type} (${x.docs})` })),
    // keep a value set before the facets arrived (or no longer present) selectable
    ...(scope.type && !scopeView.facets.text_types.some((x) => x.text_type === scope.type)
      ? [{ value: scope.type, label: scope.type }]
      : []),
  ]);

  async function toggle() {
    open = !open;
    if (!open) return;
    void loadScope(); // an import may have finished since the last load; keeps the current summary meanwhile
    await tick();
    tagsInput?.focus();
  }

  function done() {
    open = false;
    trigger?.focus();
  }

  /** The chip (and its button) disappears: keep focus from falling to the page body. */
  function removeChip(key: Parameters<typeof clearScopePart>[0]) {
    clearScopePart(key);
    trigger?.focus();
  }

  // Moving to another screen closes the panel (the control stays mounted in the header).
  $effect(() => {
    void route.screen;
    open = false;
  });

  onMount(() => startScope());
</script>

<div class="scope">
  <div class="anchor">
    <button
      type="button"
      class="pill"
      class:on={filtered}
      class:muted={!ready}
      aria-label={t('scope.label') + ': ' + pillText}
      aria-expanded={open}
      bind:this={trigger}
      onclick={toggle}
    >
      <span>{pillText}</span>
      <span aria-hidden="true">▾</span>
    </button>
    {#if open}
      <div class="panel" role="group" aria-labelledby="{uid}-title" use:dismiss={{ close: () => (open = false), trigger }}>
        <div class="title" id="{uid}-title">{t('scope.title')}</div>
        <p class="lead">{t('scope.lead')}</p>
        <div class="fields">
          <Field label={t('filter.tags')}>
            <input
              bind:this={tagsInput}
              bind:value={scope.tags}
              list="{uid}-tags"
              placeholder={t('filter.tagsPlaceholder')}
              oninput={refreshScopeSoon}
            />
          </Field>
          <datalist id="{uid}-tags">
            {#each scopeView.facets.tags as x (x.tag)}<option value={x.tag}>{t('filter.docs', { docs: x.docs })}</option>{/each}
          </datalist>
          <Field label={t('filter.type')}>
            <Select label={t('filter.type')} bind:value={scope.type} options={typeOptions} onchange={refreshScope} />
          </Field>
          <div class="dates">
            <Field label={t('filter.from')}>
              <input bind:value={scope.from} placeholder={scopeView.facets.date_min || t('filter.fromPlaceholder')} oninput={refreshScopeSoon} />
            </Field>
            <Field label={t('filter.to')}>
              <input bind:value={scope.to} placeholder={scopeView.facets.date_max || t('filter.toPlaceholder')} oninput={refreshScopeSoon} />
            </Field>
          </div>
        </div>
        <p class="summary" class:on={filtered} class:err={!!scopeView.error} aria-live="polite">{scopeSummary()}</p>
        <div class="actions">
          {#if active}<Button onclick={clearScope}>{t('scope.clear')}</Button>{/if}
          <Button onclick={done}>{t('scope.done')}</Button>
        </div>
      </div>
    {/if}
  </div>
  {#each chips as c (c.key)}
    <span class="chip">
      <span>{c.text}</span>
      <button type="button" class="x" aria-label={t('scope.remove', { name: c.text })} onclick={() => removeChip(c.key)}>
        <span aria-hidden="true">×</span>
      </button>
    </span>
  {/each}
</div>

<style>
  .scope {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-1);
    min-width: 0;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    border-radius: 999px;
  }
  .pill.on {
    color: var(--fg); /* accent text is not safe on --accent-soft */
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .pill.muted {
    color: var(--muted);
  }
  @media (max-width: 600px) {
    .scope {
      flex: 1 1 100%;
    }
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    padding: 0 var(--s-1) 0 var(--s-2);
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--fg);
    font-size: var(--fs-small);
  }
  .x {
    padding: 0 var(--s-1);
    color: inherit;
    background: none;
    border: 0;
    font: inherit;
    cursor: pointer;
  }
  .panel {
    position: absolute;
    left: auto;
    right: var(--page-pad); /* matches the context band's side padding */
    top: 100%;
    z-index: 10;
    box-sizing: border-box;
    /* Positioned against the nearest positioned ancestor (the context band), opening under the
       pill at the band's right edge; on narrow screens it spans the band minus its side padding. */
    width: min(340px, calc(100% - 2 * var(--page-pad)));
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin-top: var(--s-1);
    padding: var(--s-3);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
  }
  .title {
    font-weight: 600;
  }
  .lead,
  .summary {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .fields :global(.field),
  .fields :global(input),
  .fields :global(select) {
    width: 100%;
    box-sizing: border-box;
  }
  .dates {
    display: flex;
    gap: var(--s-2);
  }
  .dates :global(.field) {
    flex: 1;
    min-width: 0;
  }
  .summary.on {
    color: var(--accent);
    font-weight: 600;
  }
  .summary.err {
    color: var(--danger);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-2);
  }
</style>
