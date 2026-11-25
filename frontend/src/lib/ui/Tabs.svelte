<script lang="ts">
  import { tick } from 'svelte';

  interface TabItem {
    id: string;
    label: string;
  }
  interface Props {
    label: string;
    tabs: readonly TabItem[];
    value: string;
    /** Prefix of the tab and panel ids, so the pair can point at each other. */
    idBase: string;
    onselect: (id: string) => void;
  }
  let { label, tabs, value, idBase, onselect }: Props = $props();

  let list: HTMLElement | undefined = $state();

  async function onkey(e: KeyboardEvent, i: number) {
    const last = tabs.length - 1;
    const to =
      e.key === 'ArrowRight' ? (i === last ? 0 : i + 1)
      : e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : -1;
    if (to < 0) return;
    e.preventDefault();
    onselect(tabs[to].id);
    await tick();
    list?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  }
</script>

<div class="tabs" role="tablist" aria-label={label} bind:this={list}>
  {#each tabs as tab, i (tab.id)}
    <button
      type="button"
      role="tab"
      id="{idBase}-tab-{tab.id}"
      class="tab"
      class:active={tab.id === value}
      aria-selected={tab.id === value}
      aria-controls="{idBase}-panel"
      tabindex={tab.id === value ? 0 : -1}
      onclick={() => onselect(tab.id)}
      onkeydown={(e) => onkey(e, i)}>{tab.label}</button
    >
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    overflow-x: auto;
    border-bottom: 1px solid var(--line);
  }
  .tab {
    flex: none;
    padding: var(--s-2) var(--s-3);
    color: var(--muted);
    white-space: nowrap;
    background: none;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    font: inherit;
    height: auto;
    cursor: pointer;
  }
  .tab:hover:not(:disabled) {
    color: var(--fg);
  }
  .tab.active {
    color: var(--fg);
    font-weight: 600;
    border-bottom-color: var(--accent);
  }
</style>
