<script lang="ts">
  import { theme, setMode, type ThemeMode } from './lib/theme.svelte';

  const modes: ThemeMode[] = ['auto', 'light', 'dark'];
</script>

<h1>Colloca</h1>
<div>
  {#each modes as m (m)}
    <button class:primary={theme.mode === m} onclick={() => setMode(m)}>{m}</button>
  {/each}
</div>
