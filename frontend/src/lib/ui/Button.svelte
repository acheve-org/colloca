<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'default' | 'primary' | 'danger';
    type?: 'button' | 'submit';
    disabled?: boolean;
    /** A quiet ring on the button that starts the screen's first run. */
    pending?: boolean;
    title?: string;
    /** Accessible name when the text alone is not enough (a row action: which row?). */
    ariaLabel?: string;
    /** For a button that shows or hides something: its state and the element it controls. */
    expanded?: boolean;
    controls?: string;
    id?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  }
  let { variant = 'default', type = 'button', disabled = false, pending = false, title, ariaLabel, expanded, controls, id, onclick, children }: Props =
    $props();
</script>

<button class="btn {variant}" class:pending {type} {disabled} {title} aria-label={ariaLabel} aria-expanded={expanded} aria-controls={controls} {id} {onclick}>{@render children()}</button>

<style>
  .btn.pending {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent);
  }
  .btn.danger {
    color: var(--danger);
  }
  .btn.danger:hover:not(:disabled) {
    border-color: var(--danger);
  }
</style>
