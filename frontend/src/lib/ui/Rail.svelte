<script lang="ts" module>
  import type { ScreenId } from '../router.svelte';
  import { corpusStore } from '../corpus.svelte';

  export interface NavItem {
    id: ScreenId;
    label: string;
    visible?: () => boolean;
  }
  export interface NavGroup {
    group: string;
    items: NavItem[];
  }

  export const NAV: NavGroup[] = [
    {
      group: 'nav.group.setup',
      items: [
        { id: 'languages', label: 'nav.languages' },
        { id: 'projects', label: 'nav.projects' },
      ],
    },
    { group: 'nav.group.corpus', items: [{ id: 'sources', label: 'nav.sources' }] },
    {
      group: 'nav.group.explore',
      items: [
        { id: 'concordance', label: 'nav.concordance' },
        { id: 'collocations', label: 'nav.collocations' },
        { id: 'ngrams', label: 'nav.ngrams' },
        { id: 'frequency', label: 'nav.frequency' },
        { id: 'dispersion', label: 'nav.dispersion' },
        { id: 'keyness', label: 'nav.keyness' },
        { id: 'cloud', label: 'nav.cloud' },
        { id: 'related', label: 'nav.related' },
        { id: 'equivalents', label: 'nav.equivalents', visible: () => corpusStore.aligned },
        { id: 'lookup', label: 'nav.lookup', visible: () => corpusStore.aligned },
      ],
    },
    { group: 'nav.group.terms', items: [
        { id: 'termbase', label: 'nav.termbase' },
        { id: 'candidates', label: 'nav.candidates' },
        { id: 'check', label: 'nav.check' },
      ],
    },
    { group: 'nav.group.job', items: [{ id: 'job', label: 'nav.job' }] },
    { group: 'nav.group.data', items: [{ id: 'trash', label: 'nav.trash' }] },
  ];
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { t, LANGS, LANG_NAMES, locale, setLang } from '../i18n';
  import { go, route, screenHref } from '../router.svelte';
  import { setMode, theme, type ThemeMode } from '../theme.svelte';
  import { loadSession, logout, session } from '../session.svelte';
  import CorpusSwitcher from './CorpusSwitcher.svelte';

  const modes: ThemeMode[] = ['auto', 'light', 'dark'];

  onMount(() => {
    void loadSession();
  });

  // Leave a screen whose rail item is hidden, but only once the corpus load has settled
  // (a deep link to #/equivalents must survive the first load).
  $effect(() => {
    if (!corpusStore.loaded) return;
    const item = NAV.flatMap((g) => g.items).find((i) => i.id === route.screen);
    if (item?.visible && !item.visible()) go('concordance');
  });
</script>

<aside class="rail">
  <div class="brand">{t('app.name')}</div>
  <CorpusSwitcher />
  <nav aria-label={t('nav.label')}>
    {#each NAV as g (g.group)}
      {@const items = g.items.filter((i) => !i.visible || i.visible())}
      {#if items.length}
        <div class="group">
          <div class="group-name">{t(g.group)}</div>
          {#each items as i (i.id)}
            <a
              href={screenHref(i.id)}
              class:active={route.screen === i.id}
              aria-current={route.screen === i.id ? 'page' : undefined}>{t(i.label)}</a
            >
          {/each}
        </div>
      {/if}
    {/each}
  </nav>
  <div class="foot" role="group" aria-label={t('theme.label')}>
    {#each modes as m (m)}
      <button type="button" aria-pressed={theme.mode === m} onclick={() => setMode(m)}>{t(`theme.${m}`)}</button>
    {/each}
  </div>
  <div class="foot" role="group" aria-label={t('lang.label')}>
    {#each LANGS as l (l)}
      <button
        type="button"
        lang={l}
        title={LANG_NAMES[l]}
        aria-label={LANG_NAMES[l]}
        aria-pressed={locale.code === l}
        onclick={() => setLang(l)}>{l.toUpperCase()}</button
      >
    {/each}
  </div>
  {#if session.required}
    <div class="foot">
      <button type="button" onclick={logout}>{t('auth.logout')}</button>
    </div>
  {/if}
</aside>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    width: 200px;
    background: var(--rail-bg);
    color: var(--rail-fg);
    overflow-y: auto;
  }
  .brand {
    padding: var(--s-3) var(--s-3) var(--s-2);
    font-weight: 700;
    font-size: 14px;
  }
  nav {
    flex: 1;
    padding: var(--s-2) 0;
  }
  .group-name {
    padding: var(--s-2) var(--s-3) var(--s-1);
    color: var(--rail-muted);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  a {
    display: block;
    padding: 4px var(--s-3) 4px calc(var(--s-3) - 3px);
    color: inherit;
    text-decoration: none;
    border-left: 3px solid transparent;
  }
  a:hover {
    background: var(--rail-hover);
  }
  a.active {
    background: var(--rail-hover);
    border-left-color: var(--rail-accent);
    font-weight: 600;
  }
  a:focus-visible,
  .foot button:focus-visible {
    outline-color: var(--rail-accent);
  }
  .foot {
    display: flex;
    gap: 2px;
    padding: var(--s-2) var(--s-3);
    border-top: 1px solid var(--rail-hover);
  }
  .foot + .foot {
    border-top: 0;
    padding-top: 0;
  }
  .foot button {
    flex: 1;
    padding: 0 var(--s-1);
    color: var(--rail-muted);
    background: transparent;
    border-color: var(--rail-hover);
  }
  .foot button[aria-pressed='true'] {
    color: var(--rail-fg);
    background: var(--rail-hover);
    border-color: var(--rail-accent);
  }
</style>
