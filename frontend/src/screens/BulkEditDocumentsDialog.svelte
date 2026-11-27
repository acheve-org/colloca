<script lang="ts">
  import { patch } from '../lib/api';
  import { act, still, work } from '../lib/addDocuments.svelte';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import type { Facets } from '../lib/types';
  import Button from '../lib/ui/Button.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Field from '../lib/ui/Field.svelte';

  type SetField = 'text_type' | 'doc_date' | 'author';

  interface Props {
    open: boolean;
    /** The ids of the documents to change. */
    ids: number[];
    /** The corpus tags and text types, suggested in the form. */
    facets: Facets;
    /** After a successful save, to reload the list. */
    onsaved: () => void;
  }
  let { open = $bindable(), ids, facets, onsaved }: Props = $props();

  const uid = $props.id();
  const blank = () => ({
    add_tags: '',
    remove_tags: '',
    text_type: '',
    doc_date: '',
    author: '',
    change: { text_type: false, doc_date: false, author: false } as Record<SetField, boolean>,
  });
  let form = $state(blank());

  // Each opening starts from an empty form: nothing changes unless asked for.
  $effect(() => {
    if (open) form = blank();
  });

  const fields = $derived<{ key: SetField; label: string; placeholder: string; list?: string }[]>([
    { key: 'text_type', label: t('src.edit.type'), placeholder: t('src.edit.typePlaceholder'), list: `${uid}-types` },
    { key: 'doc_date', label: t('src.col.date'), placeholder: t('src.edit.datePlaceholder') },
    { key: 'author', label: t('src.meta.author'), placeholder: '' },
  ]);

  const changes = $derived.by(() => {
    const out: Record<string, string> = {};
    if (form.add_tags.trim()) out.add_tags = form.add_tags;
    if (form.remove_tags.trim()) out.remove_tags = form.remove_tags;
    for (const f of ['text_type', 'doc_date', 'author'] as SetField[]) if (form.change[f]) out[f] = form[f];
    return out;
  });
  const hasChanges = $derived(Object.keys(changes).length > 0);

  async function save(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!ids.length || !hasChanges) return;
    const body = { ids: [...ids], ...changes };
    await act('edit', async (id) => {
      const res = await patch<{ updated: number }>('/api/documents', body);
      if (!still(id)) return;
      open = false;
      messages.say(t('src.bulkUpdated', { n: res.updated }), 'ok');
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

<Dialog bind:open title={t('src.bulkEditTitle', { n: ids.length })}>
  {#if open}
    <form id="{uid}-bulk" class="dlg-form" onsubmit={save}>
      <p class="hint">{t('src.bulkEditHint')}</p>
      <Field label={t('src.bulk.addTags')}>
        <input bind:value={form.add_tags} list="{uid}-tags" placeholder={t('src.edit.tagsPlaceholder')} />
      </Field>
      <Field label={t('src.bulk.removeTags')}>
        <input bind:value={form.remove_tags} list="{uid}-tags" placeholder={t('src.edit.tagsPlaceholder')} />
      </Field>
      {#each fields as f (f.key)}
        <div class="set">
          <label class="tick">
            <input type="checkbox" bind:checked={form.change[f.key]} />
            {t('src.bulk.set', { field: f.label })}
          </label>
          <input
            bind:value={form[f.key]}
            list={f.list}
            placeholder={form.change[f.key] ? t('src.bulk.emptyClears') : f.placeholder}
            aria-label={f.label}
            disabled={!form.change[f.key]}
          />
        </div>
      {/each}
    </form>
  {/if}
  {#snippet footer()}
    <Button onclick={() => (open = false)}>{t('common.cancel')}</Button>
    <button type="submit" form="{uid}-bulk" class="primary" disabled={!hasChanges || work.busy !== null}>
      {t('src.bulkApply', { n: ids.length })}
    </button>
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
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .set {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--fs-small);
  }
  .tick {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    color: var(--muted);
    font-weight: 600;
  }
</style>
