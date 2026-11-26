<script lang="ts">
  import SidePanel from '../src/lib/ui/SidePanel.svelte';
  let { returnFocus, empty = false }: { returnFocus?: string; empty?: boolean } = $props();
  let open = $state(false);
  let closed = $state(0);
</script>

<button onclick={() => (open = true)}>opener</button>
<button id="elsewhere">elsewhere</button>
<span data-testid="closed">{closed}</span>
<span data-testid="open">{open}</span>
<SidePanel bind:open title="Settings" {returnFocus} onclose={() => closed++}>
  {#if empty}
    <p>nothing to focus</p>
  {:else}
    <input aria-label="inner" />
  {/if}
  {#snippet footer()}<button>Save</button>{/snippet}
</SidePanel>
