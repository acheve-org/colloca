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

  let strip: HTMLElement | undefined = $state(); // the tab row: no padding, so clientWidth is the usable width
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

  // The More popover unmounts when a tab is chosen from it: put focus on the newly active tab instead.
  let refocus = false;
  $effect(() => {
    void route.screen;
    if (!refocus) return;
    refocus = false;
    tick().then(() => strip?.querySelector<HTMLElement>('a[aria-current="page"]')?.focus());
  });
</script>

{#if tabs.length >= 2}
  <div class="wrap">
    <div class="measure" aria-hidden="true" bind:this={measure}>
      {#each tabs as tab (tab)}
        <span class="tab" data-tab>{t('nav.' + tab)}</span>
      {/each}
      <span class="tab more" bind:this={moreProbe}>{t('nav.more')}</span>
    </div>
    <div class="strip" role="group" aria-label={t('nav.tabs')} bind:this={strip}>
      {#each shown as i (tabs[i])}
        <a
          class="tab"
          class:active={route.screen === tabs[i]}
          href={screenHref(tabs[i])}
          title={t('nav.' + tabs[i])}
          aria-current={route.screen === tabs[i] ? 'page' : undefined}>{t('nav.' + tabs[i])}</a
        >
      {/each}
      {#if folded.length}
        <div class="morewrap">
          <button
            type="button"
            class="tab more"
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
                  onclick={() => {
                    open = false;
                    refocus = true;
                  }}>{t('nav.' + tabs[i])}</a
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
    margin: 0 var(--s-3);
  }
  .measure {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
    white-space: nowrap;
    font-weight: 600; /* the active tab is bold: measure every tab at that weight */
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
    height: auto; /* base.css gives every button a fixed control height; a tab sizes from its padding */
    font: inherit;
    cursor: pointer;
  }
  /* A lone active tab wider than the row shrinks (the strip itself must not clip the More popover). */
  .strip > .tab {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tab:hover {
    color: var(--fg);
  }
  .tab.active {
    color: var(--fg);
    font-weight: 600;
    border-bottom-color: var(--accent);
  }
  /* Same box as a sibling tab: a flex item with no line box of its own, so the button gets no baseline gap. */
  .morewrap {
    position: relative;
    display: flex;
    align-items: flex-end;
  }
  .morewrap > .tab {
    display: block;
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
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
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
