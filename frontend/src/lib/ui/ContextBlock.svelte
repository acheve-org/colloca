<script lang="ts">
  import { workingContext } from '../context.svelte';
  import { corpusStore } from '../corpus.svelte';
  import { t } from '../i18n';
  import { projectStore } from '../projects.svelte';
  import { screenHref } from '../router.svelte';

  const ctx = $derived(workingContext());
  const working = $derived(corpusStore.list.filter((c) => !c.is_reference));
  const known = $derived(new Set(projectStore.list.map((p) => p.id)));
  const groups = $derived.by(() => {
    const named = projectStore.list
      .map((p) => ({ label: p.name, corpora: working.filter((c) => c.project_id === p.id) }))
      .filter((g) => g.corpora.length);
    const loose = working.filter((c) => c.project_id == null || !known.has(c.project_id));
    return loose.length ? [...named, { label: t('ctx.noProject'), corpora: loose }] : named;
  });

  const pick = (e: Event) => corpusStore.select(Number((e.currentTarget as HTMLSelectElement).value));
</script>

<div class="block">
  <div class="head">
    <span class="label">{t('ctx.working')}</span>
    <a href={screenHref('projects')}>{t('ctx.change')}</a>
  </div>
  {#if ctx}
    <strong class="corpus">{ctx.corpus.name}</strong>
    <div class="line">
      <span class="project">{ctx.project?.name ?? t('ctx.noProject')}</span>
      <span class="badge" title={ctx.languageName}>{ctx.language.toUpperCase()}</span>
    </div>
  {:else}
    <div class="empty">{t('ctx.noCorpus')}</div>
  {/if}
  {#if working.length}
    <select aria-label={t('corpus.switcher')} value={String(corpusStore.currentId ?? '')} onchange={pick}>
      {#if corpusStore.currentId === null}<option value="" disabled>{t('ctx.choose')}</option>{/if}
      {#each groups as g (g.label)}
        <optgroup label={g.label}>
          {#each g.corpora as c (c.id)}<option value={String(c.id)}>{c.name}</option>{/each}
        </optgroup>
      {/each}
    </select>
  {/if}
</div>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: 0 var(--s-3) var(--s-2);
  }
  .head {
    display: flex;
    justify-content: space-between;
    color: var(--rail-muted);
    font-size: var(--fs-small);
  }
  .head a {
    color: var(--rail-fg);
  }
  .line {
    display: flex;
    gap: var(--s-1);
    align-items: center;
    color: var(--rail-muted);
    font-size: var(--fs-small);
  }
  .badge {
    padding: 0 var(--s-1);
    color: var(--rail-fg);
    border: 1px solid var(--rail-accent);
    border-radius: var(--radius);
  }
  .empty {
    color: var(--rail-muted);
    font-size: var(--fs-small);
  }
  select {
    width: 100%;
    color: var(--rail-fg);
    background: var(--rail-hover);
    border-color: var(--rail-hover);
  }
</style>
