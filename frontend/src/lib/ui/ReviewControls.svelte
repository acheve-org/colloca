<script lang="ts">
  import { review } from '../candidates.svelte';
  import { t } from '../i18n';
  import Toggle from './Toggle.svelte';
</script>

<span class="review">
  <Toggle bind:checked={review.onlyNew} label={t('cand.onlyNew')} />
  <Toggle bind:checked={review.showDropped} label={t('cand.showDropped')} />
</span>

<style>
  .review {
    display: inline-flex;
    gap: var(--s-3);
    margin-left: var(--s-2);
  }
</style>
