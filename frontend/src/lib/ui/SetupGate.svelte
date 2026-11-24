<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n';
  import { route } from '../router.svelte';
  import { setupReady, setupStep } from '../setup.svelte';
  import EmptyState from './EmptyState.svelte';

  let { children }: { children: Snippet } = $props();

  // Where the user sets things up (and the Trash, which works without a corpus).
  const FREE = ['languages', 'projects', 'trash'];

  // Hold only until the first time everything has loaded: a later corpus switch (loaded toggles
  // false for a moment) must not unmount the screen. Plain variable on purpose, not state.
  let settled = false;
  const hold = $derived.by(() => {
    if (settled) return false;
    if (setupReady()) {
      settled = true;
      return false;
    }
    return !FREE.includes(route.screen);
  });
  const step = $derived(FREE.includes(route.screen) || hold ? null : setupStep());
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
