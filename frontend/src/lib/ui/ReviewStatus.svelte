<script lang="ts">
  import { type Flagged, inTermbase, isDropped } from '../candidates.svelte';
  import { t } from '../i18n';
  import Badge from './Badge.svelte';

  let { row }: { row: Flagged } = $props();
  const status = $derived(inTermbase(row));
</script>

{#if status}<Badge kind="intb" label={t('cand.inTermbase')} />{/if}
{#if isDropped(row)}<Badge kind="neutral" label={t('cand.dropped')} />{/if}
