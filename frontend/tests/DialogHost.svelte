<script lang="ts">
  import Dialog from '../src/lib/ui/Dialog.svelte';
  let open = $state(false);
  let closed = $state(0);
</script>

<button onclick={() => (open = true)}>opener</button>
<span data-testid="closed">{closed}</span>
<Dialog bind:open title="Hello" onclose={() => closed++}>
  <input aria-label="inner" />
  {#snippet footer()}<button onclick={() => (open = false)}>Done</button>{/snippet}
</Dialog>
