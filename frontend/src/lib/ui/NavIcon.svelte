<script lang="ts">
  import type { AreaId } from '../nav';

  let { name }: { name: AreaId | 'menu' } = $props();
</script>

<svg
  width="20"
  height="20"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#if name === 'corpus'}
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
    <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
  {:else if name === 'explore'}
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  {:else if name === 'terms'}
    <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
    <path d="M9 9h6M9 13h6" />
  {:else if name === 'job'}
    <rect x="4" y="7" width="16" height="12" rx="2" />
    <path d="M9 7V5h6v2M4 12h16" />
  {:else if name === 'settings'}
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  {:else}
    <path d="M5 7h14M5 12h14M5 17h14" />
  {/if}
</svg>
