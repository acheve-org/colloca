<script lang="ts">
  import { onMount } from 'svelte';
  import { del, get, post } from '../api';
  import { corpusStore } from '../corpus.svelte';
  import { t } from '../i18n';
  import { messages } from '../messages.svelte';
  import type { Languages } from '../types';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import Field from './Field.svelte';
  import Select from './Select.svelte';

  let languages = $state<Languages>({});
  let newOpen = $state(false);
  let delOpen = $state(false);
  let name = $state('');
  let lang = $state('');

  onMount(async () => {
    try {
      languages = await get<Languages>('/api/languages');
      lang = Object.keys(languages)[0] ?? '';
    } catch (err) {
      messages.say(err instanceof Error ? err.message : String(err), 'err');
    }
  });

  const options = $derived(
    corpusStore.list.map((c) => ({ value: String(c.id), label: c.name })),
  );
  const langOptions = $derived(
    Object.entries(languages).map(([value, label]) => ({ value, label })),
  );
  const current = $derived(corpusStore.current);
  const canCreate = $derived(name.trim() !== '' && lang !== '');
  // The API does not report the spaCy model name yet: show the language only.
  const meta = $derived(
    current
      ? t('corpus.meta', { lang: languages[current.lang] ?? current.lang, docs: current.docs })
      : '',
  );

  async function create(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!canCreate) return;
    try {
      const { id } = await post<{ id: number }>('/api/corpora', { name: name.trim(), lang });
      newOpen = false;
      name = '';
      await corpusStore.reload();
      await corpusStore.select(id);
    } catch (err) {
      messages.say(err instanceof Error ? err.message : String(err), 'err');
    }
  }

  async function remove(): Promise<void> {
    if (!current) return;
    try {
      await del(`/api/corpora/${current.id}`);
      delOpen = false;
      await corpusStore.reload();
    } catch (err) {
      messages.say(err instanceof Error ? err.message : String(err), 'err');
    }
  }
</script>

<div class="switcher">
  {#if options.length}
    <Select
      label={t('corpus.switcher')}
      value={String(corpusStore.currentId ?? '')}
      {options}
      onchange={(v) => corpusStore.select(Number(v))}
    />
    <div class="meta">{meta}</div>
  {:else}
    <div class="meta">{t('corpus.none')}</div>
  {/if}
  <div class="actions">
    <Button onclick={() => (newOpen = true)}>{t('corpus.new')}</Button>
    <Button variant="danger" disabled={!current} onclick={() => (delOpen = true)}>{t('common.delete')}</Button>
  </div>
</div>

<Dialog bind:open={newOpen} title={t('corpus.new')}>
  <form id="new-corpus" onsubmit={create}>
    <Field label={t('corpus.name')}>
      <input bind:value={name} required maxlength="120" />
    </Field>
    <Field label={t('corpus.language')}>
      <Select label={t('corpus.language')} bind:value={lang} options={langOptions} />
    </Field>
  </form>
  {#snippet footer()}
    <Button onclick={() => (newOpen = false)}>{t('common.cancel')}</Button>
    <button type="submit" form="new-corpus" class="primary" disabled={!canCreate}>{t('corpus.create')}</button>
  {/snippet}
</Dialog>

<Dialog bind:open={delOpen} title={t('corpus.delete')}>
  <p>{t('corpus.confirmDelete', { name: current?.name ?? '' })}</p>
  {#snippet footer()}
    <Button onclick={() => (delOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={remove}>{t('common.delete')}</Button>
  {/snippet}
</Dialog>

<style>
  .switcher {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: 0 var(--s-3) var(--s-2);
  }
  .switcher :global(select) {
    width: 100%;
    color: var(--rail-fg);
    background: var(--rail-hover);
    border-color: var(--rail-hover);
  }
  .meta {
    color: var(--rail-muted);
    font-size: var(--fs-small);
  }
  .actions {
    display: flex;
    gap: var(--s-1);
  }
  .actions :global(button) {
    flex: 1;
    padding: 0 var(--s-1);
    color: var(--rail-fg);
    background: transparent;
    border-color: var(--rail-hover);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
</style>
