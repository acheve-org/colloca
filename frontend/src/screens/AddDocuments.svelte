<script lang="ts">
  import { onMount } from 'svelte';
  import {
    actionFor, addPaste, addPreview, addUrlList, draft, importSelected, metaSummary, resetDraft, uploadFiles, uploadPairs, work,
    type Method,
  } from '../lib/addDocuments.svelte';
  import { corpusStore } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import { go, route } from '../lib/router.svelte';
  import AddAligned from '../lib/ui/add/AddAligned.svelte';
  import AddFromWeb from '../lib/ui/add/AddFromWeb.svelte';
  import AddPaste from '../lib/ui/add/AddPaste.svelte';
  import AddUpload from '../lib/ui/add/AddUpload.svelte';
  import AboutDocuments from '../lib/ui/AboutDocuments.svelte';
  import ActionBar from '../lib/ui/ActionBar.svelte';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import Tabs from '../lib/ui/Tabs.svelte';

  const METHODS: readonly Method[] = ['web', 'up', 'paste', 'al'];
  const SUBS: Record<Method, readonly string[]> = { web: ['one', 'list', 'index'], up: [], paste: [], al: ['tm', 'two'] };

  const uid = $props.id();
  const m = $derived<Method>(METHODS.find((x) => x === route.params.m) ?? 'web');
  const sub = $derived(SUBS[m].find((x) => x === route.params.sub) ?? SUBS[m][0] ?? '');
  const tabs = $derived(METHODS.map((id) => ({ id, label: t(`add.method.${id}`) })));
  const action = $derived(actionFor(m, sub));
  /** Aligning two documents has its own actions and does not use the details. */
  const standalone = $derived(m === 'al' && sub === 'two');
  const hasCorpus = $derived(corpusStore.currentId !== null);

  // One column below this width; the details then sit in a closed block above the form.
  const NARROW = '(max-width: 799px)';
  let narrow = $state(false);
  onMount(() => {
    const mq = window.matchMedia?.(NARROW);
    if (!mq) return;
    narrow = mq.matches;
    const on = (e: MediaQueryListEvent) => (narrow = e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });

  const select = (id: string) => go('sources-add', { m: id });
  function cancel() {
    resetDraft();
    go('sources');
  }
  async function submit() {
    const run =
      m === 'web' ? (sub === 'list' ? addUrlList : sub === 'index' ? importSelected : addPreview)
      : m === 'up' ? (draft.preview?.kind === 'file' ? addPreview : uploadFiles)
      : m === 'paste' ? addPaste
      : sub === 'tm' ? uploadPairs
      : null;
    if (run && (await run())) {
      // The details of the documents and the language override stay for the next batch.
      resetDraft({ keepMeta: true });
      go('sources');
    }
  }
</script>

<div class="page">
  {#if !hasCorpus}
    {#if corpusStore.loaded}<EmptyState title={t('corpus.selectFirst')} />{/if}
  {:else}
    <div class="content">
      <Tabs label={t('add.tabs')} {tabs} value={m} idBase={uid} onselect={select} />
      {#if narrow && !standalone}
        <details class="about-fold">
          <summary>
            <b>{t('add.about')}</b>
            <span class="muted">· {metaSummary() || t('add.noMeta')}</span>
          </summary>
          <AboutDocuments framed={false} />
        </details>
      {/if}
      <div class="grid" class:solo={standalone || narrow}>
        <div class="source" role="tabpanel" id="{uid}-panel" aria-labelledby="{uid}-tab-{m}">
          {#if m === 'web'}
            <div data-method={m} data-sub={sub}><AddFromWeb /></div>
          {:else if m === 'up'}
            <div data-method={m} data-sub={sub}><AddUpload /></div>
          {:else if m === 'paste'}
            <div data-method={m} data-sub={sub}><AddPaste /></div>
          {:else}
            <div data-method={m} data-sub={sub}><AddAligned /></div>
          {/if}
        </div>
        {#if !standalone && !narrow}
          <aside class="side"><AboutDocuments /></aside>
        {/if}
      </div>
    </div>
    {#if !standalone}
      <ActionBar
        summary={action.summary}
        label={action.label}
        enabled={action.enabled}
        busy={work.busy !== null}
        onsubmit={submit}
        oncancel={cancel}
      />
    {/if}
  {/if}
</div>

<style>
  /* Grows with its content: <main> scrolls, and the bar sticks to the bottom of what is visible. */
  .page {
    display: flex;
    flex-direction: column;
    flex: 1 0 auto;
  }
  /* The content pushes the bar down when short; its bottom padding keeps the last field clear of it. */
  .content {
    flex: 1;
    padding: 0 var(--s-3) var(--s-4);
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 270px;
    gap: var(--s-4);
    align-items: start;
    padding-top: var(--s-3);
  }
  .grid.solo {
    grid-template-columns: minmax(0, 1fr);
  }
  .about-fold {
    margin-top: var(--s-3);
    padding: var(--s-2) var(--s-3);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    font-size: var(--fs-small);
  }
  .about-fold summary {
    cursor: pointer;
  }
  .about-fold :global(.about) {
    margin-top: var(--s-2);
  }
  .muted {
    color: var(--muted);
  }
</style>
