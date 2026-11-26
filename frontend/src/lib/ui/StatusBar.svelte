<script lang="ts">
  import { activity } from '../activity.svelte';
  import { jobs } from '../jobs.svelte';
  import { messages } from '../messages.svelte';
  import { t } from '../i18n';

  const kind = $derived(messages.current?.kind ?? '');
  const text = $derived(messages.current?.text ?? (activity.busy ? t('activity.working') : ''));

  function dismiss() {
    messages.clear();
    document.getElementById('main')?.focus();
  }
</script>

<footer class="bar">
  <div
    class="status {kind}"
    class:oneline={kind !== 'err'}
    role="status"
    aria-label={t('status.label')}
    title={text || undefined}
  >
    {#if activity.busy}<span class="spin" aria-hidden="true"></span>{/if}
    {text}
  </div>
  {#if messages.current?.kind === 'err'}
    <button type="button" class="dismiss" aria-label={t('status.dismiss')} onclick={dismiss}>×</button>
  {/if}
  {#if jobs.running}
    <div class="jobs" title={t('jobs.label')}>
      <progress max="100" value={Math.round(jobs.progress * 100)} aria-label={t('jobs.label')}></progress>
      <span>{jobs.running === 1 ? t('jobs.running1') : t('jobs.running', { n: jobs.running })}</span>
    </div>
  {/if}
</footer>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 28px;
    box-sizing: border-box;
    flex-shrink: 0;
    padding: 0 var(--s-3);
    font-size: var(--fs-small);
    background: var(--surface);
    border-top: 1px solid var(--line);
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
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin { animation: none; }
  }
  .status {
    flex: 1;
    min-width: 0;
    color: var(--muted);
  }
  .oneline {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .err {
    padding: var(--s-1) 0;
    white-space: normal;
    overflow-wrap: anywhere;
    color: var(--danger);
  }
  .ok {
    color: var(--status-approved);
  }
  .dismiss {
    flex: none;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--muted);
    line-height: 1;
    cursor: pointer;
  }
  .dismiss:hover {
    color: var(--fg);
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
