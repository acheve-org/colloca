<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n';
  import { route } from '../router.svelte';
  import { setupReady, setupStep } from '../setup.svelte';
  import EmptyState from './EmptyState.svelte';

  let { children }: { children: Snippet } = $props();

  // Where the user sets things up (and the Trash, which works without a corpus).
  const FREE = ['languages', 'projects', 'trash'];

  const step = $derived(FREE.includes(route.screen) || !setupReady() ? null : setupStep());
  const hold = $derived(!FREE.includes(route.screen) && !setupReady());
</script>

{#if hold}
  <!-- Stores still loading: render nothing rather than flash an empty state. -->
{:else if step === 'language'}
  <EmptyState title={t('setup.language.title')} hint={t('setup.language.hint')} />
  <p class="go"><a href="#/languages">{t('setup.language.go')}</a></p>
{:else if step === 'project'}
  <EmptyState title={t('setup.project.title')} hint={t('setup.project.hint')} />
  <p class="go"><a href="#/projects">{t('setup.go')}</a></p>
{:else if step === 'corpus'}
  <EmptyState title={t('setup.corpus.title')} hint={t('setup.corpus.hint')} />
  <p class="go"><a href="#/projects">{t('setup.go')}</a></p>
{:else}
  {@render children()}
{/if}

<style>
  .go {
    margin: 0;
    text-align: center;
  }
</style>
