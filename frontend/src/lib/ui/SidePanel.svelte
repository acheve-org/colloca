<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n';
  import Button from './Button.svelte';

  interface Props {
    open: boolean;
    title: string;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
  }
  let { open = $bindable(), title, onclose, children, footer }: Props = $props();

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  let body: HTMLElement | undefined = $state();
  let heading: HTMLElement | undefined = $state();
  let opener: HTMLElement | null = null;
  const uid = $props.id();

  // Runs once per opening, when the panel mounts: remember who opened it and focus inside.
  $effect(() => {
    if (!body) return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = body.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? heading)?.focus();
  });

  function close(): void {
    open = false;
    onclose?.();
    if (opener?.isConnected) opener.focus();
    opener = null;
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Esc anywhere inside closes the panel) -->
  <aside aria-labelledby="{uid}-t" {onkeydown}>
    <header>
      <h3 id="{uid}-t" tabindex="-1" bind:this={heading}>{title}</h3>
      <Button ariaLabel={t('common.close')} onclick={close}>×</Button>
    </header>
    <div class="body" bind:this={body}>{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </aside>
{/if}

<style>
  /* The parent is a position: relative flex row. Phone: the panel covers the page. */
  aside {
    position: fixed;
    inset: 0;
    z-index: 30; /* above the page and its popovers (menus use 10–20) */
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-4);
    color: var(--fg);
    background: var(--panel);
    overflow-y: auto;
    overflow-wrap: anywhere;
  }
  /* Tablet: floats over the right edge of the content; the page behind stays clickable. */
  @media (min-width: 640px) {
    aside {
      position: absolute;
      inset: 0 0 0 auto;
      width: 320px;
      box-shadow: var(--shadow-pop);
    }
  }
  /* Wide: sits beside the content. */
  @media (min-width: 1280px) {
    aside {
      position: static;
      flex: none;
      z-index: auto;
      box-shadow: none;
      border-left: 1px solid var(--line);
    }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
  }
  h3 {
    margin: 0;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-2);
  }
</style>
