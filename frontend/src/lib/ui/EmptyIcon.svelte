<script lang="ts" module>
  export type IconName = 'list' | 'none' | 'book' | 'folder' | 'corpus';
</script>

<script lang="ts">
  let { name }: { name: IconName } = $props();
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
  {#if name === 'list'}
    <path d="M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11" />
  {:else if name === 'none'}
    <circle cx="12" cy="12" r="8" />
    <path d="M6 6l12 12" />
  {:else if name === 'book'}
    <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
    <path d="M9 9h6" />
  {:else if name === 'folder'}
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  {:else}
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
    <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
  {/if}
</svg>
