<script lang="ts">
  import { t } from '../i18n';
  import { route, hrefFor } from '../router.svelte';
  import { BACK_LINKS, SCOPE_SCREENS, areaOf } from '../nav';
  import { corpusStore } from '../corpus.svelte';
  import ContextHeader from './ContextHeader.svelte';
  import ScopeControl from './ScopeControl.svelte';
  import TabStrip from './TabStrip.svelte';

  const areaId = $derived(areaOf(route.screen));
  const back = $derived(BACK_LINKS[route.screen]);
  const showScope = $derived(SCOPE_SCREENS.includes(route.screen) && corpusStore.currentId !== null);
</script>

<header class="head">
  <ContextHeader>{#if showScope}<ScopeControl />{/if}</ContextHeader>
  <h1 class="sr-only">{t('nav.' + route.screen)}</h1>
  {#if back}<div class="backrow"><a href={hrefFor(back)}>← {t('src.backToDocuments')}</a></div>{/if}
  <TabStrip area={areaId} />
</header>

<style>
  .head {
    background: var(--bg);
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }
  .backrow {
    padding: var(--s-2) var(--page-pad);
    font-size: var(--fs-small);
  }
  .backrow a {
    color: var(--muted);
  }
</style>
