<script lang="ts">
  import { jobs } from '../jobs.svelte';
  import { messages } from '../messages.svelte';
  import { t } from '../i18n';
</script>

<div class="line">
  <div class="status {messages.current?.kind ?? ''}" role="status" aria-label={t('status.label')}>
    {messages.current?.text ?? ''}
  </div>
  {#if jobs.running}
    <div class="jobs" title={t('jobs.label')}>
      <progress max="100" value={Math.round(jobs.progress * 100)} aria-label={t('jobs.label')}></progress>
      <span>{jobs.running === 1 ? t('jobs.running1') : t('jobs.running', { n: jobs.running })}</span>
    </div>
  {/if}
</div>

<style>
  .line {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 22px;
    padding: 2px var(--s-3);
    font-size: var(--fs-small);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .status {
    flex: 1;
    min-width: 0;
    color: var(--muted);
  }
  .err {
    color: var(--danger);
  }
  .ok {
    color: var(--status-approved);
  }
  .jobs {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    color: var(--accent);
    white-space: nowrap;
  }
  progress {
    width: 6rem;
    height: 8px;
    accent-color: var(--accent);
  }
</style>
