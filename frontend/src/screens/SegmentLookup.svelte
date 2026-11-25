<script lang="ts">
  import { post } from '../lib/api';
  import { corpusStore, scopeParams } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import type { ConcLine, LookupMatch, LookupResult } from '../lib/types';
  import Badge from '../lib/ui/Badge.svelte';
  import Button from '../lib/ui/Button.svelte';
  import DocViewer from '../lib/ui/DocViewer.svelte';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Toolbar from '../lib/ui/Toolbar.svelte';

  const LEVELS = ['50', '60', '70', '75', '85', '95'];
  let text = $state('');
  let minPercent = $state('70');
  let result = $state.raw<LookupResult | null>(null);
  let busy = $state(false);
  let seq = 0;

  const corpus = $derived(corpusStore.current);
  const levelOptions = $derived(LEVELS.map((v) => ({ value: v, label: `${v}%` })));

  async function run(): Promise<void> {
    if (!corpus) return;
    if (!text.trim()) {
      messages.say(t('lk.needText'), 'err');
      return;
    }
    const n = ++seq;
    busy = true;
    try {
      const r = await post<LookupResult>(
        `/api/corpora/${corpus.id}/segment-lookup`,
        { text, min_percent: Number(minPercent), limit: 10 },
        scopeParams(),
      );
      if (n !== seq) return;
      result = r;
      messages.clear();
    } catch (err) {
      if (n === seq) messages.say(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      if (n === seq) busy = false;
    }
  }

  // reading a match in its document (the shared viewer)
  let viewerOpen = $state(false);
  let current = $state.raw<LookupMatch | null>(null);
  const hit = $derived<ConcLine | null>(
    current
      ? { doc_id: current.doc_id, doc: current.doc, pos: current.pos, matches: [current.pos, current.pos + current.span - 1], left: '', node: '', right: '' }
      : null,
  );
  const index = $derived(current && result ? result.matches.indexOf(current) : -1);
  function open(m: LookupMatch): void {
    current = m;
    viewerOpen = true;
  }
  function step(by: number): void {
    const next = result?.matches[index + by];
    if (next) current = next;
  }
  const badgeKind = (p: number) => (p >= 100 ? 'approved' : p >= 85 ? 'admitted' : p >= 75 ? 'candidate' : 'neutral');

  function onkeydown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void run();
    }
  }
</script>

<div class="lk">
  {#if !corpus}
    {#if corpusStore.loaded}<EmptyState title={t('corpus.selectFirst')} />{/if}
  {:else}
    <Toolbar label={t('lk.toolbar')}>
      <Field label={t('lk.min')}><Select label={t('lk.min')} bind:value={minPercent} options={levelOptions} /></Field>
      <Button variant="primary" disabled={busy} onclick={run}>{t('lk.go')}</Button>
    </Toolbar>
    <div class="body">
      <p class="intro">{t('lk.intro')}</p>
      <textarea rows="3" bind:value={text} {onkeydown} aria-label={t('lk.text')} placeholder={t('lk.placeholder')}></textarea>
      {#if result}
        <p class="summary" aria-live="polite">
          {result.matches.length
            ? t('lk.summary', { n: result.found, words: result.query_words })
            : t('lk.none', { min: minPercent })}
        </p>
        <ol class="matches" aria-label={t('lk.results')}>
          {#each result.matches as m (`${m.doc_id}:${m.seg}`)}
            <li>
              <div class="head">
                <Badge kind={badgeKind(m.percent)} label={`${m.percent}%`} />
                <span class="band">{t(`lk.band.${m.band}`)}</span>
                {#if m.exact}<span class="flag">{t('lk.exact')}</span>{/if}
                {#if m.only_numbers_differ}<span class="flag" title={t('lk.numbersHint')}>{t('lk.numbers')}</span>{/if}
                <span class="doc grow">{m.doc}</span>
                <Button onclick={() => open(m)} ariaLabel={t('lk.openOf', { doc: m.doc })}>{t('lk.open')}</Button>
              </div>
              <p class="src" lang={corpus.lang}>
                {#each m.diff as d, i (i)}<span
                    class="w {d.kind}"
                    class:sp={d.sp}
                    title={d.kind === 'extra' ? t('lk.extraHint') : d.kind === 'missing' ? t('lk.missingHint') : undefined}>{d.text}</span>{/each}
              </p>
              <p class="tgt">{m.target || t('lk.noTarget')}</p>
            </li>
          {/each}
        </ol>
        {#if result.matches.length}
          <p class="muted">{t('lk.legend')}</p>
          <p class="muted">{t('lk.caveat')}</p>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<DocViewer
  bind:open={viewerOpen}
  {hit}
  index={index + 1}
  total={result?.matches.length ?? 0}
  onprev={() => step(-1)}
  onnext={() => step(1)}
/>

<style>
  .lk {
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
  .summary {
    margin: 0;
    font-weight: 600;
  }
  .matches {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .matches li {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--s-2) var(--s-3);
    background: var(--surface);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .doc,
  .band {
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .flag {
    font-size: var(--fs-small);
    border: 1px dashed currentColor;
    border-radius: var(--radius);
    padding: 0 var(--s-1);
  }
  .src,
  .tgt {
    margin: var(--s-1) 0 0;
    line-height: 1.6;
  }
  .tgt {
    color: var(--muted);
  }
  .w.sp {
    margin-right: 0.28em;
  }
  /* words only the stored segment has: blue with an underline; words only the query has: struck through */
  .extra {
    background: var(--hit-term-bg);
    color: var(--hit-term-fg);
    text-decoration: underline;
    text-underline-offset: 2px;
    border-radius: 2px;
  }
  .missing {
    color: var(--muted);
    text-decoration: line-through;
  }
</style>
