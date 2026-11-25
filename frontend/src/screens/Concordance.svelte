<script module lang="ts">
  type Unit = 'lemma' | 'form';
  type Sort = 'doc' | 'left' | 'right' | 'l1' | 'l2' | 'r1' | 'r2';

  const UNITS: Unit[] = ['lemma', 'form'];
  const SORTS: Sort[] = ['doc', 'left', 'right', 'l1', 'l2', 'r1', 'r2'];
  /** Selectable number of hits shown and exported (CSV link). The API allows up to 2000. */
  const LIMITS = ['100', '500', '2000'];
  const DEFAULT_LIMIT = '500';

  /** Case- and accent-insensitive text used by the filters inside the results. */
  function fold(s: string | undefined): string {
    return (s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  }

  function newSeed(): number {
    return 1 + Math.floor(Math.random() * 1_000_000);
  }

  function toWidth(v: string | undefined): number {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isFinite(n) ? Math.min(40, Math.max(2, n)) : 8;
  }
</script>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { get } from '../lib/api';
  import { CORPUS_CHANGED, corpusStore, scopeParams } from '../lib/corpus.svelte';
  import { csvUrl } from '../lib/csv';
  import { sourceRanges, targetIsGuess, targetRanges, termRanges } from '../lib/highlight';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import { go, route } from '../lib/router.svelte';
  import { formatKeys, registerShortcut, withKeys } from '../lib/shortcuts.svelte';
  import { openTerm, termStore } from '../lib/term.svelte';
  import type { BilingualResult, ConcLine, ConcordanceResult, DocContext, QueryExplanation } from '../lib/types';
  import Badge from '../lib/ui/Badge.svelte';
  import Button from '../lib/ui/Button.svelte';
  import DetailStrip from '../lib/ui/DetailStrip.svelte';
  import DocViewer from '../lib/ui/DocViewer.svelte';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import NoCorpus from '../lib/ui/NoCorpus.svelte';
  import ReadyHint from '../lib/ui/ReadyHint.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Highlight from '../lib/ui/Highlight.svelte';
  import Kbd from '../lib/ui/Kbd.svelte';
  import Kwic, { lineKey } from '../lib/ui/Kwic.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import Toolbar from '../lib/ui/Toolbar.svelte';

  // Form state, restored from the route so a reload keeps the search.
  const initial = untrack(() => ({ ...route.params }));
  let q = $state(initial.q ?? '');
  let unit = $state<Unit>(UNITS.includes(initial.unit as Unit) ? (initial.unit as Unit) : 'lemma');
  let width = $state<number | null>(toWidth(initial.width));
  let sort = $state<Sort>(SORTS.includes(initial.sort as Sort) ? (initial.sort as Sort) : 'doc');
  let bilingual = $state(initial.bi === '1');
  let caseSensitive = $state(initial.case === '1');
  let anyOrder = $state(initial.any === '1');
  let advanced = $state(initial.adv === '1');
  let accent = $state(initial.acc === '1');
  let limit = $state(LIMITS.includes(initial.n ?? '') ? (initial.n as string) : DEFAULT_LIMIT);
  let sampling = $state(Number.parseInt(initial.sample ?? '', 10) > 0);
  let seed = $state(Number.parseInt(initial.sample ?? '', 10) > 0 ? Number.parseInt(initial.sample!, 10) : newSeed());

  // The query in words (or the mistake with its position) while typing in advanced mode, and after a search.
  let capped = $state(false);
  let explanation = $state<QueryExplanation | null>(null);
  let explainSeq = 0;

  $effect(() => {
    const text = q.trim();
    const params = { q: text, unit, advanced: 'true', ...(caseSensitive ? { case_sensitive: 'true' } : {}), ...(accent ? { accent_insensitive: 'true' } : {}) };
    if (!advanced || !text) {
      explanation = null;
      return;
    }
    const n = ++explainSeq;
    const timer = setTimeout(async () => {
      try {
        const r = await get<QueryExplanation>('/api/query/explain', params);
        if (n === explainSeq) explanation = r;
      } catch {
        if (n === explainSeq) explanation = null;
      }
    }, 250);
    return () => clearTimeout(timer);
  });

  interface Result {
    total: number;
    query: string;
    mode: 'kwic' | 'bilingual';
    path: string;
    params: Record<string, string | number>;
  }

  let lines = $state.raw<ConcLine[]>([]);
  let result = $state.raw<Result | null>(null);
  // Compared by key (lineKey), never by identity: DataTable may hand back a different object.
  let selected = $state.raw<ConcLine | null>(null);
  let filter = $state('');
  // Filters inside the loaded results (client side): left/right context, or source/target in aligned mode.
  let filterA = $state('');
  let filterB = $state('');
  let loading = $state(false);
  let failed = $state(false);
  let seq = 0;
  // Fallback words for the target highlight when the server sent no marks (it normally does).
  const likelyEquiv: string[] = [];

  // Metadata and sentence of the selected hit, and the "open the document" viewer.
  let hitDoc = $state.raw<DocContext | null>(null);
  let viewerOpen = $state(false);
  let docSeq = 0;

  let detailEl: HTMLElement | undefined = $state();
  let tableEl: HTMLElement | undefined = $state();

  const hasCorpus = $derived(corpusStore.currentId !== null);
  const shown = $derived.by(() => {
    const a = fold(filterA.trim());
    const b = fold(filterB.trim());
    if (!a && !b) return lines;
    const bi = result?.mode === 'bilingual';
    return lines.filter(
      (l) => fold(bi ? l.source : l.left).includes(a) && fold(bi ? l.target : l.right).includes(b),
    );
  });
  const hitSpan = (l: ConcLine) => (l.matches?.length ? l.matches[l.matches.length - 1] - l.matches[0] + 1 : 1);
  const selIndex = $derived(selected ? shown.findIndex((x) => lineKey(x) === lineKey(selected!)) : -1);

  $effect(() => {
    const l = selected;
    const n = ++docSeq;
    if (!l) {
      hitDoc = null;
      return;
    }
    get<DocContext>(`/api/documents/${l.doc_id}/context`, { pos: l.pos, span: hitSpan(l), radius: 0 })
      .then((r) => {
        if (n === docSeq) hitDoc = r;
      })
      .catch(() => {
        if (n === docSeq) hitDoc = null; // the detail strip still shows what the line itself carries
      });
  });

  function step(delta: number): void {
    const next = shown[selIndex + delta];
    if (next) selected = next;
  }

  const docCount = $derived(new Set(lines.map((l) => l.doc_id)).size);
  const csvHref = $derived(result ? csvUrl(result.path, result.params) : '');

  const unitOptions = UNITS.map((u) => ({ value: u, label: t(`cc.unit.${u}`) }));
  const sortOptions = SORTS.map((s) => ({ value: s, label: t(`cc.sort.${s}`) }));
  const limitOptions = LIMITS.map((n) => ({ value: n, label: n }));

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

  async function search(): Promise<void> {
    const id = corpusStore.currentId;
    if (id === null) {
      messages.say(t('corpus.selectFirst'), 'err');
      return;
    }
    const query = q.trim();
    if (!query) {
      messages.say(t('cc.typeQuery'), 'err');
      return;
    }
    const w = toWidth(String(width ?? ''));
    width = w;
    const mode = bilingual && corpusStore.aligned ? 'bilingual' : 'kwic';
    const path = `/api/corpora/${id}/${mode === 'bilingual' ? 'bilingual' : 'concordance'}`;
    // Options that are off are not sent, so the request stays what it was before they existed.
    const params = {
      q: query,
      unit,
      width: w,
      sort,
      limit: Number(limit),
      ...(caseSensitive ? { case_sensitive: 'true' } : {}),
      ...(anyOrder && !advanced ? { any_order: 'true' } : {}),
      ...(advanced ? { advanced: 'true' } : {}),
      ...(accent ? { accent_insensitive: 'true' } : {}),
      ...(sampling ? { sample: seed } : {}),
      ...scopeParams(),
    };
    const n = ++seq;
    failed = false;
    loading = true; // previous rows stay visible (and selected) while loading
    messages.say(t('corpus.working'));
    try {
      const r = await get<ConcordanceResult | BilingualResult>(path, params);
      if (n !== seq) return;
      lines = r.lines;
      result = { total: r.total, query, mode, path, params };
      capped = !!r.capped;
      // Persist only a search that worked, so a failing query never reaches the URL.
      go('concordance', {
        q: query,
        unit,
        width: String(w),
        sort,
        bi: bilingual ? '1' : '',
        case: caseSensitive ? '1' : '',
        any: anyOrder ? '1' : '',
        adv: advanced ? '1' : '',
        acc: accent ? '1' : '',
        n: limit === DEFAULT_LIMIT ? '' : limit,
        sample: sampling ? String(seed) : '',
      });
      // DataTable reconciles a kept selection by key, but it is unmounted on zero hits.
      if (selected && !r.lines.some((x) => lineKey(x) === lineKey(selected!))) selected = null;
      messages.clear();
    } catch (err) {
      if (n !== seq) return;
      failed = true;
      messages.say(errMsg(err), 'err');
    } finally {
      if (n === seq) loading = false;
    }
  }

  function onsubmit(e: SubmitEvent): void {
    e.preventDefault();
    search();
  }

  function newSample(): void {
    seed = newSeed();
    search();
  }

  function reset(): void {
    seq++;
    lines = [];
    result = null;
    selected = null;
    filter = '';
    filterA = '';
    filterB = '';
    loading = false;
    failed = false;
    messages.clearWorking();
  }

  /** The text used as the term's example: the aligned segment, else the KWIC line. */
  function segmentOf(l: ConcLine): string {
    return l.source || [l.left, l.node, l.right].filter(Boolean).join(' ');
  }

  function addTermFromHit(): void {
    const l = selected;
    if (!l) return;
    const sel = window.getSelection();
    const text = (sel?.toString() ?? '').replace(/\s+/g, ' ').trim();
    const anchor = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
    // Only a selection inside the hits table or the detail strip counts.
    const inHits = !!anchor && (!!tableEl?.contains(anchor) || !!detailEl?.contains(anchor));
    const inTarget = inHits && !!anchor?.closest('[data-side="target"]');
    const usable = inHits && text.length > 0 && text.length <= 120;
    openTerm({
      source: usable && !inTarget ? text : l.node,
      target: usable && inTarget ? text : '',
      origin: 'concordance',
      example: segmentOf(l),
      exampleSource: l.doc,
    });
  }

  function addTermFromQuery(): void {
    const s = q.trim();
    if (!s) {
      messages.say(t('cc.typeQuery'), 'err');
      return;
    }
    openTerm({ source: s, origin: 'concordance' });
  }

  async function onactivate(): Promise<void> {
    await tick();
    detailEl?.focus();
  }

  // An initial route with `q` runs once the corpus (and its `aligned` flag) has loaded.
  let autoRan = false;
  $effect(() => {
    if (autoRan || !corpusStore.loaded || corpusStore.currentId === null) return;
    autoRan = true;
    if (initial.q?.trim()) untrack(search);
  });

  onMount(() => {
    window.addEventListener(CORPUS_CHANGED, reset);
    const off = registerShortcut({
      id: 'cc-add-term',
      keys: 'Mod+E',
      get label() {
          return t('shortcuts.addTerm');
        },
      when: () => selected !== null && !termStore.open,
      run: addTermFromHit,
    });
    return () => {
      window.removeEventListener(CORPUS_CHANGED, reset);
      off();
      seq++;
      messages.clearWorking();
    };
  });
</script>

{#snippet context(l: ConcLine)}
  <Highlight text={l.left} ranges={termRanges(l.left_terms)} />{l.left ? ' ' : ''}<span class="hit-query"><Highlight text={l.node} ranges={termRanges(l.node_terms)} /></span>{l.right ? ' ' : ''}<Highlight text={l.right} ranges={termRanges(l.right_terms)} />
{/snippet}

<div class="cc">
  {#if !hasCorpus}
    {#if corpusStore.loaded}<NoCorpus />{/if}
  {:else}
    <form class="cc-form" {onsubmit}>
      <Toolbar label={t('cc.toolbar')}>
        <Field label={t('cc.query')}>
          <input
            id="cc-query"
            class="query"
            bind:value={q}
            placeholder={t('cc.queryPlaceholder')}
            autocomplete="off"
            spellcheck="false"
          />
        </Field>
        <Field label={t('cc.unit')}>
          <Select label={t('cc.unit')} bind:value={unit} options={unitOptions} />
        </Field>
        <Field label={t('cc.width')}>
          <input class="width" type="number" min="2" max="40" bind:value={width} />
        </Field>
        <Field label={t('cc.sort')}>
          <Select label={t('cc.sort')} bind:value={sort} options={sortOptions} />
        </Field>
        <Field label={t('cc.limit')}>
          <Select label={t('cc.limit')} bind:value={limit} options={limitOptions} />
        </Field>
        <span class="switch" title={t('cc.caseHint')}>
          <Toggle bind:checked={caseSensitive} label={t('cc.case')} />
        </span>
        <span class="switch" title={t('cc.accentHint')}>
          <Toggle bind:checked={accent} label={t('cc.accent')} />
        </span>
        <span class="switch" title={t('cc.advancedHint')}>
          <Toggle bind:checked={advanced} label={t('cc.advanced')} />
        </span>
        {#if !advanced}
          <span class="switch" title={t('cc.anyOrderHint')}>
            <Toggle bind:checked={anyOrder} label={t('cc.anyOrder')} />
          </span>
        {/if}
        <span class="switch" title={t('cc.sampleHint')}>
          <Toggle bind:checked={sampling} label={t('cc.sample')} />
        </span>
        {#if sampling}
          <Button title={t('cc.newSampleHint')} onclick={newSample}>{t('cc.newSample')}</Button>
        {/if}
        {#if corpusStore.aligned}
          <span class="switch" title={t('cc.bilingualHint')}>
            <Toggle bind:checked={bilingual} label={t('cc.bilingual')} />
          </span>
        {/if}
        <div class="actions">
          <Button type="submit" variant="primary" pending={!result && !loading && !failed}>{t('cc.search')}</Button>
          <Button title={t('cc.addTermHint')} onclick={addTermFromQuery}>{t('cc.addTerm')}</Button>
          {#if csvHref}<a class="csv" href={csvHref} download>{t('cc.csv')}</a>{/if}
        </div>
      </Toolbar>
    </form>
    {#if advanced && explanation}
      {#if explanation.ok}
        <p class="parsed">{t('cc.parsed', { text: explanation.parsed })}</p>
      {:else}
        <p class="parsed bad" role="alert">{t('cc.queryError', { text: explanation.error })}</p>
      {/if}
    {/if}

    {#if result}
      <div class="strip">
        <span class="count">{t('cc.summary', { hits: result.total, docs: docCount })}</span>
        {#if capped}<span class="muted">{t('cc.capped')}</span>{/if}
        {#if result.total > lines.length}
          <span class="muted">({t(sampling ? 'cc.sampled' : 'cc.showing', { n: lines.length })})</span>
        {/if}
        {#if shown.length !== lines.length}
          <span class="muted">({t('cc.matchingFilters', { n: shown.length })})</span>
        {/if}
        {#if result.mode === 'bilingual'}<span class="muted">{t('cc.inAligned')}</span>{/if}
        <input
          class="ctx-filter"
          type="search"
          bind:value={filterA}
          placeholder={t(result.mode === 'bilingual' ? 'cc.filterSource' : 'cc.filterLeft')}
          aria-label={t(result.mode === 'bilingual' ? 'cc.filterSource' : 'cc.filterLeft')}
        />
        <input
          class="ctx-filter"
          type="search"
          bind:value={filterB}
          placeholder={t(result.mode === 'bilingual' ? 'cc.filterTarget' : 'cc.filterRight')}
          aria-label={t(result.mode === 'bilingual' ? 'cc.filterTarget' : 'cc.filterRight')}
        />
        <input
          class="filter"
          type="search"
          bind:value={filter}
          placeholder={t('cc.filter')}
          aria-label={t('cc.filter')}
        />
        <span class="keys">
          <kbd>↑</kbd><kbd>↓</kbd>
          <Kbd keys="Mod+E" /> {t('cc.addTermSel')}
        </span>
      </div>
    {/if}

    <div class="table" bind:this={tableEl}>
      {#if result && !lines.length && !loading}
        <EmptyState title={t('cc.noHits', { q: result.query })} hint={t('cc.noHitsHint')} />
      {:else if result || loading}
        <Kwic
          lines={shown}
          mode={result?.mode ?? 'kwic'}
          query={result?.query ?? q}
          bind:selected
          bind:filter
          {loading}
          {likelyEquiv}
          {onactivate}
          emptyText={t('cc.noFilterMatch')}
        />
      {:else}
        <ReadyHint title={t('cc.start')} hint={t('cc.startHint', { key: formatKeys('Mod+K') })} />
      {/if}
    </div>

    {#if selected}
      {@const l = selected}
      <div class="detail" tabindex="-1" bind:this={detailEl}>
        <DetailStrip title={t('cc.detail')}>
          {#snippet actions()}
            <Button onclick={() => (viewerOpen = true)}>{t('doc.open')}</Button>
            <Button title={withKeys(t('shortcuts.addTerm'), 'cc-add-term')} onclick={addTermFromHit}>{t('cc.addTermSel')} <Kbd keys="Mod+E" /></Button>
            {#if csvHref}<a class="csv" href={csvHref} download>{t('cc.csv')}</a>{/if}
          {/snippet}
          <dl>
            <dt>{t('cc.document')}</dt>
            <dd class="docname">{l.doc}</dd>
            {#if hitDoc && hitDoc.document.id === l.doc_id}
              {@const d = hitDoc.document}
              {#if d.source}<dt>{t('doc.source')}</dt><dd>{d.source}</dd>{/if}
              {#if d.author}<dt>{t('doc.author')}</dt><dd>{d.author}</dd>{/if}
              {#if d.date}<dt>{t('doc.date')}</dt><dd>{d.date}</dd>{/if}
              {#if d.text_type}<dt>{t('doc.type')}</dt><dd>{d.text_type}</dd>{/if}
              {#if d.tags.length}<dt>{t('doc.tags')}</dt><dd>{d.tags.join(', ')}</dd>{/if}
            {/if}
            {#if result?.mode === 'bilingual'}
              <dt>{t('cc.segment')}</dt>
              <dd data-side="source">
                <Highlight text={l.source ?? ''} ranges={sourceRanges(l)} />
              </dd>
              <dt>
                {t('cc.aligned')}
                {#if targetIsGuess(l, likelyEquiv)}<Badge kind="neutral" label={t('cc.guess')} />{/if}
              </dt>
              <dd data-side="target" title={targetIsGuess(l, likelyEquiv) ? t('cc.guessHint') : undefined}>
                {#if l.target}
                  <Highlight text={l.target} ranges={targetRanges(l, likelyEquiv)} />
                {:else}
                  <span class="muted">{t('cc.noTarget')}</span>
                {/if}
              </dd>
            {:else}
              <dt>{t('cc.context')}</dt>
              <dd data-side="source">{@render context(l)}</dd>
              {#if hitDoc?.blocks[0]?.text}
                <dt>{t('doc.sentence')}</dt>
                <dd>
                  <Highlight
                    text={hitDoc.blocks[0].text}
                    ranges={hitDoc.blocks[0].marks.map((m) => ({ ...m, kind: 'query' as const }))}
                  />
                </dd>
              {/if}
            {/if}
          </dl>
        </DetailStrip>
      </div>
    {/if}
  {/if}
</div>

<DocViewer
  bind:open={viewerOpen}
  hit={selected}
  index={selIndex + 1}
  total={shown.length}
  onprev={() => step(-1)}
  onnext={() => step(1)}
/>

<style>
  .cc {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .cc-form {
    display: contents;
  }
  .query {
    width: 18rem;
  }
  .width {
    width: 4.5em;
  }
  .parsed {
    margin: 0.25rem 0;
    font-size: 0.9em;
    color: var(--muted);
  }
  .parsed.bad {
    color: var(--danger);
  }
  .switch {
    align-self: center;
    margin-top: 14px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .csv {
    font-size: var(--fs-small);
  }
  .strip {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-3);
    font-size: var(--fs-small);
    border-bottom: 1px solid var(--line);
  }
  .count {
    font-weight: 600;
  }
  .muted {
    color: var(--muted);
  }
  .filter {
    width: 12rem;
    margin-left: var(--s-2);
  }
  .ctx-filter {
    width: 9rem;
  }
  .keys {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    color: var(--muted);
  }
  .table {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .table :global(.dt) {
    border-width: 0;
  }
  .detail {
    flex: none;
    max-height: 40%;
    overflow: auto;
    outline: none;
  }
  .detail :global(.strip) {
    max-height: none;
  }
  .detail:focus-visible :global(.strip) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--s-1) var(--s-3);
    margin: 0;
  }
  dt {
    color: var(--muted);
    font-size: var(--fs-small);
    font-weight: 600;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .docname {
    font-weight: 600;
  }
</style>
