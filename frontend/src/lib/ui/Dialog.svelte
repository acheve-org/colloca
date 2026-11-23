<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n';

  interface Props {
    open: boolean;
    title: string;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
  }
  let { open = $bindable(), title, onclose, children, footer }: Props = $props();

  let el: HTMLDialogElement | undefined = $state();
  let opener: HTMLElement | null = null;
  const uid = $props.id();

  $effect(() => {
    if (!el) return;
    if (open && !el.open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  });

  function handleClose(): void {
    open = false;
    opener?.focus();
    opener = null;
    onclose?.();
  }

  // Escape is handled natively: the browser fires `cancel` on the dialog.
  function oncancel(e: Event): void {
    e.preventDefault();
    el?.close();
  }
</script>

<dialog bind:this={el} aria-labelledby="{uid}-t" onclose={handleClose} {oncancel}>
  <header>
    <h2 id="{uid}-t">{title}</h2>
    <button type="button" class="x" aria-label={t('common.close')} onclick={() => el?.close()}>×</button>
  </header>
  <div class="body">{@render children()}</div>
  {#if footer}<footer>{@render footer()}</footer>{/if}
</dialog>

<style>
  dialog {
    min-width: 320px;
    max-width: min(560px, 92vw);
    padding: 0;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-2) var(--s-3);
    border-bottom: 1px solid var(--line);
  }
  .x {
    border: 0;
    background: none;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-3);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    border-top: 1px solid var(--line);
  }
</style>
