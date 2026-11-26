<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { ApiError, get } from '../lib/api';
  import { findText } from '../lib/findText';
  import { fmt, t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import { route } from '../lib/router.svelte';
  import type { Doc, DocBlocks, Facets } from '../lib/types';
  import Badge from '../lib/ui/Badge.svelte';
  import Button from '../lib/ui/Button.svelte';
  import ReadyHint from '../lib/ui/ReadyHint.svelte';
  import EditDocumentDialog from './EditDocumentDialog.svelte';

  const PAGE = 100;

  type Meta = DocBlocks['document'];
  type Block = DocBlocks['blocks'][number];
  type DocRow = Pick<Doc, 'id' | 'title' | 'tags' | 'text_type' | 'doc_date' | 'author'>;
  /** A find match in one side of a block; `i` is its place among all the document's matches. */
  type Hit = { start: number; end: number; i: number };
  type Piece = { text: string; i: number | null };

  // A document of any corpus can be read: the page is read-only, so no corpus switch.
  const docId = $derived(/^\d+$/.test(route.params.doc ?? '') ? Number(route.params.doc) : null);

  let doc = $state.raw<Meta | null>(null);
  let blocks = $state.raw<Block[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let notFound = $state(false);
  // A later page that failed to load: its error, shown with Retry, and no more automatic requests until then.
  let pageError = $state<string | null>(null);
  // Edit details: the dialog works on the document row and suggests the corpus tags and text types.
  let editOpen = $state(false);
  let editing = $state.raw<Doc | null>(null);
  let facets = $state.raw<Facets>({ tags: [], text_types: [], date_min: '', date_max: '' });
  // Answers for a document left behind (or a page asked before it) are dropped.
  let seq = 0;
  // The page request on its way, so that loading the whole document waits for it instead of asking twice.
  let inflight: Promise<void> | null = null;
  let loadingAll = false;

  // Find in document: the query, and which match is current.
  let query = $state('');
  let current = $state(0);
  let textEl = $state<HTMLElement>();

  const more = $derived(doc !== null && blocks.length < total);
  const metaParts = $derived(
    doc ? [doc.text_type, doc.date, t('src.words', { n: fmt(doc.tokens) }), doc.source].filter(Boolean) : [],
  );

  const finding = $derived(query.trim() !== '');
  // Matches are counted once the whole document is loaded, in reading order (source, then translation).
  const hits = $derived.by(() => {
    const byBlock: Record<number, { text: Hit[]; pair: Hit[] }> = {};
    if (!finding || more) return { byBlock, count: 0 };
    let count = 0;
    const mark = (s: string) => findText(s, query).map((m) => ({ ...m, i: count++ }));
    for (const b of blocks) {
      const text = mark(b.text);
      const pair = mark(b.pair);
      if (text.length || pair.length) byBlock[b.n] = { text, pair };
    }
    return { byBlock, count };
  });
  const findStatus = $derived(
    !finding || more ? '' : hits.count ? t('reader.findCount', { n: current + 1, total: hits.count }) : t('reader.findNone'),
  );

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const fail = (err: unknown) => messages.say(errMsg(err), 'err');

  function requestPage(id: number, n: number, from: number): Promise<void> {
    const p = fetchPage(id, n, from).finally(() => {
      if (inflight === p) inflight = null;
    });
    inflight = p;
    return p;
  }

  async function fetchPage(id: number, n: number, from: number): Promise<void> {
    loading = true;
    pageError = null;
    try {
      const r = await get<DocBlocks>(`/api/documents/${id}/blocks`, { start: from, limit: PAGE });
      if (n !== seq) return;
      doc = r.document;
      blocks = [...blocks, ...r.blocks];
      total = r.total;
    } catch (err) {
      if (n !== seq) return;
      if (err instanceof ApiError && err.status === 404) notFound = true;
      else if (from > 0) pageError = errMsg(err);
      else fail(err);
    } finally {
      if (n === seq) loading = false;
    }
  }

  $effect(() => {
    const id = docId;
    untrack(() => {
      const n = ++seq;
      doc = null;
      blocks = [];
      total = 0;
      loading = false;
      editOpen = false;
      pageError = null;
      query = '';
      current = 0;
      inflight = null;
      notFound = id === null;
      if (id !== null) void requestPage(id, n, 0);
    });
  });

  function loadMore(): void {
    if (loading || !more || pageError !== null || docId === null) return;
    void requestPage(docId, seq, blocks.length);
  }

  function retryPage(): void {
    if (loading || docId === null) return;
    void requestPage(docId, seq, blocks.length);
  }

  /** Every remaining page, one request at a time, so that find counts the whole document. */
  async function loadAll(): Promise<void> {
    if (loadingAll) return;
    loadingAll = true;
    const n = seq;
    try {
      while (n === seq && docId !== null && more && pageError === null) {
        await (inflight ?? requestPage(docId, n, blocks.length));
      }
    } finally {
      loadingAll = false;
    }
  }

  // The first query loads the rest of the document (and again after a Retry).
  $effect(() => {
    if (finding && more && pageError === null) untrack(() => void loadAll());
  });

  // The current match is scrolled into view.
  $effect(() => {
    const i = current;
    if (!hits.count || !textEl) return;
    const root = textEl;
    void tick().then(() => root.querySelector(`mark[data-hit="${i}"]`)?.scrollIntoView?.({ block: 'center' }));
  });

  function onFindKey(e: KeyboardEvent): void {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const n = hits.count;
    if (n) current = (current + (e.shiftKey ? n - 1 : 1)) % n;
  }

  /** The text cut into plain runs and matches. */
  function pieces(text: string, hs: Hit[]): Piece[] {
    const out: Piece[] = [];
    let pos = 0;
    for (const h of hs) {
      if (h.start > pos) out.push({ text: text.slice(pos, h.start), i: null });
      out.push({ text: text.slice(h.start, h.end), i: h.i });
      pos = h.end;
    }
    if (pos < text.length) out.push({ text: text.slice(pos), i: null });
    return out;
  }

  // The sentinel after the last block asks for the next page as it comes into view. Watching again after
  // each page makes a sentinel that is still in view (a short page) ask for the one after.
  let sentinel = $state<HTMLElement>();
  $effect(() => {
    const el = sentinel;
    void blocks.length;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  });

  /** A Doc for the dialog: only the fields it edits are real. */
  const forEdit = (r: DocRow): Doc => ({
    id: r.id, title: r.title, tags: r.tags, text_type: r.text_type, doc_date: r.doc_date, author: r.author,
    source: '', kind: '', n_tokens: 0, pipeline: '', lang_check: '', added: '', segmented: 0, pair_doc_id: null,
    chars: 0, stale: false,
  });

  async function openEdit(): Promise<void> {
    const d = doc;
    if (!d) return;
    const n = seq;
    try {
      const [row, f] = await Promise.all([
        get<DocRow>(`/api/documents/${d.id}`),
        get<Facets>(`/api/corpora/${d.corpus_id}/facets`),
      ]);
      if (n !== seq) return;
      editing = forEdit(row);
      facets = f;
      editOpen = true;
    } catch (err) {
      if (n === seq) fail(err);
    }
  }

  async function reloadMeta(): Promise<void> {
    const d = doc;
    if (!d) return;
    const n = seq;
    try {
      const r = await get<DocBlocks>(`/api/documents/${d.id}/blocks`, { start: 0, limit: 1 });
      if (n === seq) doc = r.document;
    } catch (err) {
      if (n === seq) fail(err);
    }
  }
</script>

{#snippet marked(text: string, hs: Hit[] | undefined)}
  {#if hs?.length}{#each pieces(text, hs) as p, k (k)}{#if p.i === null}{p.text}{:else}<mark class:current={p.i === current} data-hit={p.i}>{p.text}</mark>{/if}{/each}{:else}{text}{/if}
{/snippet}

<div class="page">
  {#if notFound}
    <div class="missing"><ReadyHint title={t('reader.notFound')} /></div>
  {:else if doc}
    <div class="rhead">
      <h2>{doc.title}</h2>
      <div class="tools">
        <span class="find">
          <input
            type="search"
            bind:value={query}
            oninput={() => (current = 0)}
            onkeydown={onFindKey}
            placeholder={t('reader.find')}
            aria-label={t('reader.find')}
          />
          <span class="find-count" aria-live="polite">{findStatus}</span>
        </span>
        <Button onclick={openEdit}>{t('src.edit')}</Button>
      </div>
    </div>
    <p class="meta">
      {#each metaParts as m, i (i)}<span>{m}</span>{/each}
      {#if doc.aligned}<Badge kind="approved" label={t('src.check.aligned')} />{/if}
    </p>
    <div class="text" bind:this={textEl}>
      {#if doc.aligned}
        <ol class="pairs">
          {#each blocks as b (b.n)}
            {@const h = hits.byBlock[b.n]}
            <li class="row">
              <span class="n">{b.n + 1}</span>
              <span class="seg">{@render marked(b.text, h?.text)}</span>
              <span class="seg">{@render marked(b.pair, h?.pair)}</span>
            </li>
          {/each}
        </ol>
      {:else}
        <div class="prose">
          {#each blocks as b (b.n)}<p>{@render marked(b.text, hits.byBlock[b.n]?.text)}</p>{/each}
        </div>
      {/if}
      {#if more && pageError === null}<div class="sentinel" bind:this={sentinel} aria-hidden="true"></div>{/if}
      {#if pageError !== null}
        <p class="page-error" role="alert">
          <span>{pageError}</span>
          <Button onclick={retryPage}>{t('reader.retry')}</Button>
        </p>
      {/if}
      <p class="loading" role="status">{loading && blocks.length ? t('reader.loadingMore') : ''}</p>
    </div>
  {/if}
</div>

<EditDocumentDialog bind:open={editOpen} doc={editing} {facets} onsaved={reloadMeta} />

<style>
  .page {
    padding-bottom: var(--s-6);
  }
  .missing {
    padding: var(--s-4) var(--page-pad);
  }
  .rhead {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: var(--s-3);
    padding: var(--s-4) var(--page-pad) var(--s-2);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-h1);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .tools {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .find {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .find input {
    width: 12rem;
  }
  .find-count {
    color: var(--muted);
    font-size: var(--fs-small);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  mark {
    background: var(--hit-query-bg);
    color: var(--hit-query-fg);
    border-radius: var(--radius);
  }
  mark.current {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-1) var(--s-3);
    margin: 0;
    padding: 0 var(--page-pad) var(--s-3);
    font-size: var(--fs-small);
    color: var(--muted);
    border-bottom: 1px solid var(--line);
  }
  .text {
    padding: var(--s-4) var(--page-pad) 0;
  }
  .prose {
    max-width: 72ch;
  }
  .prose p {
    margin: 0 0 var(--s-3);
    line-height: 1.6;
  }
  .pairs {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: grid;
    grid-template-columns: 2.5rem minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--s-3);
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--line);
  }
  .seg {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .n {
    color: var(--muted);
    font-size: var(--fs-small);
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 639px) {
    .row {
      grid-template-columns: 1fr;
      gap: var(--s-1);
    }
  }
  .page-error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    margin: var(--s-3) 0 0;
    color: var(--status-forbidden);
    font-size: var(--fs-small);
  }
  .sentinel {
    height: 1px;
  }
  .loading {
    margin: var(--s-2) 0 0;
    text-align: center;
    color: var(--muted);
    font-size: var(--fs-small);
  }
</style>
