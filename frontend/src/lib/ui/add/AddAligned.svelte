<script module lang="ts">
  const PAIRS_ACCEPT = '.tmx,.xlf,.xliff,.tsv,.csv,.docx';
  const SUBS = ['tm', 'two'] as const;
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from '../../api';
  import { draft } from '../../addDocuments.svelte';
  import { corpusStore } from '../../corpus.svelte';
  import { t } from '../../i18n';
  import { go, route } from '../../router.svelte';
  import type { Languages } from '../../types';
  import AlignDocuments from '../../../screens/AlignDocuments.svelte';
  import Field from '../Field.svelte';
  import Select from '../Select.svelte';
  import Toggle from '../Toggle.svelte';

  const sub = $derived(SUBS.find((x) => x === route.params.sub) ?? 'tm');

  let pairInput: HTMLInputElement | undefined = $state();
  const otherLangs = $derived(draft.otherLangs);
  $effect(() => {
    if (!otherLangs.includes(draft.pairLang)) draft.pairLang = otherLangs[0] ?? '';
  });

  const partnerOptions = $derived.by(() => {
    const cur = corpusStore.current;
    const others = cur ? corpusStore.list.filter((c) => c.id !== cur.id && c.lang !== cur.lang) : [];
    return [
      ...others.map((c) => ({ value: String(c.id), label: `${c.name} [${c.lang}]` })),
      { value: 'new', label: t('src.pair.newCorpus') },
    ];
  });
  // The `new` option is always present, so partnerOptions[0] exists.
  // Like the old select (re-rendered after every reload): the first option until one is picked.
  $effect(() => {
    if (!draft.partnerPicked || !partnerOptions.some((o) => o.value === draft.partner)) draft.partner = partnerOptions[0].value;
  });

  onMount(() => {
    const offPair = draft.onClear('pair', () => pairInput && (pairInput.value = ''));
    get<Languages>('/api/languages')
      .then((l) => (draft.langs = l))
      .catch(() => {}); // without the list the server picks the only other language, as before
    return offPair;
  });
</script>

<div class="aligned">
  <div class="chips" role="group" aria-label={t('add.al.group')}>
    {#each SUBS as id (id)}
      <button type="button" class="chip" aria-pressed={sub === id} onclick={() => go('sources-add', { m: 'al', sub: id })}>
        {t(`add.al.${id}`)}
      </button>
    {/each}
  </div>

  {#if sub === 'tm'}
    <input
      bind:this={pairInput}
      type="file"
      accept={PAIRS_ACCEPT}
      aria-label={t('src.pair.file')}
      onchange={(e) => (draft.pairFile = e.currentTarget.files?.[0] ?? null)}
    />
    {#if draft.pairFile}<span class="chosen">{draft.pairFile.name}</span>{/if}
    <Field label={t('src.pair.partner')}>
      <Select label={t('src.pair.partner')} bind:value={draft.partner} options={partnerOptions} onchange={() => (draft.partnerPicked = true)} />
    </Field>
    {#if draft.partner === 'new'}
      <input bind:value={draft.pairName} maxlength="120" placeholder={t('src.pair.namePlaceholder')} aria-label={t('src.pair.name')} />
      {#if otherLangs.length > 1}
        <Select label={t('src.pair.lang')} bind:value={draft.pairLang} options={otherLangs.map((l) => ({ value: l, label: draft.langs[l] }))} />
      {/if}
    {/if}
    <Toggle bind:checked={draft.swap} label={t('src.pair.swap')} />
    <p class="hint">{t('src.pair.hint')}</p>
  {:else}
    <AlignDocuments />
  {/if}
</div>

<style>
  .aligned {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding-top: var(--s-1);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .chip {
    padding: 0 var(--s-2);
    background: var(--panel);
    color: var(--fg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    font: inherit;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }
  .aligned :global(.field) {
    display: flex;
  }
  input[type='file'] {
    height: auto;
    padding: var(--s-1);
    max-width: 100%;
  }
  .chosen {
    font-size: var(--fs-small);
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .hint {
    margin: var(--s-1) 0 0;
    color: var(--muted);
    font-size: var(--fs-small);
  }
</style>
