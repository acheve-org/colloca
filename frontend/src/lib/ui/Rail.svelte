<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../i18n';
  import { areaHref, go, route } from '../router.svelte';
  import { AREAS, ALIGNED_ONLY, areaOf } from '../nav';
  import { corpusStore } from '../corpus.svelte';
  import { loadSession } from '../session.svelte';
  import { ensureLanguageName, loadLanguageNames } from '../context.svelte';
  import { messages } from '../messages.svelte';
  import { reloadProjects } from '../projects.svelte';
  import NavIcon from './NavIcon.svelte';
  import RailMenu from './RailMenu.svelte';

  const active = $derived(areaOf(route.screen));

  onMount(() => {
    void loadSession();
    const say = (err: unknown) => messages.say(err instanceof Error ? err.message : String(err), 'err');
    reloadProjects().catch(say);
    loadLanguageNames().catch(say);
  });

  // A corpus in a language added after the names were loaded.
  $effect(() => {
    void ensureLanguageName();
  });

  // Leave a screen that is hidden, but only once the corpus load has settled
  // (a deep link to #/equivalents must survive the first load).
  $effect(() => {
    if (!corpusStore.loaded) return;
    if (ALIGNED_ONLY.includes(route.screen) && !corpusStore.aligned) go('concordance');
  });
</script>

<aside class="rail">
  <div class="brand" title={t('app.name')}>
    <span aria-hidden="true">{t('app.name').charAt(0)}</span>
    <span class="sr">{t('app.name')}</span>
  </div>
  <nav aria-label={t('nav.label')}>
    {#each AREAS as a (a.id)}
      <a
        href={areaHref(a.id)}
        class:bottom={a.bottom}
        class:active={active === a.id}
        title={t(a.label)}
        aria-current={active === a.id ? 'page' : undefined}
      >
        <NavIcon name={a.id} />
        <span class="label">{t(a.label)}</span>
      </a>
    {/each}
  </nav>
  <RailMenu />
</aside>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    width: 56px;
    background: var(--rail-bg);
    color: var(--rail-fg);
    overflow: visible;
  }
  .brand {
    padding: var(--s-3) 0 var(--s-2);
    text-align: center;
    font-weight: 700;
    font-size: 22px;
  }
  nav {
    display: flex;
    flex-direction: column;
    flex: 1;
    padding: var(--s-2) 0;
  }
  a {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: var(--s-2) 0;
    color: var(--rail-muted);
    text-decoration: none;
    border-left: 3px solid transparent;
  }
  a.bottom {
    margin-top: auto;
  }
  a:hover {
    color: var(--rail-fg);
    background: var(--rail-hover);
  }
  a.active {
    color: var(--rail-fg);
    background: var(--rail-hover);
    border-left-color: var(--rail-accent);
  }
  a:focus-visible {
    outline-color: var(--rail-accent);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .label {
    font-size: 10px;
    line-height: 1.2;
    max-width: 100%;
    padding: 0 2px;
    box-sizing: border-box;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
