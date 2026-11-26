<script lang="ts">
  import { activity } from '../activity.svelte';
</script>

{#if activity.busy}
  <span class="bar" data-testid="activity" aria-hidden="true"></span>
{/if}

<style>
  .bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    overflow: hidden;
    z-index: 1;
  }
  .bar::after {
    content: '';
    position: absolute;
    top: 0;
    height: 2px;
    width: 35%;
    background: var(--accent);
    animation: slide 1.2s linear infinite;
  }
  @keyframes slide {
    from { left: -35%; }
    to { left: 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar::after { animation: none; left: 0; width: 100%; opacity: 0.5; }
  }
</style>
