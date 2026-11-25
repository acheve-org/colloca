<script lang="ts">
  import type { Snippet } from 'svelte';
  import EmptyIcon from './EmptyIcon.svelte';
  import type { IconName } from './EmptyIcon.svelte';

  interface Props {
    icon?: IconName;
    title: string;
    hint?: string;
    reasons?: string[];
    /** Announce the result (the no-hits case); other cards stay silent. */
    live?: boolean;
    actions?: Snippet;
    footer?: Snippet;
  }
  let { icon, title, hint, reasons = [], live = false, actions, footer }: Props = $props();
</script>

<div class="card" role={live ? 'status' : undefined}>
  {#if icon}<div class="ico"><EmptyIcon name={icon} /></div>{/if}
  <p class="title">{title}</p>
  {#if hint}<p class="hint">{hint}</p>{/if}
  {#if reasons.length}
    <ul class="reasons">
      {#each reasons as reason, i (i)}<li>{reason}</li>{/each}
    </ul>
  {/if}
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
  {#if footer}<div class="footer">{@render footer()}</div>{/if}
</div>

<style>
  .card {
    max-width: 32rem;
    margin: var(--s-6) auto;
    padding: var(--s-6);
    text-align: center;
    color: var(--muted);
    background: var(--surface);
    border: 1px dashed var(--line);
    border-radius: var(--radius);
  }
  p {
    margin: 0;
  }
  .ico {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    margin: 0 auto var(--s-2);
    color: var(--muted);
    background: var(--bg);
    border-radius: 50%;
  }
  .title {
    margin-bottom: var(--s-1);
    color: var(--fg);
    font-size: 15px;
    font-weight: 600;
  }
  .hint {
    margin-bottom: var(--s-3);
  }
  .reasons {
    margin: 0 0 var(--s-3);
    padding-left: var(--s-5);
    text-align: left;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
  }
  .footer {
    margin-top: var(--s-3);
    font-size: var(--fs-small);
  }
</style>
