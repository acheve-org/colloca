<script lang="ts">
  import { messages } from '../messages.svelte';
  import { t } from '../i18n';
</script>

<div class="status {messages.current?.kind ?? ''}" role="status" aria-label={t('status.label')}>
  {messages.current?.text ?? ''}
</div>

<style>
  .status {
    min-height: 22px;
    padding: 2px var(--s-3);
    font-size: var(--fs-small);
    color: var(--muted);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .err {
    color: var(--danger);
  }
  .ok {
    color: var(--status-approved);
  }
</style>
