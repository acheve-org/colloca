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
          go('concordance');
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
      registerShortcut({
        id: 'escape',
        keys: 'Escape',
        label: t('shortcuts.escape'),
        run: () => {
          const open = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
          open[open.length - 1]?.close();
        },
      }),
    ];
    return () => offs.forEach((f) => f());
  });
</script>

<AppShell>
  <!-- Screens arrive in later tasks; each will own its toolbar, table and DetailStrip. -->
  <div class="screen">
    <h1>{t(`nav.${route.screen}`)}</h1>
    <EmptyState title={t(`nav.${route.screen}`)} hint={t('screen.placeholder')} />
  </div>
</AppShell>
<ShortcutHelp bind:open={helpOpen} />

<style>
  .screen {
    padding: var(--s-3);
  }
</style>
