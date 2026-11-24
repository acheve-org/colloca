<script lang="ts">
  import { activity } from '../activity.svelte';
  import { jobs } from '../jobs.svelte';
  import { messages } from '../messages.svelte';
  import { t } from '../i18n';
</script>

<div class="line">
  {#if activity.busy}
    <span class="bar" data-testid="activity" aria-hidden="true"></span>
  {/if}
  <div class="status {messages.current?.kind ?? ''}" role="status" aria-label={t('status.label')}>
    {#if activity.busy}<span class="spin" aria-hidden="true"></span>{/if}
    {messages.current?.text ?? (activity.busy ? t('activity.working') : '')}
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
    position: relative;
  }
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    overflow: hidden;
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
  .spin {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: var(--s-1);
    vertical-align: -1px;
    border: 1.5px solid var(--line);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes slide {
    from { left: -35%; }
    to { left: 100%; }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar::after { animation: none; left: 0; width: 100%; opacity: 0.5; }
    .spin { animation: none; }
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
