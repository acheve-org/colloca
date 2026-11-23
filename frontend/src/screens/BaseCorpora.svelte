<script module lang="ts">
  interface UploadResult {
    file: string;
    ok: boolean;
    job_id?: number;
    error?: string;
  }
  const ACCEPT = '.txt,.csv,.tsv';
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { del, get, post, upload } from '../lib/api';
  import { corpusStore } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import { watchJobs } from '../lib/jobs.svelte';
  import { messages } from '../lib/messages.svelte';
  import type { Corpus, Job, Languages } from '../lib/types';
  import Button from '../lib/ui/Button.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';

  const uid = $props.id();
  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

  let langs = $state.raw<Languages>({});
  let refs = $state.raw<Corpus[]>([]);
  let loadedOnce = $state(false);
  let force = $state(false);
  let files = $state.raw<Record<number, File[]>>({});
  let logs = $state.raw<Record<number, Job[]>>({});
  let busy = $state<string | null>(null);
  let delOpen = $state(false);
  let toDelete = $state.raw<Corpus | null>(null);
  const inputs: Record<number, HTMLInputElement | undefined> = $state({});

  // One jobs watcher per base corpus, alive while this screen is mounted.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- stop functions, not state
  const watchers = new Map<number, () => void>();
  let seq = 0;
  let mounted = true;

  const cards = $derived(
    Object.entries(langs).map(([lang, name]) => ({ lang, name, ref: refs.find((r) => r.lang === lang) ?? null })),
  );

  async function load(): Promise<void> {
    const n = ++seq;
    try {
      const [l, r] = await Promise.all([
        Object.keys(langs).length ? Promise.resolve(langs) : get<Languages>('/api/languages'),
        get<Corpus[]>('/api/references'),
      ]);
      if (n !== seq || !mounted) return;
      langs = l;
      refs = r;
      loadedOnce = true;
      syncWatchers();
    } catch (err) {
      if (n !== seq) return;
      messages.say(errMsg(err), 'err');
    }
  }

  function syncWatchers(): void {
    for (const [id, stop] of watchers) {
      if (!refs.some((r) => r.id === id)) {
        stop();
        watchers.delete(id);
      }
    }
    for (const r of refs) if (!watchers.has(r.id)) watch(r.id, false);
  }

  function watch(id: number, started: boolean): void {
    if (!mounted) return;
    watchers.get(id)?.();
    watchers.set(
      id,
      watchJobs(
        id,
        () => {
          load();
          corpusStore.reload().catch((err) => messages.say(errMsg(err), 'err'));
        },
        { started, onUpdate: (list) => (logs = { ...logs, [id]: list.slice(-4).reverse() }) },
      ),
    );
  }

  async function act(name: string, fn: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = name;
    messages.say(t('corpus.working'));
    try {
      await fn();
    } catch (err) {
      messages.say(errMsg(err), 'err');
    } finally {
      busy = null;
    }
  }

  const create = (lang: string) =>
    act(`create-${lang}`, async () => {
      await post('/api/references', { lang });
      messages.say(t('base.created'), 'ok');
      await load();
      corpusStore.reload().catch((err) => messages.say(errMsg(err), 'err'));
    });

  const uploadFiles = (r: Corpus) =>
    act(`upload-${r.id}`, async () => {
      const chosen = files[r.id] ?? [];
      if (!chosen.length) {
        messages.say(t('base.choose'), 'err');
        return;
      }
      const fd = new FormData();
      for (const f of chosen) fd.append('files', f);
      const res = await upload<UploadResult[]>(`/api/corpora/${r.id}/upload`, fd, { sentences: true, force_language: force });
      files = { ...files, [r.id]: [] };
      const input = inputs[r.id];
      if (input) input.value = '';
      const bad = res.filter((x) => !x.ok);
      const n = res.length - bad.length;
      if (bad.length) {
        messages.say(t('src.queuedRejected', { n, list: bad.map((b) => `${b.file} (${b.error ?? ''})`).join('; ') }), 'err');
      } else {
        messages.say(t('src.queued', { n }), 'ok');
      }
      watch(r.id, true);
    });

  function askDelete(r: Corpus): void {
    toDelete = r;
    delOpen = true;
  }

  async function confirmDelete(): Promise<void> {
    const r = toDelete;
    delOpen = false;
    if (!r) return;
    await act(`delete-${r.id}`, async () => {
      await del(`/api/corpora/${r.id}`);
      watchers.get(r.id)?.();
      watchers.delete(r.id);
      logs = { ...logs, [r.id]: [] };
      messages.say(t('base.deleted'), 'ok');
      await load();
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
          words: Number(j.result?.tokens ?? 0).toLocaleString(),
        }),
      };
    }
    if (j.status === 'running') {
      const pct = Math.round((j.progress || 0) * 100);
      return { cls: '', text: `${pct}%`, pct };
    }
    return { cls: 'muted', text: t('jobs.queued') };
  }

  onMount(() => {
    load();
    return () => {
      mounted = false;
      seq++;
      for (const stop of watchers.values()) stop();
      watchers.clear();
    };
  });
</script>

<div class="base">
  <p class="intro">{t('base.intro')}</p>
  <div class="force"><Toggle bind:checked={force} label={t('src.force')} /></div>

  {#if loadedOnce}
    <div class="cards">
      {#each cards as c (c.lang)}
        <section class="card" aria-labelledby="{uid}-{c.lang}">
          <h3 id="{uid}-{c.lang}">{c.name}</h3>
          {#if !c.ref}
            <p class="muted">{t('base.none')}</p>
            <div>
              <Button variant="primary" disabled={busy !== null} onclick={() => create(c.lang)}>
                {t('base.create', { lang: c.name })}
              </Button>
            </div>
          {:else}
            {@const r = c.ref}
            <p>
              <b>{r.name}</b><br />
              <span class="muted">{t('base.stats', { docs: r.docs.toLocaleString(), words: r.tokens.toLocaleString() })}</span>
            </p>
            <input
              bind:this={inputs[r.id]}
              type="file"
              multiple
              accept={ACCEPT}
              aria-label={t('base.files')}
              onchange={(e) => (files = { ...files, [r.id]: [...(e.currentTarget.files ?? [])] })}
            />
            <div class="row">
              <Button variant="primary" disabled={busy !== null} onclick={() => uploadFiles(r)}>{t('base.upload')}</Button>
              <Button variant="danger" disabled={busy !== null} onclick={() => askDelete(r)}>{t('common.delete')}</Button>
            </div>
            {#if logs[r.id]?.length}
              <ul class="jobs" aria-live="polite" aria-label={t('jobs.label')}>
                {#each logs[r.id] as j (j.id)}
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
        </section>
      {/each}
    </div>
  {/if}

  <p class="hint">
    {t('base.filesHint')}
    <a href="https://wortschatz.uni-leipzig.de/en/download" target="_blank" rel="noopener noreferrer">{t('base.leipzig')}</a>
    {t('base.filesHint2')}
  </p>
</div>

<Dialog bind:open={delOpen} title={t('base.confirmTitle')}>
  <p class="confirm">{t('base.confirmBody', { name: toDelete?.name ?? '' })}</p>
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
    padding: var(--s-3);
    overflow: auto;
  }
  .intro,
  .hint {
    max-width: 60rem;
    margin: 0;
    color: var(--muted);
  }
  .hint {
    font-size: var(--fs-small);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: var(--s-3);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .card p {
    margin: 0;
  }
  .card input[type='file'] {
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
