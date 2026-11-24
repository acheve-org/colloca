<script lang="ts">
  import { ApiError, post } from '../lib/api';
  import { corpusStore } from '../lib/corpus.svelte';
  import { termRanges } from '../lib/highlight';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import type { CheckTextResult } from '../lib/types';
  import Button from '../lib/ui/Button.svelte';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Highlight from '../lib/ui/Highlight.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Toolbar from '../lib/ui/Toolbar.svelte';

  // 'source' = a segment in the corpus language; 'draft' = a draft translation (the other language).
  const LANGS = ['es', 'it'];
  let text = $state('');
  let side = $state<'source' | 'draft'>('source');
  let result = $state.raw<CheckTextResult | null>(null);
  let busy = $state(false);
  let error = $state('');

  const corpus = $derived(corpusStore.current);
  const lang = $derived(
    !corpus ? '' : side === 'source' ? corpus.lang : (LANGS.find((l) => l !== corpus.lang) ?? corpus.lang),
  );

  async function run(): Promise<void> {
    if (!corpus) return;
    if (!text.trim()) {
      messages.say(t('chk.needText'), 'err');
      return;
    }
    busy = true;
    error = '';
    try {
      result = await post<CheckTextResult>(`/api/corpora/${corpus.id}/check-text`, { text, lang });
    } catch (e) {
      result = null;
      error = e instanceof ApiError ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="chk">
  {#if !corpus}
    {#if corpusStore.loaded}<EmptyState title={t('corpus.selectFirst')} />{/if}
  {:else}
    <Toolbar label={t('chk.toolbar')}>
      <Field label={t('chk.what')}>
        <Select
          bind:value={side}
          label={t('chk.what')}
          options={[
            { value: 'source', label: t('chk.source', { lang: corpus.lang }) },
            { value: 'draft', label: t('chk.draft', { lang: LANGS.find((l) => l !== corpus.lang) ?? '' }) },
          ]}
        />
      </Field>
      <Button variant="primary" disabled={busy} onclick={run}>{t('chk.go')}</Button>
    </Toolbar>
    <div class="body">
      <p class="intro">{t('chk.intro')}</p>
      <textarea
        rows="5"
        bind:value={text}
        aria-label={t('chk.text')}
        placeholder={t('chk.placeholder')}
      ></textarea>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if result}
        <p class="summary" aria-live="polite">
          {t('chk.summary', { hits: result.summary.hits, forbidden: result.summary.forbidden })}
        </p>
        <ol class="lines">
          {#each result.lines as l, i (i)}
            <li><Highlight text={l.text} ranges={termRanges(l.marks)} /></li>
          {/each}
        </ol>
        {#if result.summary.hits + result.summary.forbidden === 0}<p class="muted">{t('chk.none')}</p>{/if}
        <p class="muted legend">{t('chk.legend')}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chk {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3) var(--s-4);
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
  }
  .intro,
  .muted {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .error {
    margin: 0;
    color: var(--danger);
  }
  .summary {
    margin: 0;
    font-weight: 600;
  }
  .lines {
    margin: 0;
    padding-left: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    line-height: 1.6;
  }
</style>
