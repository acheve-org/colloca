<script lang="ts">
  import ListPanel from '../src/lib/ui/ListPanel.svelte';
  let { showPanel = false, onback = () => {} }: { showPanel?: boolean; onback?: () => void } = $props();
</script>

<ListPanel label="Projects" {showPanel} {onback}>
  {#snippet list()}<p>the list</p>{/snippet}
  {#snippet panel()}<p>the panel</p>{/snippet}
</ListPanel>
