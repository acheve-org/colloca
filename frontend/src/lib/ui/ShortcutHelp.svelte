<script lang="ts">
  import { t } from '../i18n';
  import { captureKeys, formatKeys, keysOf, listShortcuts, resetBindings, setBinding } from '../shortcuts.svelte';
  import Dialog from './Dialog.svelte';
  import Kbd from './Kbd.svelte';

  let { open = $bindable() }: { open: boolean } = $props();

  interface Row {
    id: string;
    keys: string[];
    label: string;
    edit?: boolean;
  }

  let capturingId = $state<string | null>(null);

  async function rebind(id: string): Promise<void> {
    capturingId = id;
    const k = await captureKeys();
    capturingId = null;
    if (k) setBinding(id, k);
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
      .filter((s) => (s.scope ?? 'global') === scope && !/^term-example-[2-9]$/.test(s.id))
      .map((s) => ({ id: s.id, keys: [keysOf(s)], label: s.label, edit: true }));

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
            {#if s.edit}
              <button
                type="button"
                class="key"
                title={t('shortcuts.change')}
                aria-label="{s.label}: {formatKeys(s.keys[0])}. {t('shortcuts.change')}"
                onclick={() => rebind(s.id)}
              >
                {#if capturingId === s.id}<span role="status">{t('shortcuts.press')}</span>{:else}<Kbd keys={s.keys[0]} />{/if}
              </button>
            {:else}
              {#each s.keys as k (k)}<Kbd keys={k} />{/each}
            {/if}
          </dt>
          <dd>{s.label}</dd>
        {/each}
      </dl>
    </section>
  {/each}
  <p class="hint">{t('shortcuts.hint')} <button type="button" onclick={resetBindings}>{t('shortcuts.reset')}</button></p>
</Dialog>

<style>
  .key {
    height: auto;
    padding: 0;
    background: none;
    border-color: transparent;
  }
  .hint {
    color: var(--muted);
    font-size: var(--fs-small);
  }
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
