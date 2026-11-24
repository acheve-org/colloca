<script lang="ts">
  import { workingContext } from '../context.svelte';
  import { t } from '../i18n';
  import { route, screenHref } from '../router.svelte';

  const ctx = $derived(workingContext());
  // The Projects and Languages screens are where the context changes: no strip there.
  const hidden = $derived(route.screen === 'projects' || route.screen === 'languages');
</script>

{#if !hidden}
  <nav class="bar" aria-label={t('ctx.label')}>
    {#if ctx}
      <a href={screenHref('languages')}>{ctx.languageName}</a>
      <span class="sep" aria-hidden="true">›</span>
      <a href={screenHref('projects')}>{ctx.project?.name ?? t('ctx.noProject')}</a>
      <span class="sep" aria-hidden="true">›</span>
      <strong>{ctx.corpus.name}</strong>
    {:else}
      <span class="muted">{t('ctx.noCorpus')}</span>
    {/if}
  </nav>
{/if}

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
    align-items: baseline;
    padding: var(--s-1) var(--s-3);
    font-size: var(--fs-small);
    border-bottom: 1px solid var(--line);
  }
  .sep,
  .muted {
    color: var(--muted);
  }
</style>
