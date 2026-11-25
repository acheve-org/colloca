<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    href: string;
    variant?: 'primary' | 'default';
    children: Snippet;
  }
  let { href, variant = 'default', children }: Props = $props();
</script>

<a class="link-btn {variant}" {href}>{@render children()}</a>

<style>
  .link-btn {
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    height: calc(var(--row-h) - var(--s-1));
    padding: 0 var(--s-2);
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    text-decoration: none;
    white-space: nowrap;
  }
  .link-btn:hover {
    border-color: var(--muted);
  }
  .link-btn.primary {
    color: var(--accent-fg);
    background: var(--accent);
    border-color: var(--accent);
  }
</style>
