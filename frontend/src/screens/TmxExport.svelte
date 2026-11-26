<script lang="ts">
  import { get, withQuery } from '../lib/api';
  import { corpusStore } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import Button from '../lib/ui/Button.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';

  interface Partner {
    id: number;
    name: string;
    lang: string;
    docs: number;
  }

  // card: the card itself. button: an "Export TMX" button opening the form in a dialog. Whatever the mode,
  // it exists only while there are partners.
  let { mode = 'card' }: { mode?: 'card' | 'button' } = $props();
  const uid = $props.id();
  let partners = $state.raw<Partner[]>([]);
  let choice = $state('');
  let markup = $state(true);
  let open = $state(false);

  // No partners, no button: a dialog left open would come back open with the next partners.
  function setPartners(rows: Partner[]): void {
    partners = rows;
    if (!rows.length) open = false;
  }

  // The corpora that hold the translations of this corpus's aligned documents (none: the card is not shown).
  $effect(() => {
    const id = corpusStore.currentId;
    void corpusStore.aligned;
    if (id === null || !corpusStore.aligned) {
      setPartners([]);
      return;
    }
    get<Partner[]>(`/api/corpora/${id}/aligned-partners`)
      .then((rows) => {
        if (corpusStore.currentId !== id) return;
        setPartners(rows);
        if (!rows.some((p) => String(p.id) === choice)) choice = rows[0] ? String(rows[0].id) : '';
      })
      .catch(() => setPartners([]));
  });

  const options = $derived(partners.map((p) => ({ value: String(p.id), label: `${p.name} [${p.lang}]` })));
  const href = $derived(
    corpusStore.currentId === null || !choice
      ? ''
      : withQuery(`/api/corpora/${corpusStore.currentId}/export-tmx`, { partner_corpus_id: choice, markup }),
  );
</script>

{#snippet form()}
  {#if partners.length > 1}
    <Field label={t('tmx.partner')}>
      <Select label={t('tmx.partner')} bind:value={choice} {options} />
    </Field>
  {/if}
  <Toggle bind:checked={markup} label={t('tmx.markup')} />
  <div class="row">
    <span class="hint grow">{t('tmx.hint')}</span>
    <a class="btn-link" {href} download>{t('tmx.go')}</a>
  </div>
{/snippet}

{#snippet card()}
  <section class="card" aria-labelledby="{uid}-tmx">
    <h3 id="{uid}-tmx">{t('tmx.title')}</h3>
    {@render form()}
  </section>
{/snippet}

{#if partners.length}
  {#if mode === 'button'}
    <Button onclick={() => (open = true)}>{t('tmx.export')}</Button>
    <!-- The dialog titles the form, so it goes in without the card's own heading. -->
    <Dialog bind:open title={t('tmx.title')}>
      {@render form()}
      {#snippet footer()}
        <Button onclick={() => (open = false)}>{t('common.close')}</Button>
      {/snippet}
    </Dialog>
  {:else}
    {@render card()}
  {/if}
{/if}

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--panel);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .grow {
    flex: 1;
  }
  .hint {
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .btn-link {
    padding: 0 var(--s-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    line-height: calc(var(--row-h) - var(--s-1));
    text-decoration: none;
    white-space: nowrap;
  }
</style>
