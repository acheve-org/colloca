<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t, locale } from '../i18n';
  import { route, screenHref } from '../router.svelte';
  import { corpusStore } from '../corpus.svelte';
  import { fitTabs, visibleTabs, type AreaId } from '../nav';
  import { dismiss } from './dismiss';

  let { area }: { area: AreaId } = $props();

  const tabs = $derived(visibleTabs(area, corpusStore.aligned));
  const active = $derived(tabs.indexOf(route.screen));

  let strip: HTMLElement | undefined = $state();
  let measure: HTMLElement | undefined = $state();
  let moreProbe: HTMLElement | undefined = $state();
  let moreBtn: HTMLButtonElement | null = $state(null);
  let widths = $state<number[]>([]);
  let moreWidth = $state(0);
  let available = $state(0);
  let open = $state(false);

  const shown = $derived(
    widths.length === tabs.length ? fitTabs(widths, available, active, moreWidth) : tabs.map((_, i) => i),
  );
  const folded = $derived(tabs.map((_, i) => i).filter((i) => !shown.includes(i)));

  function remeasure() {
    if (!measure) return;
    widths = Array.from(measure.querySelectorAll<HTMLElement>('[data-tab]')).map((el) => el.offsetWidth);
    moreWidth = moreProbe?.offsetWidth ?? 0;
    available = strip?.clientWidth ?? 0;
  }

  onMount(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      available = strip?.clientWidth ?? 0;
    });
    if (strip) ro.observe(strip);
    return () => ro.disconnect();
  });

  // Tab names change with the language and the tab list with the corpus: measure again once the DOM has caught up.
  $effect(() => {
    void locale.code;
    void tabs.length;
    if (!measure) return;
    tick().then(remeasure);
  });

  $effect(() => {
    if (folded.length === 0) open = false;
  });
</script>

{#if tabs.length >= 2}
  <div class="wrap" bind:this={strip}>
    <div class="measure" aria-hidden="true" bind:this={measure}>
      {#each tabs as tab (tab)}
        <span class="tab" data-tab>{t('nav.' + tab)}</span>
      {/each}
      <span class="tab more" bind:this={moreProbe}>{t('nav.more')}</span>
    </div>
    <div class="strip" role="group" aria-label={t('nav.tabs')}>
      {#each shown as i (tabs[i])}
        <a
          class="tab"
          class:active={route.screen === tabs[i]}
          href={screenHref(tabs[i])}
          aria-current={route.screen === tabs[i] ? 'page' : undefined}>{t('nav.' + tabs[i])}</a
        >
      {/each}
      {#if folded.length}
        <div class="morewrap">
          <button
            type="button"
            class="tab more"
            aria-haspopup="true"
            aria-expanded={open}
            bind:this={moreBtn}
            onclick={() => (open = !open)}>{t('nav.more')}</button
          >
          {#if open}
            <div class="pop" use:dismiss={{ close: () => (open = false), trigger: moreBtn }}>
              {#each folded as i (tabs[i])}
                <a
                  href={screenHref(tabs[i])}
                  aria-current={route.screen === tabs[i] ? 'page' : undefined}
                  onclick={() => (open = false)}>{t('nav.' + tabs[i])}</a
                >
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .wrap {
    position: relative;
    min-width: 0;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
  }
  .strip {
    display: flex;
    align-items: flex-end;
    padding: 0 var(--s-3);
    overflow: visible;
  }
  .measure {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
    white-space: nowrap;
    height: 0;
    overflow: hidden;
  }
  .tab {
    display: inline-block;
    padding: var(--s-2) var(--s-3);
    color: var(--muted);
    text-decoration: none;
    white-space: nowrap;
    background: none;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    font: inherit;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--fg);
  }
  .tab.active {
    color: var(--fg);
    font-weight: 600;
    border-bottom-color: var(--accent);
  }
  .morewrap {
    position: relative;
  }
  .pop {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 10;
    min-width: 160px;
    display: flex;
    flex-direction: column;
    padding: var(--s-1) 0;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .pop a {
    padding: var(--s-1) var(--s-3);
    color: var(--fg);
    text-decoration: none;
    white-space: nowrap;
  }
  .pop a:hover {
    background: var(--surface);
  }
  .pop a[aria-current='page'] {
    font-weight: 600;
  }
</style>
