<script lang="ts">
  import { t } from '../i18n';
  import { listShortcuts } from '../shortcuts.svelte';
  import Dialog from './Dialog.svelte';
  import Kbd from './Kbd.svelte';

  let { open = $bindable() }: { open: boolean } = $props();

  interface Row {
    id: string;
    keys: string[];
    label: string;
  }

  // Keys handled by the components themselves (DataTable, Dialog), not registered shortcuts.
  const builtIn = (scope: 'global' | 'table'): Row[] =>
    scope === 'table'
      ? [
          { id: 'rows', keys: ['ArrowUp', 'ArrowDown'], label: t('shortcuts.rows') },
          { id: 'activate', keys: ['Enter'], label: t('shortcuts.activate') },
        ]
      : [{ id: 'close', keys: ['Escape'], label: t('shortcuts.close') }];

  const registered = (scope: 'global' | 'table'): Row[] =>
    listShortcuts()
      .filter((s) => (s.scope ?? 'global') === scope)
      .map((s) => ({ id: s.id, keys: [s.keys], label: s.label }));

  const groups = $derived([
    { name: t('shortcuts.global'), items: [...registered('global'), ...builtIn('global')] },
    { name: t('shortcuts.table'), items: [...registered('table'), ...builtIn('table')] },
  ]);
</script>

<Dialog bind:open title={t('shortcuts.title')}>
  {#each groups as g (g.name)}
    <section>
      <h3>{g.name}</h3>
      <dl>
        {#each g.items as s (s.id)}
          <dt>
            {#each s.keys as k (k)}<Kbd keys={k} />{/each}
          </dt>
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
  dt {
    display: flex;
    gap: 2px;
  }
</style>
