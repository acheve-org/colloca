<script lang="ts">
  import type { Snippet } from 'svelte';
  import { corpusStore } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import Button from '../lib/ui/Button.svelte';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import Toolbar from '../lib/ui/Toolbar.svelte';

  /**
   * The frame every explore screen shares: no-corpus state, the toolbar form (submit runs),
   * the CSV link and the document filter. `children` is the screen body.
   */
  interface Props {
    label: string;
    runLabel: string;
    onrun: () => void;
    csvHref?: string;
    fields: Snippet;
    /** Extra toolbar buttons after the run button. */
    extra?: Snippet;
    children: Snippet;
  }
  let { label, runLabel, onrun, csvHref = '', fields, extra, children }: Props = $props();

  function onsubmit(e: SubmitEvent): void {
    e.preventDefault();
    onrun();
  }
</script>

<div class="ex">
  {#if corpusStore.currentId === null}
    {#if corpusStore.loaded}<EmptyState title={t('corpus.selectFirst')} />{/if}
  {:else}
    <form class="form" {onsubmit}>
      <Toolbar {label}>
        {@render fields()}
        <div class="actions">
          <Button type="submit" variant="primary">{runLabel}</Button>
          {@render extra?.()}
          {#if csvHref}<a class="csv" href={csvHref} download>{t('cc.csv')}</a>{/if}
        </div>
      </Toolbar>
    </form>
    {@render children()}
  {/if}
</div>

<style>
  .ex {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .form {
    display: contents;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .csv {
    font-size: var(--fs-small);
  }
  /* shared toolbar bits of the screens */
  .ex :global(.switch) {
    align-self: center;
    margin-top: 14px;
  }
  .ex :global(input[type='number']) {
    width: 4.5em;
  }
</style>
