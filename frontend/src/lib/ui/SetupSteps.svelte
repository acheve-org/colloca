<script lang="ts">
  import { t } from '../i18n';
  import type { SetupStep } from '../setup.svelte';
  import LinkButton from './LinkButton.svelte';

  let { step }: { step: SetupStep } = $props();

  const ORDER: SetupStep[] = ['language', 'project', 'corpus'];
  const TITLE = {
    language: 'setup.step.language',
    project: 'setup.step.project',
    corpus: 'setup.step.corpus',
  } as const;
  const HINT = {
    language: 'setup.language.hint',
    project: 'setup.project.hint',
    corpus: 'setup.corpus.hint',
  } as const;
  const GO = {
    language: 'setup.step.goLanguage',
    project: 'setup.step.goProject',
    corpus: 'setup.step.goCorpus',
  } as const;
  const HREF: Record<SetupStep, string> = {
    language: '#/languages',
    project: '#/projects',
    corpus: '#/projects',
  };

  const current = $derived(ORDER.indexOf(step));
  const items = $derived(
    ORDER.map((id, i) => ({
      id,
      n: i + 1,
      state: i < current ? 'done' : i === current ? 'current' : 'later',
    })),
  );
</script>

<ol class="steps">
  {#each items as item (item.id)}
    <li class="step" data-state={item.state} aria-current={item.state === 'current' ? 'step' : undefined}>
      <span class="mark" aria-hidden="true">
        {#if item.state === 'done'}
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 8.5 6.5 12 13 4.5" />
          </svg>
        {:else}
          {item.n}
        {/if}
      </span>
      <div class="body">
        <p class="title">{t(TITLE[item.id])}</p>
        {#if item.state === 'done'}<span class="sr-only">{t('setup.step.done')}</span>{/if}
        <p class="hint">{t(HINT[item.id])}</p>
        {#if item.state === 'current'}
          <div class="action">
            <LinkButton href={HREF[item.id]} variant="primary">{t(GO[item.id])}</LinkButton>
          </div>
        {/if}
      </div>
    </li>
  {/each}
</ol>

<style>
  .steps {
    display: grid;
    gap: var(--s-2);
    max-width: 32rem;
    margin: var(--s-6) auto;
    padding: 0;
    list-style: none;
  }
  .step {
    position: relative;
    display: flex;
    gap: var(--s-3);
    padding: var(--s-3);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .step[data-state='current'] {
    border-color: var(--accent);
  }
  .step[data-state='later'] {
    color: var(--muted);
  }
  .mark {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid currentColor;
    border-radius: 50%;
    font-size: var(--fs-small);
  }
  .step[data-state='done'] .mark {
    color: var(--status-approved);
  }
  .body {
    min-width: 0;
  }
  p {
    margin: 0;
  }
  .title {
    font-weight: 600;
  }
  .step[data-state='later'] .title {
    color: var(--muted);
  }
  .hint {
    margin-top: 2px;
    color: var(--muted);
  }
  .action {
    margin-top: var(--s-2);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
