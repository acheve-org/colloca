<script lang="ts">
  import { tick } from 'svelte';
  import { dismiss } from './dismiss';

  interface Item {
    label: string;
    onclick: () => void;
    danger?: boolean;
  }
  let { label, items, disabled = false }: { label: string; items: Item[]; disabled?: boolean } = $props();

  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let menu = $state<HTMLElement | null>(null);

  const buttons = () => Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  async function toggle(): Promise<void> {
    open = !open;
    if (!open) return;
    await tick();
    buttons()[0]?.focus();
  }

  function choose(item: Item): void {
    open = false;
    item.onclick();
  }

  function onkeydown(e: KeyboardEvent): void {
    const all = buttons();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    all[(to + all.length) % all.length]?.focus();
  }
</script>

<div class="am">
  <button
    type="button"
    class="more"
    aria-label={label}
    aria-haspopup="menu"
    aria-expanded={open}
    {disabled}
    bind:this={trigger}
    onclick={toggle}>⋯</button
  >
  {#if open}
    <div class="pop" role="menu" aria-label={label} tabindex="-1" bind:this={menu} {onkeydown} use:dismiss={{ close: () => (open = false), trigger }}>
      {#each items as item, i (i)}
        <button type="button" role="menuitem" class="item" class:danger={item.danger} onclick={() => choose(item)}>{item.label}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .am {
    position: relative;
    flex: none;
  }
  .more {
    padding: 0 var(--s-2);
    font-size: var(--fs-h2);
    line-height: 1;
  }
  .pop {
    position: absolute;
    right: 0; /* the button sits at the card's edge: open leftwards so the menu never leaves the screen */
    top: calc(100% + var(--s-1));
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-width: 12rem;
    max-width: calc(100vw - var(--s-3) * 2);
    padding: var(--s-1) 0;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
  }
  .item {
    width: 100%;
    height: auto;
    min-height: var(--row-h);
    box-sizing: border-box;
    padding: var(--s-1) var(--s-3);
    color: var(--fg);
    text-align: left;
    background: none;
    border: 0;
    border-radius: 0;
    font: inherit;
    overflow-wrap: anywhere;
    cursor: pointer;
  }
  .item:hover,
  .item:focus-visible {
    background: var(--surface);
  }
  .item.danger {
    color: var(--danger);
  }
</style>
