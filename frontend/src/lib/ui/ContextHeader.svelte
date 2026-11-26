<script lang="ts">
  import type { Snippet } from 'svelte';
  import { corpusStore } from '../corpus.svelte';
  import { workingContext } from '../context.svelte';
  import { t } from '../i18n';
  import { route, screenHref } from '../router.svelte';
  import NavIcon from './NavIcon.svelte';

  let { children }: { children?: Snippet } = $props();

  const ctx = $derived(workingContext());
  const onProjects = $derived(route.screen === 'projects');
</script>

<div class="band">
  <div class="working" role="group" aria-label={t('ctx.working')}>
    {#if ctx}
      {@const project = ctx.project?.name ?? t('ctx.noProject')}
      <div class="text">
        <span class="project" title={project}>{project}</span>
        <div class="row">
          <span class="name" title={ctx.corpus.name}>{ctx.corpus.name}</span>
          <span class="badge" title={ctx.languageName}>{ctx.language.toUpperCase()}</span>
          {#if corpusStore.aligned}<span class="badge aligned">{t('src.check.aligned')}</span>{/if}
        </div>
      </div>
      <a
        class="gear"
        href={screenHref('projects')}
        aria-label={t('ctx.change')}
        title={t('ctx.change')}
        aria-current={onProjects ? 'page' : undefined}><NavIcon name="settings" /></a
      >
    {:else}
      <span class="empty">{t('ctx.noCorpus')}</span>
      <a class="choose" href={screenHref('projects')}>{t('ctx.choose')}</a>
    {/if}
  </div>
  {#if children}<div class="extra">{@render children()}</div>{/if}
</div>

<style>
  .band {
    position: relative; /* anchors the scope panel */
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3);
    padding: 12px var(--page-pad);
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }
  .working {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
    flex: 0 1 auto;
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .project {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px; /* literal: project line sits just under --fs-small, per the context band spec */
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 19px; /* literal: corpus name, per the context band spec */
    font-weight: 650;
  }
  .badge {
    flex: none;
    padding: 1px 6px;
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--fs-small);
    font-weight: 600;
  }
  .aligned::first-letter {
    text-transform: uppercase;
  }
  .gear {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    box-sizing: border-box;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--muted);
  }
  .gear:hover {
    color: var(--fg);
  }
  .gear[aria-current='page'] {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .empty {
    color: var(--muted);
  }
  .extra {
    margin-left: auto;
    min-width: 0;
  }
</style>
