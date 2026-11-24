<script lang="ts">
  import { tick } from 'svelte';
  import { get } from '../api';
  import type { ConcLine, DocContext } from '../types';
  import { t } from '../i18n';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import Highlight from './Highlight.svelte';

  interface Props {
    open: boolean;
    /** The hit to show, or null. */
    hit: ConcLine | null;
    /** Position of the hit in the list being browsed (1-based) and the list size. */
    index?: number;
    total?: number;
    onprev?: () => void;
    onnext?: () => void;
  }
  let { open = $bindable(), hit, index = 0, total = 0, onprev, onnext }: Props = $props();

  const STEP = 3;
  let radius = $state(STEP);
  let ctx = $state.raw<DocContext | null>(null);
  let error = $state('');
  let loading = $state(false);
  let seq = 0;
  let bodyEl: HTMLElement | undefined = $state();

  const span = $derived(
    hit?.matches?.length ? hit.matches[hit.matches.length - 1] - hit.matches[0] + 1 : 1,
  );

  // A new hit starts again from the default amount of context.
  let shownKey = '';
  $effect(() => {
    if (!open || !hit) return;
    const key = `${hit.doc_id}:${hit.pos}`;
    if (key !== shownKey) {
      shownKey = key;
      radius = STEP;
    }
  });

  $effect(() => {
    if (!open || !hit) return;
    const params = { pos: hit.pos, span, radius };
    const id = hit.doc_id;
    const n = ++seq;
    loading = true;
    error = '';
    get<DocContext>(`/api/documents/${id}/context`, params)
      .then(async (r) => {
        if (n !== seq) return;
        ctx = r;
        await tick();
        if (typeof HTMLElement.prototype.scrollIntoView === 'function') {
          bodyEl?.querySelector('.hit-block')?.scrollIntoView({ block: 'center' });
        }
      })
      .catch((e: unknown) => {
        if (n === seq) error = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        if (n === seq) loading = false;
      });
  });

  $effect(() => {
    if (!open) {
      seq++;
      ctx = null;
      shownKey = '';
    }
  });

  const aligned = $derived(!!ctx?.document.aligned);
</script>

<Dialog bind:open wide title={t('doc.title', { title: ctx?.document.title ?? hit?.doc ?? '' })}>
  <div class="nav">
    <Button disabled={!onprev || index <= 1} onclick={() => onprev?.()}>{t('doc.prev')}</Button>
    <span class="muted">{total ? t('doc.hitOf', { n: index, total }) : ''}</span>
    <Button disabled={!onnext || index >= total} onclick={() => onnext?.()}>{t('doc.next')}</Button>
  </div>
  {#if error}
    <p class="err" role="alert">{error}</p>
  {:else if !ctx}
    <p class="muted">{t('doc.loading')}</p>
  {:else}
    <div class="viewer" class:aligned bind:this={bodyEl} aria-busy={loading}>
      {#if ctx.more_before}
        <Button onclick={() => (radius += STEP)}>{t('doc.moreBefore')}</Button>
      {/if}
      {#if aligned}
        <div class="cols head"><span>{t('doc.original')}</span><span>{t('doc.translation')}</span></div>
      {/if}
      {#each ctx.blocks as b (b.n)}
        <div class="block" class:hit-block={b.hit} class:cols={aligned}>
          <p data-side="source">
            <Highlight text={b.text} ranges={b.marks.map((m) => ({ ...m, kind: 'query' as const }))} />
          </p>
          {#if aligned}<p data-side="target">{b.pair}</p>{/if}
        </div>
      {/each}
      {#if ctx.more_after}
        <Button onclick={() => (radius += STEP)}>{t('doc.moreAfter')}</Button>
      {/if}
    </div>
  {/if}
</Dialog>

<style>
  .nav {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .muted {
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .err {
    color: var(--danger);
  }
  .viewer {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    overflow: auto;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-3);
  }
  .head {
    color: var(--muted);
    font-size: var(--fs-small);
    font-weight: 600;
  }
  .block p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .hit-block {
    padding: var(--s-1) var(--s-2);
    border-left: 3px solid var(--accent);
    background: var(--surface);
  }
</style>
