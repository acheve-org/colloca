<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    actions?: Snippet;
    children: Snippet;
  }
  let { title, actions, children }: Props = $props();
</script>

<section class="strip" aria-label={title}>
  <header>
    <h3>{title}</h3>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </header>
  <div class="body">{@render children()}</div>
</section>

<style>
  .strip {
    flex: none;
    max-height: 40%;
    overflow: auto;
    background: var(--surface);
    border-top: 1px solid var(--line);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-3);
    border-bottom: 1px solid var(--line);
  }
  .actions {
    display: flex;
    gap: var(--s-1);
  }
  .body {
    padding: var(--s-2) var(--s-3);
  }
</style>
