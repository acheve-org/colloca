<script lang="ts">
  import type { Snippet } from 'svelte';
  import Rail from './Rail.svelte';
  import PageHeader from './PageHeader.svelte';
  import StatusLine from './StatusLine.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="shell">
  <Rail />
  <div class="main">
    <StatusLine />
    <PageHeader />
    <main id="main">{@render children()}</main>
  </div>
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    height: 100vh;
  }
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
  }
</style>
