<script lang="ts">
  import { formatKeys } from '../shortcuts.svelte';

  let { keys }: { keys: string } = $props();
</script>

<kbd>{formatKeys(keys)}</kbd>
