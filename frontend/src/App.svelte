<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { corpusStore } from './lib/corpus.svelte';
  import { t } from './lib/i18n';
  import { startJobTracking } from './lib/jobs.svelte';
  import { messages } from './lib/messages.svelte';
  import { go, route } from './lib/router.svelte';
  import { registerShortcut } from './lib/shortcuts.svelte';
  import AppShell from './lib/ui/AppShell.svelte';
  import ShortcutHelp from './lib/ui/ShortcutHelp.svelte';
  import type { Component } from 'svelte';
  import type { ScreenId } from './lib/router.svelte';
  import BaseCorpora from './screens/BaseCorpora.svelte';
  import Collocations from './screens/Collocations.svelte';
  import Concordance from './screens/Concordance.svelte';
  import Equivalents from './screens/Equivalents.svelte';
  import Frequency from './screens/Frequency.svelte';
  import CheckText from './screens/CheckText.svelte';
  import Job from './screens/Job.svelte';
  import Keyness from './screens/Keyness.svelte';
  import Ngrams from './screens/Ngrams.svelte';
  import Sources from './screens/Sources.svelte';
  import Candidates from './screens/Candidates.svelte';
  import Termbase from './screens/Termbase.svelte';
  import TermDialog from './screens/TermDialog.svelte';
  import WordCloud from './screens/WordCloud.svelte';

  // Screen outlet: every route has its screen.
  const SCREEN_COMPONENTS: Record<ScreenId, Component> = {
    sources: Sources,
    base: BaseCorpora,
    concordance: Concordance,
    frequency: Frequency,
    collocations: Collocations,
    ngrams: Ngrams,
    keyness: Keyness,
    equivalents: Equivalents,
    cloud: WordCloud,
    termbase: Termbase,
    candidates: Candidates,
    check: CheckText,
    job: Job,
  };
  const Screen = $derived(SCREEN_COMPONENTS[route.screen]);

  let helpOpen = $state(false);

  onMount(() => {
    // Background jobs of the current corpus are followed here, whatever screen is open.
    const stopJobs = startJobTracking();
    corpusStore.reload().catch((err) => {
      messages.say(err instanceof Error ? err.message : String(err), 'err');
    });
    const offs = [
      registerShortcut({
        id: 'search',
        keys: 'Mod+K',
        label: t('shortcuts.search'),
        // Not from inside a modal (the term dialog, the shortcut help): it would navigate behind it.
        when: () => !document.querySelector('dialog[open]'),
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
    return () => {
      offs.forEach((f) => f());
      stopJobs();
    };
  });
</script>

<AppShell>
  {#key route.screen}<Screen />{/key}
</AppShell>
<ShortcutHelp bind:open={helpOpen} />
<TermDialog />
