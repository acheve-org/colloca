<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n';
  import { viewport } from '../viewport.svelte';
  import Button from './Button.svelte';

  interface Props {
    /** Names the list column's navigation landmark. */
    label: string;
    /** Stacked layouts only: show the panel (with a Back button) instead of the list. */
    showPanel: boolean;
    onback: () => void;
    list: Snippet;
    panel: Snippet;
  }
  let { label, showPanel, onback, list, panel }: Props = $props();
</script>

<!-- Wide: list left, panel right. Stacked: one or the other. -->
<div class="listpanel" class:stacked={viewport.stacked}>
  {#if !viewport.stacked || !showPanel}
    <nav aria-label={label}>{@render list()}</nav>
  {/if}
  {#if !viewport.stacked || showPanel}
    <div class="panel">
      {#if viewport.stacked}
        <div class="backrow">
          <Button onclick={onback}><span aria-hidden="true">←</span> {t('common.back')}</Button>
        </div>
      {/if}
      {@render panel()}
    </div>
  {/if}
</div>

<style>
  /* Fills <main> (a flex column); each column scrolls on its own. */
  .listpanel {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr);
  }
  .listpanel.stacked {
    grid-template-columns: minmax(0, 1fr);
  }
  nav {
    min-height: 0;
    overflow-y: auto;
    background: var(--bg);
    border-right: 1px solid var(--line);
  }
  .stacked nav {
    border-right: none;
  }
  .panel {
    position: relative;
    min-height: 0;
    overflow-y: auto;
  }
  .backrow {
    padding: var(--s-2) var(--s-3) 0;
  }
</style>
