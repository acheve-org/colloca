<script module lang="ts">
  export { openTerm } from '../lib/term.svelte';
</script>

<script lang="ts">
  import { corpusStore } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import { findExamples, saveTerm, TERM_POS, termStore, useExample } from '../lib/term.svelte';
  import Button from '../lib/ui/Button.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';

  const uid = $props.id();
  const d = $derived(termStore.draft);

  const statusOptions = ['candidate', 'approved', 'admitted', 'superseded', 'forbidden'].map((s) => ({
    value: s,
    label: t(`term.status.${s}`),
  }));
  const posOptions = [{ value: '', label: t('term.pos.none') }, ...TERM_POS.map((p) => ({ value: p, label: p }))];

  const langLine = $derived.by(() => {
    const c = termStore.ctx;
    if (!c) return '';
    const l = termStore.langs;
    const pair = t('term.langs', { src: l[c.src_lang] ?? c.src_lang, tgt: l[c.tgt_lang] ?? (c.tgt_lang || '?') });
    return c.project_id == null && termStore.editingId === null ? `${pair} · ${t('term.general')}` : pair;
  });

  // Examples come from the current corpus: when editing, only if it has the entry's source language.
  const canFind = $derived(
    termStore.editingId === null ||
      (corpusStore.current !== null && corpusStore.current.lang === termStore.ctx?.src_lang),
  );

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!d.src_term.trim()) return;
    await saveTerm();
  }
</script>

<Dialog bind:open={termStore.open} title={t(termStore.editingId === null ? 'term.add' : 'term.edit')}>
  <form id="{uid}-form" class="term" onsubmit={submit}>
    <p class="langs">{langLine}</p>
    <Field label={t('term.source')}>
      <input bind:value={termStore.draft.src_term} required />
    </Field>
    <Field label={t('term.target')}>
      <input bind:value={termStore.draft.tgt_term} placeholder={t('term.targetPlaceholder')} />
    </Field>
    <div class="row">
      <Field label={t('term.status')}>
        <Select label={t('term.status')} bind:value={termStore.draft.status} options={statusOptions} />
      </Field>
      <Field label={t('term.pos')}>
        <Select label={t('term.pos')} bind:value={termStore.draft.pos} options={posOptions} />
      </Field>
      <Field label={t('term.domain')}>
        <input bind:value={termStore.draft.domain} size="14" list="{uid}-domains" />
        <datalist id="{uid}-domains">
          {#each termStore.domains as d (d)}<option value={d}></option>{/each}
        </datalist>
      </Field>
    </div>
    <Field label={t('term.definition')}>
      <textarea bind:value={termStore.draft.definition} rows="2"></textarea>
    </Field>
    <Field label={t('term.notes')}>
      <textarea bind:value={termStore.draft.notes} rows="2"></textarea>
    </Field>
    <Field label={t('term.example')}>
      <textarea bind:value={termStore.draft.context} rows="3"></textarea>
    </Field>
    <Field label={t('term.exampleSource')}>
      <input bind:value={termStore.draft.context_source} />
    </Field>
    {#if canFind}
    <div class="examples">
      <Button onclick={() => findExamples(false)}>{t('term.findExamples')}</Button>
      {#if termStore.examples.length}
        <ul>
          {#each termStore.examples as x, i (i)}
            <li>
              <button type="button" class="example" title={t('term.useExample')} onclick={() => useExample(x)}>
                {x.sentence} <span class="doc">— {x.doc}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else if termStore.examplesFor}
        <p class="none">{t('term.noExamples', { q: termStore.examplesFor })}</p>
      {/if}
    </div>
    {/if}
  </form>
  {#snippet footer()}
    <Button onclick={() => (termStore.open = false)}>{t('common.cancel')}</Button>
    <button
      type="submit"
      form="{uid}-form"
      class="primary"
      disabled={!d.src_term.trim() || termStore.saving}>{t('common.save')}</button
    >
  {/snippet}
</Dialog>

<style>
  .term {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .term :global(.field) {
    display: flex;
  }
  .term :global(.field > input),
  .term :global(.field > textarea) {
    width: 100%;
  }
  .langs {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .row :global(.field) {
    flex: 1;
  }
  .examples {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-1);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    width: 100%;
  }
  .example {
    display: block;
    width: 100%;
    height: auto;
    padding: var(--s-1) var(--s-2);
    text-align: left;
    background: var(--bg);
    border-color: transparent;
    white-space: normal;
  }
  .example:hover {
    background: var(--surface);
  }
  .doc,
  .none {
    color: var(--muted);
  }
  .none {
    margin: 0;
    font-size: var(--fs-small);
  }
</style>
