<script lang="ts">
  import { get, withQuery } from '../lib/api';
  import { corpusStore } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';

  interface Partner {
    id: number;
    name: string;
    lang: string;
    docs: number;
  }

  // disclosure: wrap the card in a collapsed <details> that exists only while there are partners.
  let { disclosure = false }: { disclosure?: boolean } = $props();
  const uid = $props.id();
  let partners = $state.raw<Partner[]>([]);
  let choice = $state('');
  let markup = $state(true);

  // The corpora that hold the translations of this corpus's aligned documents (none: the card is not shown).
  $effect(() => {
    const id = corpusStore.currentId;
    void corpusStore.aligned;
    if (id === null || !corpusStore.aligned) {
      partners = [];
      return;
    }
    get<Partner[]>(`/api/corpora/${id}/aligned-partners`)
      .then((rows) => {
        if (corpusStore.currentId !== id) return;
        partners = rows;
        if (!rows.some((p) => String(p.id) === choice)) choice = rows[0] ? String(rows[0].id) : '';
      })
      .catch(() => (partners = []));
  });

  const options = $derived(partners.map((p) => ({ value: String(p.id), label: `${p.name} [${p.lang}]` })));
  const href = $derived(
    corpusStore.currentId === null || !choice
      ? ''
      : withQuery(`/api/corpora/${corpusStore.currentId}/export-tmx`, { partner_corpus_id: choice, markup }),
  );
</script>

{#snippet card()}
  <section class="card" aria-labelledby="{uid}-tmx">
    <h3 id="{uid}-tmx">{t('tmx.title')}</h3>
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
  </section>
{/snippet}

{#if partners.length}
  {#if disclosure}
    <details class="disc tmx">
      <summary>{t('tmx.title')}</summary>
      <div class="inner">{@render card()}</div>
    </details>
  {:else}
    {@render card()}
  {/if}
{/if}

<style>
  .disc {
    flex: none;
    padding: var(--s-1) var(--s-3);
    border-top: 1px solid var(--line);
    font-size: var(--fs-small);
  }
  .disc summary {
    cursor: pointer;
    font-weight: 600;
  }
  .inner {
    padding: var(--s-2) 0;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
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
