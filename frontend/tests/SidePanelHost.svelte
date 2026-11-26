<script lang="ts">
  import SidePanel from '../src/lib/ui/SidePanel.svelte';
  let open = $state(false);
  let closed = $state(0);
</script>

<button onclick={() => (open = true)}>opener</button>
<span data-testid="closed">{closed}</span>
<span data-testid="open">{open}</span>
<SidePanel bind:open title="Settings" onclose={() => closed++}>
  <input aria-label="inner" />
  {#snippet footer()}<button>Save</button>{/snippet}
</SidePanel>
