<script lang="ts">
  import { workingContext } from '../context.svelte';
  import { t } from '../i18n';
  import { screenHref } from '../router.svelte';

  const ctx = $derived(workingContext());
</script>

<div class="block">
  <div class="head">
    <span class="label">{t('ctx.working')}</span>
    <a href={screenHref('projects')}>{t('ctx.change')}</a>
  </div>
  {#if ctx}
    <strong class="project">{ctx.project?.name ?? t('ctx.noProject')}</strong>
    <div class="line">
      <span class="corpus">{ctx.corpus.name}</span>
      <span class="badge" title={ctx.languageName}>{ctx.language.toUpperCase()}</span>
    </div>
  {:else}
    <div class="empty">{t('ctx.noCorpus')}</div>
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
  .project {
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .line {
    display: flex;
    gap: var(--s-1);
    align-items: center;
    color: var(--rail-fg);
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
</style>
