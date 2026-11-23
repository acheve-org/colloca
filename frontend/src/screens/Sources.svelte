<script module lang="ts">
  interface UploadResult {
    file: string;
    ok: boolean;
    job_id?: number;
    error?: string;
  }
  interface Preview {
    source: string;
    title: string;
    text: string;
  }
  interface Meta {
    tags: string;
    text_type: string;
    doc_date: string;
    author: string;
  }
  type EditForm = Meta & { title: string };

  const UPLOAD_ACCEPT = '.docx,.pdf,.txt,.md,.html,.htm';
  const PAIRS_ACCEPT = '.tmx,.tsv,.csv,.docx';
  const LANG_BADGE: Record<string, string> = { mismatch: 'src.check.mismatch', uncertain: 'src.check.uncertain' };

  const emptyFacets = () => ({ tags: [], text_types: [], date_min: '', date_max: '' });
  const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;
</script>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { del, get, patch, post, upload } from '../lib/api';
  import { CORPUS_CHANGED, corpusStore } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import { watchJobs } from '../lib/jobs.svelte';
  import { messages } from '../lib/messages.svelte';
  import { projectStore, reloadProjects } from '../lib/projects.svelte';
  import type { Doc, Facets, Job } from '../lib/types';
  import Badge from '../lib/ui/Badge.svelte';
  import Button from '../lib/ui/Button.svelte';
  import DataTable from '../lib/ui/DataTable.svelte';
  import { cellValue, type Column } from '../lib/ui/DataTable.types';
  import DetailStrip from '../lib/ui/DetailStrip.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import Toolbar from '../lib/ui/Toolbar.svelte';

  const uid = $props.id();
  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const hasCorpus = $derived(corpusStore.currentId !== null);

  // Documents table
  let docs = $state.raw<Doc[]>([]);
  // Compared by key (id) inside DataTable, never by identity.
  let selected = $state.raw<Doc | null>(null);
  let filter = $state('');
  let loading = $state(false);
  let loadedOnce = $state(false);
  let facets = $state.raw<Facets>(emptyFacets());
  let jobLog = $state.raw<Job[]>([]);
  let tableEl: HTMLElement | undefined = $state();
  let seq = 0;
  let stopJobs: (() => void) | null = null;

  // What is being sent; the matching buttons are disabled meanwhile.
  let busy = $state<string | null>(null);

  // Corpus settings
  let setName = $state('');
  let setProject = $state('');

  // Metadata applied to the documents added next, and the language override.
  let meta = $state<Meta>({ tags: '', text_type: '', doc_date: '', author: '' });
  let force = $state(false);
  const metaSummary = $derived(
    [
      meta.tags.trim() && t('src.meta.sumTags', { v: meta.tags.trim() }),
      meta.text_type.trim() && t('src.meta.sumType', { v: meta.text_type.trim() }),
      meta.doc_date.trim() && t('src.meta.sumDate', { v: meta.doc_date.trim() }),
      meta.author.trim() && t('src.meta.sumAuthor', { v: meta.author.trim() }),
    ]
      .filter(Boolean)
      .join(' · '),
  );

  // URL card
  let url = $state('');
  let preview = $state<Preview | null>(null);
  const previewWords = $derived(preview ? countWords(preview.text) : 0);

  // Upload card
  let files = $state.raw<File[]>([]);
  let fileInput: HTMLInputElement | undefined = $state();
  let pairFile = $state.raw<File | null>(null);
  let pairInput: HTMLInputElement | undefined = $state();
  let partner = $state('');
  let pairName = $state('');
  let swap = $state(false);

  // Paste card
  let pasteTitle = $state('');
  let pasteText = $state('');

  // Dialogs
  let editOpen = $state(false);
  let editing = $state.raw<Doc | null>(null);
  let form = $state<EditForm>({ title: '', tags: '', text_type: '', doc_date: '', author: '' });
  let delOpen = $state(false);
  let toDelete = $state.raw<Doc | null>(null);

  const projectOptions = $derived([
    { value: '', label: t('src.noProject') },
    ...projectStore.list.map((p) => ({ value: String(p.id), label: p.name })),
  ]);

  const partnerOptions = $derived.by(() => {
    const cur = corpusStore.current;
    const others = cur ? corpusStore.list.filter((c) => c.id !== cur.id && c.lang !== cur.lang) : [];
    return [
      ...others.map((c) => ({ value: String(c.id), label: `${c.name} [${c.lang}]` })),
      { value: 'new', label: t('src.pair.newCorpus') },
    ];
  });
  $effect(() => {
    if (!partnerOptions.some((o) => o.value === partner)) partner = partnerOptions[0].value;
  });

  // The settings follow the current corpus (as the old tab did after every reload).
  const settingsKey = $derived.by(() => {
    const c = corpusStore.current;
    return c ? `${c.id}\u0001${c.name}\u0001${c.project_id ?? ''}` : '';
  });
  $effect(() => {
    void settingsKey;
    untrack(() => {
      const c = corpusStore.current;
      setName = c?.name ?? '';
      setProject = c?.project_id ? String(c.project_id) : '';
    });
  });

  const staleCount = $derived(docs.filter((d) => d.stale).length);
  const count = $derived(docs.length === 1 ? t('src.count1') : t('src.count', { n: docs.length }));

  function checks(d: Doc): { kind: 'candidate' | 'neutral' | 'approved'; label: string; title: string }[] {
    const out: { kind: 'candidate' | 'neutral' | 'approved'; label: string; title: string }[] = [];
    if (LANG_BADGE[d.lang_check]) {
      out.push({ kind: 'candidate', label: t(LANG_BADGE[d.lang_check]), title: t('src.check.langHint', { v: d.lang_check }) });
    }
    if (d.stale) out.push({ kind: 'neutral', label: t('src.check.stale'), title: d.pipeline });
    if (d.segmented && d.pair_doc_id) out.push({ kind: 'approved', label: t('src.check.aligned'), title: t('src.check.alignedHint') });
    return out;
  }

  const columns: Column<Doc>[] = [
    { key: 'title', label: t('src.col.title'), width: 'minmax(12rem, 2fr)', value: (d) => `${d.title} ${d.author}` },
    { key: 'text_type', label: t('src.col.type'), width: '8rem' },
    { key: 'doc_date', label: t('src.col.date'), width: '6.5rem' },
    { key: 'tags', label: t('src.col.tags'), width: 'minmax(8rem, 1fr)', value: (d) => d.tags.join(', ') },
    { key: 'n_tokens', label: t('src.col.words'), num: true, width: '6rem' },
    { key: 'checks', label: t('src.col.checks'), width: '10rem', value: (d) => checks(d).map((c) => c.label).join(' ') },
  ];

  // ---------------------------------------------------------------- loading
  async function loadDocs(): Promise<void> {
    const id = corpusStore.currentId;
    if (id === null) return;
    const n = ++seq;
    loading = true; // previous rows stay visible (and selected) while loading
    try {
      const rows = await get<Doc[]>(`/api/corpora/${id}/documents`);
      if (n !== seq) return;
      docs = rows;
      loadedOnce = true;
      if (selected) selected = rows.find((r) => r.id === selected!.id) ?? null;
    } catch (err) {
      if (n !== seq) return;
      messages.say(errMsg(err), 'err');
    } finally {
      if (n === seq) loading = false;
    }
  }

  async function loadFacets(): Promise<void> {
    const id = corpusStore.currentId;
    if (id === null) return;
    try {
      const f = await get<Facets>(`/api/corpora/${id}/facets`);
      if (corpusStore.currentId === id) facets = f;
    } catch {
      // facets only feed the suggestions
    }
  }

  function refresh(): void {
    loadDocs();
    loadFacets();
  }

  /** Follows the jobs of the current corpus; `started` after submitting one. */
  function watch(started: boolean): void {
    stopJobs?.();
    stopJobs = null;
    const id = corpusStore.currentId;
    if (id === null) return;
    stopJobs = watchJobs(
      id,
      () => {
        if (corpusStore.currentId !== id) return;
        refresh();
        corpusStore.reload().catch((err) => messages.say(errMsg(err), 'err'));
      },
      {
        started,
        onUpdate: (list) => {
          if (corpusStore.currentId === id) jobLog = list.slice(-8).reverse();
        },
      },
    );
  }

  function start(): void {
    refresh();
    watch(false);
  }

  function onCorpusChanged(): void {
    autoRan = true;
    seq++;
    loading = false;
    docs = [];
    selected = null;
    filter = '';
    loadedOnce = false;
    facets = emptyFacets();
    jobLog = [];
    preview = null;
    busy = null;
    stopJobs?.();
    stopJobs = null;
    if (corpusStore.currentId !== null) start();
  }

  let autoRan = false;
  $effect(() => {
    if (autoRan || !corpusStore.loaded || corpusStore.currentId === null) return;
    autoRan = true;
    untrack(start);
  });

  onMount(() => {
    window.addEventListener(CORPUS_CHANGED, onCorpusChanged);
    reloadProjects().catch((err) => messages.say(errMsg(err), 'err'));
    return () => {
      window.removeEventListener(CORPUS_CHANGED, onCorpusChanged);
      stopJobs?.();
      stopJobs = null;
      seq++;
    };
  });

  // ---------------------------------------------------------------- actions
  /** Runs an action for the current corpus; nothing is applied if the corpus changed meanwhile. */
  async function act(name: string, fn: (id: number) => Promise<void>): Promise<void> {
    const id = corpusStore.currentId;
    if (id === null) {
      messages.say(t('corpus.selectFirst'), 'err');
      return;
    }
    if (busy) return;
    busy = name;
    messages.say(t('corpus.working'));
    try {
      await fn(id);
    } catch (err) {
      if (corpusStore.currentId === id) messages.say(errMsg(err), 'err');
    } finally {
      if (busy === name) busy = null;
    }
  }

  const still = (id: number) => corpusStore.currentId === id;
  const metaParams = () => ({ ...meta });

  function reportUpload(res: UploadResult[]): void {
    const bad = res.filter((r) => !r.ok);
    const n = res.length - bad.length;
    if (bad.length) {
      const list = bad.map((b) => `${b.file} (${b.error ?? ''})`).join('; ');
      messages.say(t('src.queuedRejected', { n, list }), 'err');
    } else {
      messages.say(t('src.queued', { n }), 'ok');
    }
  }

  const saveSettings = () =>
    act('settings', async (id) => {
      await patch(`/api/corpora/${id}`, { name: setName.trim(), project_id: setProject ? Number(setProject) : null });
      if (!still(id)) return;
      messages.say(t('src.corpusSaved'), 'ok');
      await Promise.all([reloadProjects(), corpusStore.reload()]);
    });

  const fetchPreview = () =>
    act('preview', async (id) => {
      const u = url.trim();
      if (!u) {
        messages.say(t('src.url.needed'), 'err');
        return;
      }
      const r = await post<{ url: string; title: string; text: string }>('/api/preview-url', { url: u });
      if (!still(id)) return;
      preview = { source: r.url, title: r.title, text: r.text };
      messages.clear();
    });

  const addPreview = () =>
    act('add', async (id) => {
      const p = preview;
      if (!p) return;
      await post(
        `/api/corpora/${id}/documents`,
        { title: p.title, text: p.text, source: p.source, kind: 'url', ...metaParams() },
        { background: true, force_language: force },
      );
      if (!still(id)) return;
      preview = null;
      url = '';
      messages.say(t('src.queuedProgress'), 'ok');
      watch(true);
    });

  const uploadFiles = () =>
    act('upload', async (id) => {
      if (!files.length) {
        messages.say(t('src.upload.choose'), 'err');
        return;
      }
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const res = await upload<UploadResult[]>(`/api/corpora/${id}/upload`, fd, { force_language: force, ...metaParams() });
      if (!still(id)) return;
      files = [];
      if (fileInput) fileInput.value = '';
      reportUpload(res);
      watch(true);
    });

  const uploadPairs = () =>
    act('pairs', async (id) => {
      const f = pairFile;
      if (!f) {
        messages.say(t('src.pair.choose'), 'err');
        return;
      }
      if (partner === 'new' && !pairName.trim()) {
        messages.say(t('src.pair.nameNeeded'), 'err');
        return;
      }
      const fd = new FormData();
      fd.append('files', f);
      const target = partner === 'new' ? { partner_name: pairName.trim() } : { partner_corpus_id: partner };
      const res = await upload<UploadResult[]>(`/api/corpora/${id}/upload-pairs`, fd, {
        ...target,
        swap,
        force_language: force,
        ...metaParams(),
      });
      if (!still(id)) return;
      pairFile = null;
      pairName = '';
      if (pairInput) pairInput.value = '';
      const bad = res.filter((r) => !r.ok);
      if (bad.length) messages.say(t('src.pair.rejected', { error: bad[0].error ?? '' }), 'err');
      else messages.say(t('src.queuedProgress'), 'ok');
      watch(true);
    });

  const addPaste = () =>
    act('paste', async (id) => {
      if (!pasteText.trim()) {
        messages.say(t('src.paste.needed'), 'err');
        return;
      }
      await post(
        `/api/corpora/${id}/documents`,
        { title: pasteTitle.trim() || t('src.paste.defaultTitle'), text: pasteText, kind: 'paste', ...metaParams() },
        { background: true, force_language: force },
      );
      if (!still(id)) return;
      pasteText = '';
      pasteTitle = '';
      messages.say(t('src.queuedProgress'), 'ok');
      watch(true);
    });

  const reannotate = () =>
    act('reann', async (id) => {
      await post(`/api/corpora/${id}/reannotate`, undefined, { only_stale: true });
      if (!still(id)) return;
      messages.say(t('src.reann.started'), 'ok');
      watch(true);
    });

  function openEdit(d: Doc): void {
    editing = d;
    form = { title: d.title, tags: d.tags.join(', '), text_type: d.text_type, doc_date: d.doc_date, author: d.author };
    editOpen = true;
  }

  async function saveEdit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const d = editing;
    if (!d || !form.title.trim()) return;
    const before: EditForm = { title: d.title, tags: d.tags.join(', '), text_type: d.text_type, doc_date: d.doc_date, author: d.author };
    const changed = Object.fromEntries(
      (Object.keys(before) as (keyof EditForm)[]).filter((k) => form[k] !== before[k]).map((k) => [k, form[k]]),
    );
    if (!Object.keys(changed).length) {
      editOpen = false;
      return;
    }
    await act('edit', async (id) => {
      await patch(`/api/documents/${d.id}`, changed);
      if (!still(id)) return;
      editOpen = false;
      messages.say(t('src.docUpdated'), 'ok');
      refresh();
    });
  }

  function askDelete(d: Doc): void {
    toDelete = d;
    delOpen = true;
  }

  async function confirmDelete(): Promise<void> {
    const d = toDelete;
    delOpen = false;
    if (!d) return;
    await act('delete', async (id) => {
      seq++; // a list response in flight predates the delete
      loading = false;
      await del(`/api/documents/${d.id}`);
      if (!still(id)) return;
      docs = docs.filter((x) => x.id !== d.id);
      if (selected?.id === d.id) selected = null;
      messages.say(t('src.docRemoved'), 'ok');
      loadFacets();
      corpusStore.reload().catch((err) => messages.say(errMsg(err), 'err'));
      await tick();
      tableEl?.querySelector<HTMLElement>('[role="grid"]')?.focus();
    });
  }

  function jobState(j: Job): { cls: string; text: string; pct?: number } {
    if (j.status === 'error') return { cls: 'err', text: j.error };
    if (j.status === 'done') {
      const segs = Number(j.result?.segments ?? 0);
      const warnings = Array.isArray(j.result?.warnings) ? (j.result.warnings as string[]) : [];
      let text = t('jobs.done');
      if (segs) text += ` — ${t('src.job.segments', { n: segs })}`;
      if (warnings.length) text += ` — ${warnings.join(' ')}`;
      return { cls: 'ok', text };
    }
    if (j.status === 'running') {
      const pct = Math.round((j.progress || 0) * 100);
      return { cls: '', text: `${pct}%`, pct };
    }
    return { cls: 'muted', text: t('jobs.queued') };
  }
</script>

{#snippet cell(d: Doc, col: Column<Doc>)}
  {#if col.key === 'title'}
    <span class="title" title={d.source}>
      <span>{d.title}</span>
      {#if d.author}<span class="muted">{d.author}</span>{/if}
    </span>
  {:else if col.key === 'doc_date'}
    <span class="muted">{d.doc_date}</span>
  {:else if col.key === 'tags'}
    <span class="badges">{#each d.tags as tag (tag)}<Badge kind="neutral" label={tag} />{/each}</span>
  {:else if col.key === 'n_tokens'}
    {d.n_tokens.toLocaleString()}
  {:else if col.key === 'checks'}
    <span class="badges">
      {#each checks(d) as c (c.label)}<span title={c.title}><Badge kind={c.kind} label={c.label} /></span>{/each}
    </span>
  {:else}
    {cellValue(d, col)}
  {/if}
{/snippet}

{#snippet jobRow(j: Job)}
  {@const s = jobState(j)}
  <li class="job">
    <span class="jlabel">{j.label}</span>
    {#if s.pct !== undefined}<progress max="100" value={s.pct}></progress>{/if}
    <span class={s.cls}>{s.text}</span>
  </li>
{/snippet}

<div class="sources">
  {#if !hasCorpus}
    {#if corpusStore.loaded}<EmptyState title={t('corpus.selectFirst')} />{/if}
  {:else}
    <div class="scroll">
      <form
        class="contents"
        onsubmit={(e) => {
          e.preventDefault();
          saveSettings();
        }}
      >
        <Toolbar label={t('src.settings')}>
          <Field label={t('src.corpusName')}>
            <input bind:value={setName} required maxlength="120" size="26" />
          </Field>
          <Field label={t('src.project')}>
            <Select label={t('src.project')} bind:value={setProject} options={projectOptions} />
          </Field>
          <Button type="submit" disabled={busy !== null || !setName.trim()}>{t('src.saveCorpus')}</Button>
        </Toolbar>
      </form>

      <details class="meta">
        <summary>
          {t('src.meta.summary')}
          {#if metaSummary}<span class="on">{metaSummary}</span>{:else}<span class="muted">{t('src.meta.optional')}</span>{/if}
        </summary>
        <div class="row">
          <Field label={t('src.meta.tags')}>
            <input bind:value={meta.tags} list="{uid}-tags" placeholder={t('src.meta.tagsPlaceholder')} size="18" />
          </Field>
          <Field label={t('src.meta.type')}>
            <input bind:value={meta.text_type} list="{uid}-types" placeholder={t('src.meta.typePlaceholder')} size="12" />
          </Field>
          <Field label={t('src.meta.date')}>
            <input bind:value={meta.doc_date} placeholder={t('src.meta.datePlaceholder')} size="10" />
          </Field>
          <Field label={t('src.meta.author')}>
            <input bind:value={meta.author} size="14" />
          </Field>
        </div>
        <p class="hint">{t('src.meta.hint')}</p>
      </details>
      <datalist id="{uid}-tags">
        {#each facets.tags as x (x.tag)}<option value={x.tag}>{t('filter.docs', { docs: x.docs })}</option>{/each}
      </datalist>
      <datalist id="{uid}-types">
        {#each facets.text_types as x (x.text_type)}<option value={x.text_type}></option>{/each}
      </datalist>

      <div class="force"><Toggle bind:checked={force} label={t('src.force')} /></div>

      {#if jobLog.length}
        <ul class="jobs" aria-live="polite" aria-label={t('jobs.label')}>
          {#each jobLog as j (j.id)}{@render jobRow(j)}{/each}
        </ul>
      {/if}

      <div class="cards">
        <section class="card" aria-labelledby="{uid}-url">
          <h3 id="{uid}-url">{t('src.url.title')}</h3>
          <form
            class="row"
            onsubmit={(e) => {
              e.preventDefault();
              fetchPreview();
            }}
          >
            <input class="grow" type="url" bind:value={url} placeholder="https://…" aria-label={t('src.url.address')} />
            <Button type="submit" disabled={busy !== null}>{t('src.url.fetch')}</Button>
          </form>
          {#if preview}
            <Field label={t('src.url.pvTitle')}>
              <input bind:value={preview.title} />
            </Field>
            <Field label={t('src.url.pvText')}>
              <textarea rows="10" bind:value={preview.text}></textarea>
            </Field>
            <div class="row">
              <span class="muted grow">{previewWords === 1 ? t('src.word1') : t('src.words', { n: previewWords.toLocaleString() })}</span>
              <Button onclick={() => (preview = null)}>{t('src.url.discard')}</Button>
              <Button variant="primary" disabled={busy !== null || !preview.text.trim()} onclick={addPreview}>{t('src.url.add')}</Button>
            </div>
            <p class="hint">{t('src.url.hint')}</p>
          {/if}
        </section>

        <section class="card" aria-labelledby="{uid}-up">
          <h3 id="{uid}-up">{t('src.upload.title')}</h3>
          <input
            bind:this={fileInput}
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            aria-label={t('src.upload.files')}
            onchange={(e) => (files = [...(e.currentTarget.files ?? [])])}
          />
          <div class="row">
            <span class="hint grow">{t('src.upload.hint')}</span>
            <Button variant="primary" disabled={busy !== null} onclick={uploadFiles}>{t('src.upload.go')}</Button>
          </div>

          <h3 class="sub">{t('src.pair.title')}</h3>
          <input
            bind:this={pairInput}
            type="file"
            accept={PAIRS_ACCEPT}
            aria-label={t('src.pair.file')}
            onchange={(e) => (pairFile = e.currentTarget.files?.[0] ?? null)}
          />
          <Field label={t('src.pair.partner')}>
            <Select label={t('src.pair.partner')} bind:value={partner} options={partnerOptions} />
          </Field>
          {#if partner === 'new'}
            <input bind:value={pairName} maxlength="120" placeholder={t('src.pair.namePlaceholder')} aria-label={t('src.pair.name')} />
          {/if}
          <Toggle bind:checked={swap} label={t('src.pair.swap')} />
          <div class="row">
            <span class="grow"></span>
            <Button variant="primary" disabled={busy !== null} onclick={uploadPairs}>{t('src.pair.go')}</Button>
          </div>
          <p class="hint">{t('src.pair.hint')}</p>
        </section>

        <section class="card" aria-labelledby="{uid}-paste">
          <h3 id="{uid}-paste">{t('src.paste.title')}</h3>
          <input bind:value={pasteTitle} placeholder={t('src.paste.titlePlaceholder')} aria-label={t('src.paste.titleLabel')} />
          <textarea rows="6" bind:value={pasteText} aria-label={t('src.paste.text')}></textarea>
          <div class="row">
            <span class="grow"></span>
            <Button disabled={busy !== null} onclick={addPaste}>{t('src.paste.go')}</Button>
          </div>
        </section>
      </div>
    </div>

    <div class="strip">
      <h3>{t('src.documents')}</h3>
      {#if loadedOnce}<span class="count">{count}</span>{/if}
      {#if docs.length}
        <input class="filter" type="search" bind:value={filter} placeholder={t('cc.filter')} aria-label={t('cc.filter')} />
      {/if}
      <Button onclick={refresh}>{t('src.reload')}</Button>
      {#if staleCount}
        <span class="stale">
          <span class="muted">{staleCount === 1 ? t('src.reann.info1') : t('src.reann.info', { n: staleCount })}</span>
          <Button disabled={busy !== null} onclick={reannotate}>{t('src.reann.go')}</Button>
        </span>
      {/if}
    </div>

    <div class="table" bind:this={tableEl}>
      {#if loadedOnce && !docs.length && !loading}
        <EmptyState title={t('src.empty')} hint={t('src.emptyHint')} />
      {:else}
        <DataTable
          {columns}
          rows={docs}
          rowKey={(d) => d.id}
          bind:selected
          bind:filter
          {loading}
          {cell}
          onactivate={openEdit}
          emptyText={t('src.noFilterMatch')}
        />
      {/if}
    </div>

    {#if selected}
      {@const d = selected}
      <div class="detail">
        <DetailStrip title={t('src.detail')}>
          {#snippet actions()}
            <Button disabled={busy !== null} onclick={() => openEdit(d)}>{t('src.edit')}</Button>
            {#if d.stale}
              <Button disabled={busy !== null} title={t('src.reann.hint')} onclick={reannotate}>{t('src.reann.short')}</Button>
            {/if}
            <Button variant="danger" disabled={busy !== null} onclick={() => askDelete(d)}>{t('src.remove')}</Button>
          {/snippet}
          <dl>
            <dt>{t('src.col.title')}</dt>
            <dd>{d.title}</dd>
            {#if d.author}<dt>{t('src.meta.author')}</dt><dd>{d.author}</dd>{/if}
            {#if d.source}<dt>{t('src.source')}</dt><dd class="mono">{d.source}</dd>{/if}
            <dt>{t('src.kind')}</dt>
            <dd>{d.kind}</dd>
            {#if d.text_type}<dt>{t('src.col.type')}</dt><dd>{d.text_type}</dd>{/if}
            {#if d.doc_date}<dt>{t('src.col.date')}</dt><dd>{d.doc_date}</dd>{/if}
            {#if d.tags.length}<dt>{t('src.col.tags')}</dt><dd>{d.tags.join(', ')}</dd>{/if}
            <dt>{t('src.size')}</dt>
            <dd>{t('src.sizeValue', { words: d.n_tokens.toLocaleString(), chars: d.chars.toLocaleString() })}</dd>
            <dt>{t('src.model')}</dt>
            <dd>{d.pipeline}{d.stale ? ` (${t('src.check.stale')})` : ''}</dd>
            <dt>{t('src.langCheck')}</dt>
            <dd>{d.lang_check}</dd>
            {#if d.segmented && d.pair_doc_id}<dt>{t('src.check.aligned')}</dt><dd>{t('src.check.alignedHint')}</dd>{/if}
            <dt>{t('src.added')}</dt>
            <dd>{d.added}</dd>
          </dl>
        </DetailStrip>
      </div>
    {/if}
  {/if}
</div>

<Dialog bind:open={editOpen} title={t('src.editTitle')}>
  {#if editOpen}
    <form id="{uid}-edit" class="dlg-form" onsubmit={saveEdit}>
      <Field label={t('src.col.title')}><input bind:value={form.title} required maxlength="300" /></Field>
      <Field label={t('src.meta.tags')}>
        <input bind:value={form.tags} list="{uid}-tags" placeholder={t('src.edit.tagsPlaceholder')} />
      </Field>
      <Field label={t('src.edit.type')}>
        <input bind:value={form.text_type} list="{uid}-types" placeholder={t('src.edit.typePlaceholder')} />
      </Field>
      <Field label={t('src.col.date')}>
        <input bind:value={form.doc_date} placeholder={t('src.edit.datePlaceholder')} size="12" />
      </Field>
      <Field label={t('src.meta.author')}><input bind:value={form.author} /></Field>
    </form>
  {/if}
  {#snippet footer()}
    <Button onclick={() => (editOpen = false)}>{t('common.cancel')}</Button>
    <button type="submit" form="{uid}-edit" class="primary" disabled={!form.title.trim() || busy !== null}>{t('common.save')}</button>
  {/snippet}
</Dialog>

<Dialog bind:open={delOpen} title={t('src.confirmTitle')}>
  <p class="confirm">{t('src.confirmBody', { title: toDelete?.title ?? '' })}</p>
  {#snippet footer()}
    <Button onclick={() => (delOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={confirmDelete}>{t('src.remove')}</Button>
  {/snippet}
</Dialog>

<style>
  .sources {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .scroll {
    flex: none;
    max-height: 55%;
    overflow: auto;
    border-bottom: 1px solid var(--line);
  }
  .contents {
    display: contents;
  }
  .meta {
    padding: var(--s-1) var(--s-3);
    border-bottom: 1px solid var(--line);
    font-size: var(--fs-small);
  }
  .meta summary {
    cursor: pointer;
    font-weight: 600;
  }
  .meta summary span {
    margin-left: var(--s-2);
    font-weight: normal;
  }
  .on {
    color: var(--accent);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--s-2);
  }
  .meta .row {
    padding-top: var(--s-2);
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .hint {
    margin: var(--s-1) 0 0;
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .force {
    padding: var(--s-1) var(--s-3);
  }
  .jobs {
    margin: 0;
    padding: var(--s-1) var(--s-3);
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
  .muted {
    color: var(--muted);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: var(--s-3);
    padding: var(--s-3);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
  }
  .card :global(.field) {
    display: flex;
  }
  .card .sub {
    margin-top: var(--s-2);
    padding-top: var(--s-2);
    border-top: 1px solid var(--line);
  }
  .card input[type='file'] {
    height: auto;
    padding: var(--s-1);
    max-width: 100%;
  }
  textarea {
    width: 100%;
  }
  .strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-3);
    font-size: var(--fs-small);
    border-bottom: 1px solid var(--line);
  }
  .count {
    font-weight: 600;
  }
  .filter {
    width: 14rem;
  }
  .stale {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    margin-left: auto;
  }
  .table {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 8rem;
  }
  .table :global(.dt) {
    border-width: 0;
  }
  .title {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
    min-width: 0;
  }
  .title .muted {
    font-size: var(--fs-small);
  }
  .badges {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }
  .detail {
    flex: none;
    max-height: 40%;
    overflow: auto;
  }
  .detail :global(.strip) {
    max-height: none;
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
  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-small);
  }
  .dlg-form {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .dlg-form :global(.field) {
    display: flex;
  }
  .confirm {
    margin: 0;
  }
</style>
