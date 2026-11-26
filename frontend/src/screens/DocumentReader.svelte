<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError, get } from '../lib/api';
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

  // A document of any corpus can be read: the page is read-only, so no corpus switch.
  const docId = $derived(/^\d+$/.test(route.params.doc ?? '') ? Number(route.params.doc) : null);

  let doc = $state.raw<Meta | null>(null);
  let blocks = $state.raw<Block[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let notFound = $state(false);
  // Edit details: the dialog works on the document row and suggests the corpus tags and text types.
  let editOpen = $state(false);
  let editing = $state.raw<Doc | null>(null);
  let facets = $state.raw<Facets>({ tags: [], text_types: [], date_min: '', date_max: '' });
  // Answers for a document left behind (or a page asked before it) are dropped.
  let seq = 0;

  const more = $derived(doc !== null && blocks.length < total);
  const metaParts = $derived(
    doc ? [doc.text_type, doc.date, t('src.words', { n: fmt(doc.tokens) }), doc.source].filter(Boolean) : [],
  );

  const fail = (err: unknown) => messages.say(err instanceof Error ? err.message : String(err), 'err');

  async function fetchPage(id: number, n: number, from: number): Promise<void> {
    loading = true;
    try {
      const r = await get<DocBlocks>(`/api/documents/${id}/blocks`, { start: from, limit: PAGE });
      if (n !== seq) return;
      doc = r.document;
      blocks = [...blocks, ...r.blocks];
      total = r.total;
    } catch (err) {
      if (n !== seq) return;
      if (err instanceof ApiError && err.status === 404) notFound = true;
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
      notFound = id === null;
      if (id !== null) void fetchPage(id, n, 0);
    });
  });

  function loadMore(): void {
    if (loading || !more || docId === null) return;
    void fetchPage(docId, seq, blocks.length);
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

<div class="page">
  {#if notFound}
    <div class="missing"><ReadyHint title={t('reader.notFound')} /></div>
  {:else if doc}
    <div class="rhead">
      <h2>{doc.title}</h2>
      <!-- Find in document (Task 7) goes before Edit details. -->
      <div class="tools"><Button onclick={openEdit}>{t('src.edit')}</Button></div>
    </div>
    <p class="meta">
      {#each metaParts as m, i (i)}<span>{m}</span>{/each}
      {#if doc.aligned}<Badge kind="approved" label={t('src.check.aligned')} />{/if}
    </p>
    <div class="text">
      {#if doc.aligned}
        <ol class="pairs">
          {#each blocks as b (b.n)}
            <li class="row"><span class="n">{b.n}</span><span>{b.text}</span><span>{b.pair}</span></li>
          {/each}
        </ol>
      {:else}
        <div class="prose">
          {#each blocks as b (b.n)}<p>{b.text}</p>{/each}
        </div>
      {/if}
      {#if more}<div class="sentinel" bind:this={sentinel} aria-hidden="true"></div>{/if}
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
    grid-template-columns: 2.5rem 1fr 1fr;
    gap: var(--s-3);
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--line);
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
