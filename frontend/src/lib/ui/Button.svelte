<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'default' | 'primary' | 'danger';
    type?: 'button' | 'submit';
    disabled?: boolean;
    title?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  }
  let { variant = 'default', type = 'button', disabled = false, title, onclick, children }: Props =
    $props();
</script>

<button class="btn {variant}" {type} {disabled} {title} {onclick}>{@render children()}</button>

<style>
  .btn.danger {
    color: var(--danger);
  }
  .btn.danger:hover:not(:disabled) {
    border-color: var(--danger);
  }
</style>
