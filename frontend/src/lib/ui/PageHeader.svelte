<script lang="ts">
  import { t } from '../i18n';
  import { route, hrefFor } from '../router.svelte';
  import { AREAS, BACK_LINKS, NO_CORPUS_SCREENS, SCOPE_SCREENS, areaOf } from '../nav';
  import { corpusStore } from '../corpus.svelte';
  import CorpusPicker from './CorpusPicker.svelte';
  import ScopeControl from './ScopeControl.svelte';
  import TabStrip from './TabStrip.svelte';

  const areaId = $derived(areaOf(route.screen));
  const area = $derived(AREAS.find((a) => a.id === areaId) ?? AREAS[0]);
  const back = $derived(BACK_LINKS[route.screen]);
  const showPicker = $derived(!NO_CORPUS_SCREENS.includes(route.screen));
  const showScope = $derived(SCOPE_SCREENS.includes(route.screen) && corpusStore.currentId !== null);
</script>

<header class="head">
  <div class="top">
    {#if showPicker}
      <div class="pickrow">
        <CorpusPicker />
        {#if showScope}<ScopeControl />{/if}
      </div>
    {/if}
    <div class="titles">
      <span class="area">{t(area.label)}</span>
      {#if back}<a class="back" href={hrefFor(back)}>← {t('src.backToDocuments')}</a>{/if}
      <h1>{t('nav.' + route.screen)}</h1>
    </div>
  </div>
  <TabStrip area={areaId} />
</header>

<style>
  .head {
    background: var(--bg);
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }
  .top {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-3) var(--s-2);
  }
  .pickrow {
    position: relative; /* anchors the scope panel */
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
  }
  .titles {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .area {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .back {
    font-size: 13px;
    color: var(--muted);
    width: fit-content;
  }
  h1 {
    margin: 0;
    font-size: 20px;
    overflow-wrap: anywhere;
  }
</style>
