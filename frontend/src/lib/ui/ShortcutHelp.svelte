<script lang="ts">
  import { t } from '../i18n';
  import { listShortcuts } from '../shortcuts.svelte';
  import Dialog from './Dialog.svelte';
  import Kbd from './Kbd.svelte';

  let { open = $bindable() }: { open: boolean } = $props();

  const groups = $derived([
    { name: t('shortcuts.global'), items: listShortcuts().filter((s) => (s.scope ?? 'global') === 'global') },
    { name: t('shortcuts.table'), items: listShortcuts().filter((s) => s.scope === 'table') },
  ].filter((g) => g.items.length));
</script>

<Dialog bind:open title={t('shortcuts.title')}>
  {#each groups as g (g.name)}
    <section>
      <h3>{g.name}</h3>
      <dl>
        {#each g.items as s (s.id)}
          <dt><Kbd keys={s.keys} /></dt>
          <dd>{s.label}</dd>
        {/each}
      </dl>
    </section>
  {/each}
</Dialog>

<style>
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--s-1) var(--s-3);
    margin: var(--s-1) 0 0;
  }
  dd,
  dt {
    margin: 0;
  }
</style>
