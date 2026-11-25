<script lang="ts">
  import { corpusStore } from '../corpus.svelte';
  import { workingContext } from '../context.svelte';
  import { t } from '../i18n';
  import { projectStore } from '../projects.svelte';
  import { screenHref } from '../router.svelte';
  import type { Corpus } from '../types';
  import { dismiss } from './dismiss';

  const ctx = $derived(workingContext());
  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);

  /** Non-reference corpora by project, then those without one; empty groups are left out. */
  const groups = $derived.by(() => {
    const own = corpusStore.list.filter((c) => !c.is_reference);
    const out: { key: string; name: string; items: Corpus[] }[] = projectStore.list.map((p) => ({
      key: String(p.id),
      name: p.name,
      items: own.filter((c) => c.project_id === p.id),
    }));
    out.push({ key: 'none', name: t('ctx.noProject'), items: own.filter((c) => c.project_id === null || !projectStore.list.some((p) => p.id === c.project_id)) });
    return out.filter((g) => g.items.length);
  });

  async function choose(id: number) {
    open = false;
    trigger?.focus(); // the item is about to unmount: keep focus in the header
    await corpusStore.select(id);
  }
</script>

<div class="picker" role="group" aria-label={t('ctx.working')}>
  <div class="row">
    <button
      type="button"
      class="trigger"
      aria-expanded={open}
      bind:this={trigger}
      onclick={() => (open = !open)}
    >
      {#if ctx}
        <span class="name" title={ctx.corpus.name}>{ctx.corpus.name}</span>
        <span class="badge" title={ctx.languageName}>{ctx.language.toUpperCase()}</span>
        {#if corpusStore.aligned}<span class="badge">{t('src.check.aligned')}</span>{/if}
      {:else}
        <span class="name empty">{t('ctx.noCorpus')}</span>
      {/if}
      <span aria-hidden="true">▾</span>
    </button>
    {#if ctx}
      <span class="project" title={ctx.project?.name ?? t('ctx.noProject')}>{ctx.project?.name ?? t('ctx.noProject')}</span>
    {/if}
  </div>
  {#if open}
    <div class="pop" use:dismiss={{ close: () => (open = false), trigger }}>
      {#each groups as g (g.key)}
        <div role="group" aria-labelledby="picker-h-{g.key}">
          <div class="heading" id="picker-h-{g.key}">{g.name}</div>
          {#each g.items as c (c.id)}
            <button
              type="button"
              class="item"
              title={c.name}
              aria-current={c.id === corpusStore.currentId ? 'true' : undefined}
              onclick={() => choose(c.id)}>{c.name}</button
            >
          {/each}
        </div>
      {/each}
      <a class="manage" href={screenHref('projects')} onclick={() => (open = false)}>{t('ctx.manage')}</a>
    </div>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    min-width: 0;
    max-width: 18rem;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    color: var(--muted);
  }
  .badge {
    padding: 0 var(--s-1);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    font-size: var(--fs-small);
  }
  .project {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .pop {
    position: absolute;
    left: 0;
    top: 100%;
    z-index: 10;
    min-width: 220px;
    max-width: 24rem;
    max-height: 60vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: var(--s-1) 0;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
  }
  .heading {
    padding: var(--s-1) var(--s-3);
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .item,
  .manage {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: var(--s-1) var(--s-3) var(--s-1) var(--s-4);
    color: var(--fg);
    text-align: left;
    text-decoration: none;
    background: none;
    border: 0;
    border-radius: 0;
    font: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .manage {
    padding-left: var(--s-3);
    border-top: 1px solid var(--line);
  }
  .item:hover,
  .manage:hover {
    background: var(--surface);
  }
  .item[aria-current='true'] {
    font-weight: 600;
  }
</style>
