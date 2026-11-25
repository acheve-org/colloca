<script lang="ts">
  import { draft } from '../addDocuments.svelte';
  import { t } from '../i18n';
  import Field from './Field.svelte';
  import Toggle from './Toggle.svelte';

  /** Framed on its own with a title; inside a disclosure the summary line is the title. */
  let { framed = true }: { framed?: boolean } = $props();
</script>

<section class="about" class:framed aria-label={framed ? undefined : t('add.about')} aria-labelledby={framed ? 'add-about' : undefined}>
  {#if framed}<h2 id="add-about">{t('add.about')}</h2>{/if}
  <p class="lead">{t('add.aboutLead')}</p>
  <Field label={t('src.meta.tags')}>
    <input bind:value={draft.meta.tags} placeholder={t('src.meta.tagsPlaceholder')} />
  </Field>
  <Field label={t('src.meta.type')}>
    <input bind:value={draft.meta.text_type} placeholder={t('src.meta.typePlaceholder')} />
  </Field>
  <Field label={t('src.meta.date')}>
    <input bind:value={draft.meta.doc_date} placeholder={t('src.meta.datePlaceholder')} />
  </Field>
  <Field label={t('src.meta.author')}>
    <input bind:value={draft.meta.author} />
  </Field>
  <Toggle bind:checked={draft.force} label={t('src.force')} />
</section>

<style>
  .about {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--s-2);
  }
  .framed {
    padding: var(--s-3);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  h2 {
    margin: 0;
  }
  .lead {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-small);
  }
</style>
