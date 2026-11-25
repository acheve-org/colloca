<script lang="ts">
  import { t } from '../i18n';
  import Button from './Button.svelte';

  interface Props {
    summary: string;
    label: string;
    enabled: boolean;
    busy: boolean;
    onsubmit: () => void;
    oncancel: () => void;
  }
  let { summary, label, enabled, busy, onsubmit, oncancel }: Props = $props();
</script>

<div class="bar">
  <p class="summary" aria-live="polite">{summary}</p>
  <Button onclick={oncancel}>{t('common.cancel')}</Button>
  <Button variant="primary" disabled={!enabled || busy} onclick={onsubmit}>{label}</Button>
</div>

<style>
  /* Sticks to the bottom of the scrolling area it sits in. */
  .bar {
    position: sticky;
    bottom: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    background: var(--bg);
    border-top: 1px solid var(--line);
  }
  .summary {
    flex: 1;
    min-width: 0;
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-small);
    overflow-wrap: anywhere;
  }
</style>
