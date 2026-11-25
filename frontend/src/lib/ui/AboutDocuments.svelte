<script lang="ts">
  import { get } from '../api';
  import { draft } from '../addDocuments.svelte';
  import { corpusStore } from '../corpus.svelte';
  import { t } from '../i18n';
  import type { Facets } from '../types';
  import Field from './Field.svelte';
  import Toggle from './Toggle.svelte';

  /** Framed on its own with a title; inside a disclosure the summary line is the title. */
  let { framed = true }: { framed?: boolean } = $props();

  const uid = $props.id();
  let facets = $state.raw<Facets>({ tags: [], text_types: [], date_min: '', date_max: '' });
  // Suggestions from the tags and types already in the corpus; optional, so a failure is ignored.
  $effect(() => {
    const id = corpusStore.currentId;
    facets = { tags: [], text_types: [], date_min: '', date_max: '' };
    if (id === null) return;
    get<Facets>(`/api/corpora/${id}/facets`)
      .then((f) => {
        if (corpusStore.currentId === id) facets = f;
      })
      .catch(() => {});
  });
</script>

<section class="about" class:framed aria-label={framed ? undefined : t('add.about')} aria-labelledby={framed ? 'add-about' : undefined}>
  {#if framed}<h2 id="add-about">{t('add.about')}</h2>{/if}
  <p class="lead">{t('add.aboutLead')}</p>
  <Field label={t('src.meta.tags')}>
    <input bind:value={draft.meta.tags} list="{uid}-tags" placeholder={t('src.meta.tagsPlaceholder')} />
  </Field>
  <Field label={t('src.meta.type')}>
    <input bind:value={draft.meta.text_type} list="{uid}-types" placeholder={t('src.meta.typePlaceholder')} />
  </Field>
  <Field label={t('src.meta.date')}>
    <input bind:value={draft.meta.doc_date} placeholder={t('src.meta.datePlaceholder')} />
  </Field>
  <Field label={t('src.meta.author')}>
    <input bind:value={draft.meta.author} />
  </Field>
  <Toggle bind:checked={draft.force} label={t('src.force')} />
  <datalist id="{uid}-tags">
    {#each facets.tags as x (x.tag)}<option value={x.tag}>{t('filter.docs', { docs: x.docs })}</option>{/each}
  </datalist>
  <datalist id="{uid}-types">
    {#each facets.text_types as x (x.text_type)}<option value={x.text_type}></option>{/each}
  </datalist>
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
