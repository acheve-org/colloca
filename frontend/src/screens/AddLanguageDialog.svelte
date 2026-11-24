<script lang="ts">
  import { post } from '../lib/api';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import type { CatalogEntry } from '../lib/types';
  import Button from '../lib/ui/Button.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';

  interface Props {
    open: boolean;
    catalog: CatalogEntry[];
    onadded: () => void;
  }
  let { open = $bindable(), catalog, onadded }: Props = $props();

  const uid = $props.id();
  let query = $state('');
  let code = $state('');
  let size = $state('md');
  let installModel = $state(true);
  let installOcr = $state(true);
  let busy = $state(false);

  const available = $derived(catalog.filter((e) => !e.added));
  const shown = $derived(available.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase())));
  const chosen = $derived(available.find((e) => e.code === code) ?? null);
  const sizes = $derived(chosen?.sizes ?? ['sm', 'md', 'lg']);

  $effect(() => {
    if (open) {
      query = '';
      code = '';
      size = 'md';
      installModel = true;
      installOcr = true;
    }
  });

  async function add(): Promise<void> {
    if (!chosen || busy) return;
    busy = true;
    try {
      await post('/api/languages', { code: chosen.code, size, install_model: installModel, install_ocr: installOcr });
      messages.say(t('lang.added', { name: chosen.name }), 'ok');
      open = false;
      onadded();
    } catch (err) {
      messages.say(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title={t('lang.addTitle')}>
  <div class="form">
    {#if available.length === 0}
      <p>{t('lang.noneLeft')}</p>
    {:else}
      <input type="search" aria-label={t('lang.search')} placeholder={t('lang.search')} bind:value={query} />
      <fieldset>
        <legend>{t('lang.pick')}</legend>
        <div class="list">
          {#each shown as e (e.code)}
            <label><input type="radio" name="{uid}-lang" value={e.code} bind:group={code} />{e.name}</label>
          {/each}
        </div>
      </fieldset>
      <Field label={t('lang.size')}>
        <select bind:value={size}>
          {#each sizes as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      </Field>
      <Toggle bind:checked={installModel} label={t('lang.installModel')} />
      <Toggle bind:checked={installOcr} label={t('lang.installOcr')} />
      <p class="note">{t('lang.downloadNote')}</p>
    {/if}
  </div>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>{t('common.cancel')}</Button>
    <Button variant="primary" disabled={!chosen || busy} onclick={add}>{t('lang.addAction')}</Button>
  {/snippet}
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  fieldset {
    margin: 0;
    padding: var(--s-1) var(--s-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: var(--s-1);
    max-height: 14rem;
    overflow: auto;
  }
  .list label {
    display: flex;
    align-items: center;
    gap: var(--s-1);
  }
  .note {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-small);
  }
</style>
