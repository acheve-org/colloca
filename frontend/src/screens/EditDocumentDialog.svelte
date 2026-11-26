<script lang="ts">
  import { untrack } from 'svelte';
  import { patch } from '../lib/api';
  import { act, still, work, type Meta } from '../lib/addDocuments.svelte';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import type { Doc, Facets } from '../lib/types';
  import Button from '../lib/ui/Button.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Field from '../lib/ui/Field.svelte';

  type EditForm = Meta & { title: string };

  interface Props {
    open: boolean;
    doc: Doc | null;
    /** The corpus tags and text types, suggested in the form. */
    facets: Facets;
    /** After a successful save, to reload the list. */
    onsaved: () => void;
  }
  let { open = $bindable(), doc, facets, onsaved }: Props = $props();

  const uid = $props.id();
  const formOf = (d: Doc): EditForm => ({ title: d.title, tags: d.tags.join(', '), text_type: d.text_type, doc_date: d.doc_date, author: d.author });

  let form = $state<EditForm>({ title: '', tags: '', text_type: '', doc_date: '', author: '' });

  // Each opening starts from the document as it is.
  $effect(() => {
    if (open && doc) {
      const d = doc;
      untrack(() => (form = formOf(d)));
    }
  });

  async function save(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const d = doc;
    if (!d || !form.title.trim()) return;
    const before = formOf(d);
    const changed = Object.fromEntries(
      (Object.keys(before) as (keyof EditForm)[]).filter((k) => form[k] !== before[k]).map((k) => [k, form[k]]),
    );
    if (!Object.keys(changed).length) {
      open = false;
      return;
    }
    await act('edit', async (id) => {
      await patch(`/api/documents/${d.id}`, changed);
      if (!still(id)) return;
      open = false;
      messages.say(t('src.docUpdated'), 'ok');
      onsaved();
    });
  }
</script>

<datalist id="{uid}-tags">
  {#each facets.tags as x (x.tag)}<option value={x.tag}>{t('filter.docs', { docs: x.docs })}</option>{/each}
</datalist>
<datalist id="{uid}-types">
  {#each facets.text_types as x (x.text_type)}<option value={x.text_type}></option>{/each}
</datalist>

<Dialog bind:open title={t('src.editTitle')}>
  {#if open}
    <form id="{uid}-edit" class="dlg-form" onsubmit={save}>
      <Field label={t('src.col.title')}><input bind:value={form.title} required maxlength="300" /></Field>
      <Field label={t('src.meta.tags')}>
        <input bind:value={form.tags} list="{uid}-tags" placeholder={t('src.edit.tagsPlaceholder')} />
      </Field>
      <Field label={t('src.edit.type')}>
        <input bind:value={form.text_type} list="{uid}-types" placeholder={t('src.edit.typePlaceholder')} />
      </Field>
      <Field label={t('src.col.date')}>
        <input bind:value={form.doc_date} placeholder={t('src.edit.datePlaceholder')} size="12" />
      </Field>
      <Field label={t('src.meta.author')}><input bind:value={form.author} /></Field>
    </form>
  {/if}
  {#snippet footer()}
    <Button onclick={() => (open = false)}>{t('common.cancel')}</Button>
    <button type="submit" form="{uid}-edit" class="primary" disabled={!form.title.trim() || work.busy !== null}>{t('common.save')}</button>
  {/snippet}
</Dialog>

<style>
  .dlg-form {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .dlg-form :global(.field) {
    display: flex;
  }
</style>
