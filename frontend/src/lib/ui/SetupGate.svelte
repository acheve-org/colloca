<script lang="ts">
  import type { Snippet } from 'svelte';
  import { route } from '../router.svelte';
  import { setupReady, setupStep } from '../setup.svelte';
  import SetupSteps from './SetupSteps.svelte';

  let { children }: { children: Snippet } = $props();

  // Where the user sets things up (and the Trash, which works without a corpus).
  const FREE = ['languages', 'projects', 'trash'];

  // Hold only until the first time everything has loaded: a later corpus switch (loaded toggles
  // false for a moment) must not unmount the screen. Plain variable on purpose, not state.
  let settled = false;
  const hold = $derived.by(() => {
    if (settled) return false;
    if (setupReady()) {
      settled = true;
      return false;
    }
    return !FREE.includes(route.screen);
  });
  const step = $derived(FREE.includes(route.screen) || hold ? null : setupStep());
</script>

{#if hold}
  <!-- Stores still loading: render nothing rather than flash an empty state. -->
{:else if step}
  <SetupSteps {step} />
{:else}
  {@render children()}
{/if}
