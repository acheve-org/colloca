<script module lang="ts">
  interface UploadResult {
    file: string;
    ok: boolean;
    job_id?: number;
    error?: string;
  }
  const ACCEPT = '.txt,.csv,.tsv';
  const LEIPZIG = 'https://wortschatz.uni-leipzig.de/en/download';
  const RECIPE = 'https://github.com/acheve-org/corpora/blob/main/docs/base-corpora.md#recipe-a-reliable-base-corpus';
  const USES = ['keyness', 'frequency', 'collocations', 'jobs'];
  const TIPS = ['size', 'files', 'variety', 'format'];
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { del, get, post, upload } from '../api';
  import { baseSources, type BaseSource } from '../baseSources';
  import { corpusStore } from '../corpus.svelte';
  import { t, fmt } from '../i18n';
  import { JOBS_DONE, jobLogs, trackJobs } from '../jobs.svelte';
  import { messages } from '../messages.svelte';
  import type { Corpus, Doc, Job } from '../types';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';

  interface Props {
    lang: string;
    name: string;
    reference: Corpus | null;
    force: boolean;
    /** Called after the base corpus was created, deleted or finished an import, so the parent reloads. */
    onchange: () => void;
  }
  let { lang, name, reference, force, onchange }: Props = $props();

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

  let files = $state.raw<File[]>([]);
  let busy = $state(false);
  let delOpen = $state(false);
  let input: HTMLInputElement | undefined = $state();

  // Jobs are followed app-wide (lib/jobs): they keep running and counting off this screen.
  const logs = $derived<Job[]>(reference ? (jobLogs.by[reference.id] ?? []).slice(-4).reverse() : []);

  $effect(() => {
    if (reference) trackJobs(reference.id);
  });

  // The files it was built from; refetched when its size changes (an import finished, a part was removed).
  let sources = $state.raw<BaseSource[]>([]);
  $effect(() => {
    const id = reference?.id;
    void reference?.docs;
    sources = [];
    if (id === undefined) return;
    let live = true;
    get<Doc[]>(`/api/corpora/${id}/documents`)
      .then((d) => {
        if (live) sources = baseSources(d);
      })
      .catch(() => {}); // optional information: the card works without it
    return () => {
      live = false;
    };
  });

  onMount(() => {
    const onDone = (e: Event) => {
      const id = (e as CustomEvent<{ id: number }>).detail?.id;
      if (reference && id === reference.id) onchange();
    };
    window.addEventListener(JOBS_DONE, onDone);
    return () => window.removeEventListener(JOBS_DONE, onDone);
  });

  async function act(fn: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    messages.say(t('corpus.working'));
    try {
      await fn();
    } catch (err) {
      messages.say(errMsg(err), 'err');
    } finally {
      busy = false;
    }
  }

  const create = () =>
    act(async () => {
      await post('/api/references', { lang });
      messages.say(t('base.created'), 'ok');
      onchange();
      corpusStore.reload().catch((err) => messages.say(errMsg(err), 'err'));
    });

  const uploadFiles = () =>
    act(async () => {
      const r = reference;
      if (!r) return;
      if (!files.length) {
        messages.say(t('base.choose'), 'err');
        return;
      }
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const res = await upload<UploadResult[]>(`/api/corpora/${r.id}/upload`, fd, { sentences: true, force_language: force });
      files = [];
      if (input) input.value = '';
      const bad = res.filter((x) => !x.ok);
      const n = res.length - bad.length;
      if (bad.length) {
        messages.say(t('src.queuedRejected', { n, list: bad.map((b) => `${b.file} (${b.error ?? ''})`).join('; ') }), 'err');
      } else {
        messages.say(t('src.queued', { n }), 'ok');
      }
      trackJobs(r.id, true);
    });

  async function confirmDelete(): Promise<void> {
    const r = reference;
    delOpen = false;
    if (!r) return;
    await act(async () => {
      await del(`/api/corpora/${r.id}`);
      messages.say(t('base.deleted'), 'ok');
      onchange();
      corpusStore.reload().catch((err) => messages.say(errMsg(err), 'err'));
    });
  }

  function jobState(j: Job): { cls: string; text: string; pct?: number } {
    if (j.status === 'error') return { cls: 'err', text: j.error };
    if (j.status === 'done') {
      return {
        cls: 'ok',
        text: t('base.jobDone', {
          docs: Number(j.result?.documents ?? 0),
          words: fmt(Number(j.result?.tokens ?? 0)),
        }),
      };
    }
    if (j.status === 'running') {
      const pct = Math.round((j.progress || 0) * 100);
      return { cls: '', text: `${pct}%`, pct };
    }
    return { cls: 'muted', text: t('jobs.queued') };
  }
</script>

{#snippet tips()}
  <p class="tipsTitle">{t('base.tipsTitle')}</p>
  <ul class="tips">
    {#each TIPS as k (k)}<li>{t(`base.tip.${k}`)}</li>{/each}
  </ul>
  <p class="links">
    <a href={LEIPZIG} target="_blank" rel="noopener noreferrer">{t('base.leipzig')}</a>
    <span aria-hidden="true">·</span>
    <a href={RECIPE} target="_blank" rel="noopener noreferrer">{t('base.recipe')}</a>
  </p>
{/snippet}

<div class="base">
  <p class="muted">{t('base.lead', { lang: name })}</p>
  <div class="uses">
    <span class="usesLabel">{t('base.usedBy')}</span>
    <ul aria-label={t('base.usedBy')}>
      {#each USES as k (k)}<li class="chip">{t(`base.use.${k}`)}</li>{/each}
    </ul>
  </div>
  {#if !reference}
    <div class="guide">{@render tips()}</div>
    <p class="muted">{t('base.none')}</p>
    <div>
      <Button variant="primary" disabled={busy} onclick={create}>{t('base.create', { lang: name })}</Button>
    </div>
  {:else}
    <p>
      <b>{reference.name}</b><br />
      <span class="muted">{t('base.stats', { docs: fmt(reference.docs), words: fmt(reference.tokens) })}</span>
    </p>
    {#if sources.length}
      <div>
        <p class="tipsTitle">{t('base.builtFrom')}</p>
        <ul class="sources">
          {#each sources as s (s.source)}
            <li>
              <span class="src">{s.source}</span>
              <span class="muted">{t('base.stats', { docs: fmt(s.parts), words: fmt(s.words) })}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    <details class="guide">
      <summary>{t('base.howTo')}</summary>
      {@render tips()}
    </details>
    <input
      bind:this={input}
      type="file"
      multiple
      accept={ACCEPT}
      aria-label={t('base.files')}
      onchange={(e) => (files = [...(e.currentTarget.files ?? [])])}
    />
    <div class="row">
      <Button variant="primary" disabled={busy} onclick={uploadFiles}>{t('base.upload')}</Button>
      <Button variant="danger" disabled={busy} onclick={() => (delOpen = true)}>{t('common.delete')}</Button>
    </div>
    {#if logs.length}
      <ul class="jobs" aria-live="polite" aria-label={t('jobs.label')}>
        {#each logs as j (j.id)}
          {@const s = jobState(j)}
          <li class="job">
            <span class="jlabel">{j.label}</span>
            {#if s.pct !== undefined}<progress max="100" value={s.pct}></progress>{/if}
            <span class={s.cls}>{s.text}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<Dialog bind:open={delOpen} title={t('base.confirmTitle')}>
  <p class="confirm">{t('base.confirmBody', { name: reference?.name ?? '' })}</p>
  {#snippet footer()}
    <Button onclick={() => (delOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={confirmDelete}>{t('common.delete')}</Button>
  {/snippet}
</Dialog>

<style>
  .base {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
  }
  .base p {
    margin: 0;
  }
  .uses {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-1);
    font-size: var(--fs-small);
  }
  .uses ul {
    display: contents;
    list-style: none;
  }
  .usesLabel {
    color: var(--muted);
  }
  .chip {
    padding: 1px var(--s-2);
    border-radius: 999px;
    border: 1px solid var(--line);
  }
  .guide {
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    font-size: var(--fs-small);
  }
  .guide summary {
    cursor: pointer;
    color: var(--accent);
  }
  .guide[open] summary {
    margin-bottom: var(--s-1);
  }
  .tipsTitle {
    font-weight: 600;
    font-size: var(--fs-small);
  }
  .tips {
    margin: var(--s-1) 0;
    padding-left: 1.2rem;
  }
  .links a {
    color: var(--accent);
  }
  .sources {
    margin: var(--s-1) 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--fs-small);
  }
  .sources li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--s-2);
    padding: 2px 0;
    border-bottom: 1px solid var(--line);
  }
  .src {
    overflow-wrap: anywhere;
  }
  .base input[type='file'] {
    height: auto;
    padding: var(--s-1);
    max-width: 100%;
  }
  .row {
    display: flex;
    gap: var(--s-2);
  }
  .muted {
    color: var(--muted);
  }
  .jobs {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--fs-small);
  }
  .job {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .jlabel {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  progress {
    width: 8rem;
    accent-color: var(--accent);
  }
  .err {
    color: var(--danger);
  }
  .ok {
    color: var(--status-approved);
  }
  .confirm {
    margin: 0;
  }
</style>
