<script lang="ts">
  import type { Snippet } from 'svelte';

  let { label, hint, children }: { label: string; hint?: string; children: Snippet } = $props();
</script>

<label class="field">
  <span class="lbl">{label}</span>
  {@render children()}
  {#if hint}<span class="hint">{hint}</span>{/if}
</label>

<style>
  .field {
    display: inline-flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--fs-small);
  }
  .lbl {
    color: var(--muted);
    font-weight: 600;
  }
  .hint {
    color: var(--muted);
  }
</style>
