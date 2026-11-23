<script lang="ts">
  import type { Snippet } from 'svelte';

  let { label, children }: { label?: string; children: Snippet } = $props();
</script>

<div class="toolbar" role="toolbar" aria-label={label}>{@render children()}</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
</style>
