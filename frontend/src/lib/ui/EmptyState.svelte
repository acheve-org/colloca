<script lang="ts">
  let { title, hint }: { title: string; hint?: string } = $props();
</script>

<div class="empty">
  <p class="title">{title}</p>
  {#if hint}<p class="hint">{hint}</p>{/if}
</div>

<style>
  .empty {
    padding: var(--s-6);
    text-align: center;
    color: var(--muted);
  }
  p {
    margin: 0;
  }
  .title {
    color: var(--fg);
    font-weight: 600;
  }
</style>
