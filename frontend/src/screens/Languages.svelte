<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from '../lib/api';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import type { Corpus, Languages } from '../lib/types';
  import BaseCorpusCard from '../lib/ui/BaseCorpusCard.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';

  const uid = $props.id();
  let langs = $state.raw<Languages>({});
  let refs = $state.raw<Corpus[]>([]);
  let loaded = $state(false);
  let force = $state(false);

  async function load(): Promise<void> {
    try {
      [langs, refs] = await Promise.all([get<Languages>('/api/languages'), get<Corpus[]>('/api/references')]);
      loaded = true;
    } catch (err) {
      messages.say(err instanceof Error ? err.message : String(err), 'err');
    }
  }
  onMount(load);
</script>

<div class="languages">
  <p class="intro">{t('base.intro')}</p>
  <div><Toggle bind:checked={force} label={t('src.force')} /></div>
  {#if loaded}
    <div class="cards">
      {#each Object.entries(langs) as [code, name] (code)}
        <section class="card" aria-labelledby="{uid}-{code}">
          <h3 id="{uid}-{code}">{name}</h3>
          <BaseCorpusCard lang={code} {name} reference={refs.find((r) => r.lang === code) ?? null} {force} onchange={load} />
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .languages {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3);
    overflow: auto;
  }
  .intro {
    max-width: 60rem;
    margin: 0;
    color: var(--muted);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: var(--s-3);
  }
  .card {
    min-width: 0;
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
</style>
