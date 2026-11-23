<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { corpusStore } from './lib/corpus.svelte';
  import { t } from './lib/i18n';
  import { messages } from './lib/messages.svelte';
  import { go, route } from './lib/router.svelte';
  import { registerShortcut } from './lib/shortcuts.svelte';
  import AppShell from './lib/ui/AppShell.svelte';
  import EmptyState from './lib/ui/EmptyState.svelte';
  import ShortcutHelp from './lib/ui/ShortcutHelp.svelte';
  import type { Component } from 'svelte';
  import type { ScreenId } from './lib/router.svelte';
  import Collocations from './screens/Collocations.svelte';
  import Concordance from './screens/Concordance.svelte';
  import Equivalents from './screens/Equivalents.svelte';
  import Frequency from './screens/Frequency.svelte';
  import Keyness from './screens/Keyness.svelte';
  import Ngrams from './screens/Ngrams.svelte';
  import Termbase from './screens/Termbase.svelte';
  import TermDialog from './screens/TermDialog.svelte';
  import WordCloud from './screens/WordCloud.svelte';

  // Screen outlet: screens not built yet render the placeholder.
  const SCREEN_COMPONENTS: Partial<Record<ScreenId, Component>> = {
    concordance: Concordance,
    frequency: Frequency,
    collocations: Collocations,
    ngrams: Ngrams,
    keyness: Keyness,
    equivalents: Equivalents,
    cloud: WordCloud,
    termbase: Termbase,
  };
  const Screen = $derived(SCREEN_COMPONENTS[route.screen]);

  let helpOpen = $state(false);

  onMount(() => {
    corpusStore.reload().catch((err) => {
      messages.say(err instanceof Error ? err.message : String(err), 'err');
    });
    const offs = [
      registerShortcut({
        id: 'search',
        keys: 'Mod+K',
        label: t('shortcuts.search'),
        run: async () => {
          // Keep the current search params when already on the concordance.
          if (route.screen !== 'concordance') go('concordance');
          await tick();
          requestAnimationFrame(() => document.getElementById('cc-query')?.focus());
        },
      }),
      registerShortcut({
        id: 'help',
        keys: '?',
        label: t('shortcuts.help'),
        run: () => (helpOpen = true),
      }),
    ];
    return () => offs.forEach((f) => f());
  });
</script>

<AppShell>
  {#if Screen}
    {#key route.screen}<Screen />{/key}
  {:else}
    <div class="screen">
      <EmptyState title={t(`nav.${route.screen}`)} hint={t('screen.placeholder')} />
    </div>
  {/if}
</AppShell>
<ShortcutHelp bind:open={helpOpen} />
<TermDialog />

<style>
  .screen {
    padding: var(--s-3);
  }
</style>
