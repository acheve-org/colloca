<script module lang="ts">
  type EditForm = Meta & { title: string };

  const UPLOAD_ACCEPT = '.docx,.pdf,.odt,.rtf,.xlsx,.csv,.tsv,.xlf,.xliff,.srt,.vtt,.txt,.md,.html,.htm';
  const PAIRS_ACCEPT = '.tmx,.xlf,.xliff,.tsv,.csv,.docx';
  const LANG_BADGE: Record<string, string> = { mismatch: 'src.check.mismatch', uncertain: 'src.check.uncertain' };

  const emptyFacets = () => ({ tags: [], text_types: [], date_min: '', date_max: '' });
  const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;
</script>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { del, get, patch, post } from '../lib/api';
    import {
    act, addPaste, addPreview, addUrlList, draft, fetchPreview, findLinks, importSelected, metaSummary, pickedCount,
    pickLinks, previewFile, still, uploadFiles, uploadPairs, visibleLinks, watch, work,
    type Meta,
  } from '../lib/addDocuments.svelte';
  import { CORPUS_CHANGED, corpusStore } from '../lib/corpus.svelte';
  import { hrefFor } from '../lib/router.svelte';
  import { t, fmt } from '../lib/i18n';
  import { JOBS_DONE, jobLogs } from '../lib/jobs.svelte';
  import { messages } from '../lib/messages.svelte';
  import { projectStore, reloadProjects } from '../lib/projects.svelte';
  import type { Doc, Facets, Job, Languages, NearDupMatch, NearDupReport } from '../lib/types';
  import AlignDocuments from './AlignDocuments.svelte';
  import TmxExport from './TmxExport.svelte';
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
  // Jobs are followed app-wide (lib/jobs): leaving this screen does not stop them.
  const jobLog = $derived.by(() => {
    const id = corpusStore.currentId;
    return id === null ? [] : (jobLogs.by[id] ?? []).slice(-8).reverse();
  });
  let tableEl: HTMLElement | undefined = $state();
  let seq = 0;

  // Corpus settings
  let setName = $state('');
  let setProject = $state('');

  const previewWords = $derived(draft.preview ? countWords(draft.preview.text) : 0);
  const visible = $derived(visibleLinks());
  const nPicked = $derived(pickedCount());

  // Upload card
  let fileInput: HTMLInputElement | undefined = $state();
  let pairInput: HTMLInputElement | undefined = $state();
  // A new partner corpus needs its language when more than one other language is set up.
  let langs = $state.raw<Languages>({});
  const otherLangs = $derived(Object.keys(langs).filter((l) => l !== corpusStore.current?.lang));
  $effect(() => {
    if (!otherLangs.includes(draft.pairLang)) draft.pairLang = otherLangs[0] ?? '';
  });
  $effect(() => {
    draft.multiLang = otherLangs.length > 1;
  });

  // Dialogs
  let editOpen = $state(false);
  let editing = $state.raw<Doc | null>(null);
  let form = $state<EditForm>({ title: '', tags: '', text_type: '', doc_date: '', author: '' });
  let delOpen = $state(false);
  let toDelete = $state.raw<Doc | null>(null);

  // Near-duplicates: the decision on a held import, and the report on the whole corpus.
  let dupOpen = $state(false);
  let dupPct = $state(85);
  let dupReport = $state.raw<NearDupReport | null>(null);
  let dupBusy = $state(false);

  const matchesOf = (j: Job): NearDupMatch[] =>
    j.code === 'near_duplicate' && Array.isArray(j.result?.matches) ? (j.result.matches as NearDupMatch[]) : [];

  async function resolveJob(j: Job, action: 'import' | 'replace' | 'skip'): Promise<void> {
    await act('resolve', async (id) => {
      try {
        await post(`/api/jobs/${j.id}/resolve`, { action });
      } catch {
        messages.say(t('dup.gone'), 'err');
        return;
      }
      if (!still(id)) return;
      messages.say(t('dup.done'), 'ok');
      watch(action !== 'skip');
    });
  }

  async function findDuplicates(): Promise<void> {
    const id = corpusStore.currentId;
    if (id === null) return;
    dupBusy = true;
    try {
      const r = await get<NearDupReport>(`/api/corpora/${id}/near-duplicates`, { threshold: dupPct / 100 });
      if (corpusStore.currentId === id) dupReport = r;
    } catch (err) {
      messages.say(errMsg(err), 'err');
    } finally {
      dupBusy = false;
    }
  }

  function openDuplicates(): void {
    dupReport = null;
    dupOpen = true;
    findDuplicates();
  }

  async function removeDuplicate(d: { id: number; title: string }): Promise<void> {
    await act('delete', async (id) => {
      await del(`/api/documents/${d.id}`);
      if (!still(id)) return;
      messages.say(t('dup.removed', { title: d.title }), 'ok');
      refresh();
      corpusStore.reload().catch((err) => messages.say(errMsg(err), 'err'));
      await findDuplicates();
    });
  }

  // Real projects only; a corpus without one (should not happen) shows a disabled placeholder.
  const projectOptions = $derived([
    ...(setProject ? [] : [{ value: '', label: t('src.chooseProject'), disabled: true }]),
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
  // Like the old select (re-rendered after every reload): the first option until one is picked.
  $effect(() => {
    if (!draft.partnerPicked || !partnerOptions.some((o) => o.value === draft.partner)) draft.partner = partnerOptions[0].value;
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

  function onJobsDone(e: Event): void {
    if ((e as CustomEvent<{ id: number }>).detail?.id === corpusStore.currentId) refresh();
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
    if (corpusStore.currentId !== null) start();
  }

  let autoRan = false;
  $effect(() => {
    if (autoRan || !corpusStore.loaded || corpusStore.currentId === null) return;
    autoRan = true;
    untrack(start);
  });

  onMount(() => {
    draft.clearInputs = {
      files: () => fileInput && (fileInput.value = ''),
      pair: () => pairInput && (pairInput.value = ''),
    };
    window.addEventListener(CORPUS_CHANGED, onCorpusChanged);
    window.addEventListener(JOBS_DONE, onJobsDone);
    reloadProjects().catch((err) => messages.say(errMsg(err), 'err'));
    get<Languages>('/api/languages')
      .then((l) => (langs = l))
      .catch(() => {}); // without the list the server picks the only other language, as before
    return () => {
      window.removeEventListener(CORPUS_CHANGED, onCorpusChanged);
      window.removeEventListener(JOBS_DONE, onJobsDone);
      draft.clearInputs = {};
      seq++;
    };
  });

  // ---------------------------------------------------------------- actions
  const saveSettings = () =>
    act('settings', async (id) => {
      await patch(`/api/corpora/${id}`, { name: setName.trim(), ...(setProject ? { project_id: Number(setProject) } : {}) });
      if (!still(id)) return;
      messages.say(t('src.corpusSaved'), 'ok');
      await Promise.all([reloadProjects(), corpusStore.reload()]);
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
    if (j.code === 'skipped' || j.code === 'resolved') return { cls: 'muted', text: t(`dup.${j.code}`) };
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
    {fmt(d.n_tokens)}
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
    {#if matchesOf(j).length}
      {@const ms = matchesOf(j)}
      <div class="dup">
        <p>{t('dup.found', { n: ms.length })}</p>
        <ul>
          {#each ms as m (m.id)}
            <li>
              <strong>{t('dup.match', { title: m.title, pct: Math.round(m.similarity * 100) })}</strong>
              <span class="muted">{t('dup.shared', { shared: m.shared_units, total: m.units })}</span>
              {#if m.changed.length}
                <span class="muted">{t('dup.changed')}</span>
                <ul class="changed">{#each m.changed as c, i (i)}<li>{c}</li>{/each}</ul>
              {/if}
            </li>
          {/each}
        </ul>
        <div class="dup-actions">
          <Button disabled={work.busy !== null} onclick={() => resolveJob(j, 'import')}>{t('dup.import')}</Button>
          <Button disabled={work.busy !== null} onclick={() => resolveJob(j, 'replace')}>{t('dup.replace', { title: ms[0].title })}</Button>
          <Button disabled={work.busy !== null} onclick={() => resolveJob(j, 'skip')}>{t('dup.skip')}</Button>
        </div>
      </div>
    {/if}
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
          <Button type="submit" disabled={work.busy !== null || !setName.trim()}>{t('src.saveCorpus')}</Button>
        </Toolbar>
      </form>

      <details class="meta">
        <summary>
          {t('src.meta.summary')}
          {#if metaSummary()}<span class="on">{metaSummary()}</span>{:else}<span class="muted">{t('src.meta.optional')}</span>{/if}
        </summary>
        <div class="row">
          <Field label={t('src.meta.tags')}>
            <input bind:value={draft.meta.tags} list="{uid}-tags" placeholder={t('src.meta.tagsPlaceholder')} size="18" />
          </Field>
          <Field label={t('src.meta.type')}>
            <input bind:value={draft.meta.text_type} list="{uid}-types" placeholder={t('src.meta.typePlaceholder')} size="12" />
          </Field>
          <Field label={t('src.meta.date')}>
            <input bind:value={draft.meta.doc_date} placeholder={t('src.meta.datePlaceholder')} size="10" />
          </Field>
          <Field label={t('src.meta.author')}>
            <input bind:value={draft.meta.author} size="14" />
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

      <div class="force">
        <Toggle bind:checked={draft.force} label={t('src.force')} />
        <Button disabled={work.busy !== null || !docs.length} onclick={openDuplicates}>{t('dup.find')}</Button>
      </div>

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
            <input class="grow" type="text" inputmode="url" bind:value={draft.url} placeholder="https://…" aria-label={t('src.url.address')} />
            <Button type="submit" disabled={work.busy !== null}>{t('src.url.fetch')}</Button>
          </form>

          <h3 class="sub">{t('src.urls.title')}</h3>
          <Field label={t('src.urls.label')}>
            <textarea rows="4" bind:value={draft.urlList} placeholder="https://…" spellcheck="false"></textarea>
          </Field>
          <div class="row">
            <span class="hint grow">{t('src.urls.hint')}</span>
            <Button variant="primary" disabled={work.busy !== null} onclick={addUrlList}>{t('src.urls.go')}</Button>
          </div>

          <h3 class="sub">{t('src.catalog.title')}</h3>
          <form class="row" onsubmit={(e) => { e.preventDefault(); findLinks(); }}>
            <input class="grow" type="text" inputmode="url" bind:value={draft.catalogUrl} placeholder="https://…" aria-label={t('src.catalog.address')} />
            <Button type="submit" disabled={work.busy !== null}>{t('src.catalog.find')}</Button>
          </form>
          {#if draft.catalog}
            <div class="row">
              <input class="grow" type="text" bind:value={draft.linkFilter} placeholder={t('src.catalog.filterPlaceholder')} aria-label={t('src.catalog.filter')} />
              <Toggle bind:checked={draft.sameHostOnly} label={t('src.catalog.sameHost')} />
            </div>
            <div class="row">
              <Button onclick={() => pickLinks(visible.map((l) => l.url), true)}>{t('src.catalog.selectAll')}</Button>
              <Button onclick={() => pickLinks(visible.map((l) => l.url), false)}>{t('src.catalog.selectNone')}</Button>
              <span class="hint grow">{t('src.catalog.count', { n: nPicked, total: draft.catalog.links.length })}</span>
            </div>
            <ul class="catalog-links">
              {#each visible as l (l.url)}
                <li>
                  <label>
                    <input type="checkbox" checked={draft.picked.has(l.url)} onchange={(e) => pickLinks([l.url], e.currentTarget.checked)} />
                    <span class="ctext">{l.text}</span>
                    <small class="curl">{l.url}</small>
                  </label>
                </li>
              {/each}
            </ul>
            {#if draft.catalog.truncated}<p class="hint">{t('src.catalog.truncated')}</p>{/if}
            <div class="row">
              <span class="hint grow">{t('src.catalog.hint')}</span>
              <Button variant="primary" disabled={work.busy !== null} onclick={importSelected}>{t('src.catalog.import')}</Button>
            </div>
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
            onchange={(e) => (draft.files = [...(e.currentTarget.files ?? [])])}
          />
          <label class="field">
            {t('src.upload.columns')}
            <input type="text" bind:value={draft.textColumns} placeholder={t('src.upload.columnsHint')} />
          </label>
          <div class="row">
            <span class="hint grow">{t('src.upload.hint')}</span>
            <Button disabled={work.busy !== null || draft.files.length !== 1} title={t('src.preview.fileHint')} onclick={previewFile}>{t('src.preview.file')}</Button>
            <Button variant="primary" disabled={work.busy !== null} onclick={uploadFiles}>{t('src.upload.go')}</Button>
          </div>

          <h3 class="sub">{t('src.pair.title')}</h3>
          <input
            bind:this={pairInput}
            type="file"
            accept={PAIRS_ACCEPT}
            aria-label={t('src.pair.file')}
            onchange={(e) => (draft.pairFile = e.currentTarget.files?.[0] ?? null)}
          />
          <Field label={t('src.pair.partner')}>
            <Select label={t('src.pair.partner')} bind:value={draft.partner} options={partnerOptions} onchange={() => (draft.partnerPicked = true)} />
          </Field>
          {#if draft.partner === 'new'}
            <input bind:value={draft.pairName} maxlength="120" placeholder={t('src.pair.namePlaceholder')} aria-label={t('src.pair.name')} />
            {#if otherLangs.length > 1}
              <Select label={t('src.pair.lang')} bind:value={draft.pairLang} options={otherLangs.map((l) => ({ value: l, label: langs[l] }))} />
            {/if}
          {/if}
          <Toggle bind:checked={draft.swap} label={t('src.pair.swap')} />
          <div class="row">
            <span class="grow"></span>
            <Button variant="primary" disabled={work.busy !== null} onclick={uploadPairs}>{t('src.pair.go')}</Button>
          </div>
          <p class="hint">{t('src.pair.hint')}</p>
        </section>

        <AlignDocuments />
        <TmxExport />

        <section class="card" aria-labelledby="{uid}-paste">
          <h3 id="{uid}-paste">{t('src.paste.title')}</h3>
          <input bind:value={draft.pasteTitle} placeholder={t('src.paste.titlePlaceholder')} aria-label={t('src.paste.titleLabel')} />
          <textarea rows="6" bind:value={draft.pasteText} aria-label={t('src.paste.text')}></textarea>
          <div class="row">
            <span class="grow"></span>
            <Button disabled={work.busy !== null} onclick={addPaste}>{t('src.paste.go')}</Button>
          </div>
        </section>
      </div>

      {#if draft.preview}
        <section class="card preview" aria-labelledby="{uid}-pv">
          <h3 id="{uid}-pv">{t('src.preview.title')}: {draft.preview.source}</h3>
          {#if draft.preview.quality}
            <p class="quality" role={draft.preview.quality.level === 'good' ? undefined : 'alert'}>
              <Badge
                kind={draft.preview.quality.level === 'good' ? 'approved' : draft.preview.quality.level === 'fair' ? 'candidate' : 'forbidden'}
                label={t(`src.quality.${draft.preview.quality.level}`)}
              />
              {t('src.quality.score', { n: draft.preview.quality.score })}
            </p>
            {#if draft.preview.quality.issues.length}
              <ul class="issues">
                {#each draft.preview.quality.issues as i (i.code)}<li>{i.message}</li>{/each}
              </ul>
            {/if}
          {/if}
          {#each draft.preview.warnings.filter((w) => !draft.preview?.quality || !w.includes('may be unreliable')) as w (w)}<p class="hint">{w}</p>{/each}
          <Field label={t('src.url.pvTitle')}>
            <input bind:value={draft.preview.title} />
          </Field>
          <Field label={t('src.url.pvText')}>
            <textarea rows="10" bind:value={draft.preview.text}></textarea>
          </Field>
          <div class="row">
            <span class="muted grow">{previewWords === 1 ? t('src.word1') : t('src.words', { n: fmt(previewWords) })}</span>
            <Button onclick={() => (draft.preview = null)}>{t('src.url.discard')}</Button>
            <Button variant="primary" disabled={work.busy !== null || !draft.preview.text.trim()} onclick={addPreview}>{t('src.url.add')}</Button>
          </div>
          <p class="hint">{t('src.url.hint')}</p>
        </section>
      {/if}
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
          <Button disabled={work.busy !== null} onclick={reannotate}>{t('src.reann.go')}</Button>
        </span>
      {/if}
      <a class="addlink" href={hrefFor('sources-add')}>{t('add.add')}</a>
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
            <Button disabled={work.busy !== null} onclick={() => openEdit(d)}>{t('src.edit')}</Button>
            {#if d.stale}
              <Button disabled={work.busy !== null} title={t('src.reann.hint')} onclick={reannotate}>{t('src.reann.short')}</Button>
            {/if}
            <Button variant="danger" disabled={work.busy !== null} onclick={() => askDelete(d)}>{t('src.remove')}</Button>
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
            <dd>{t('src.sizeValue', { words: fmt(d.n_tokens), chars: fmt(d.chars) })}</dd>
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
    <button type="submit" form="{uid}-edit" class="primary" disabled={!form.title.trim() || work.busy !== null}>{t('common.save')}</button>
  {/snippet}
</Dialog>

<Dialog bind:open={dupOpen} title={t('dup.title')} wide>
  <form
    class="row"
    onsubmit={(e) => {
      e.preventDefault();
      findDuplicates();
    }}
  >
    <Field label={t('dup.threshold')}>
      <input type="number" min="50" max="100" step="1" bind:value={dupPct} />
    </Field>
    <button type="submit" disabled={dupBusy}>{t('dup.run')}</button>
  </form>
  {#if dupReport}
    <p class="muted" aria-live="polite">
      {dupReport.pairs.length
        ? t('dup.summary', { n: dupReport.pairs.length, docs: dupReport.documents })
        : t('dup.none', { n: dupReport.documents })}
    </p>
    <ul class="dup-pairs">
      {#each dupReport.pairs as p (`${p.a.id}-${p.b.id}`)}
        <li>
          <strong>{t('dup.pair', { pct: Math.round(p.similarity * 100) })}</strong>
          {#each [p.a, p.b] as d (d.id)}
            <div class="dup-doc">
              <span>{d.title} <span class="muted">({d.added}, {fmt(d.n_tokens)})</span></span>
              <Button variant="danger" disabled={work.busy !== null} onclick={() => removeDuplicate(d)}>{t('dup.remove', { title: d.title })}</Button>
            </div>
          {/each}
        </li>
      {/each}
    </ul>
  {/if}
  {#snippet footer()}
    <Button onclick={() => (dupOpen = false)}>{t('dup.close')}</Button>
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
  /* One scrolling page: the add forms, then the documents table at a usable height. */
  .sources {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .scroll {
    flex: none;
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
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-1) var(--s-3);
  }
  .job {
    flex-wrap: wrap;
  }
  .dup {
    flex-basis: 100%;
    padding: var(--s-1) 0 var(--s-2) var(--s-3);
  }
  .dup p {
    margin: 0;
  }
  .dup ul {
    margin: var(--s-1) 0;
    padding-left: var(--s-3);
  }
  .changed {
    font-style: italic;
    overflow-wrap: anywhere;
  }
  .dup-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .dup-pairs {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .dup-pairs > li {
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--line);
  }
  .dup-doc {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    padding: var(--s-1) 0;
  }
  .catalog-links {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 18rem;
    overflow: auto;
    border: 1px solid var(--line);
  }
  .catalog-links label {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-2);
  }
  .ctext {
    overflow-wrap: anywhere;
  }
  .curl {
    color: var(--muted);
    overflow-wrap: anywhere;
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
  .card.preview {
    margin: 0 var(--s-3) var(--s-3);
  }
  .quality {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin: 0;
  }
  .issues {
    margin: 0;
    padding-left: 1.2rem;
    color: var(--muted);
    font-size: var(--fs-small);
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
  /* A link that looks like the primary button. */
  .addlink {
    display: inline-flex;
    align-items: center;
    height: calc(var(--row-h) - var(--s-1));
    margin-left: auto;
    padding: 0 var(--s-2);
    background: var(--accent);
    color: var(--accent-fg);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    text-decoration: none;
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
    flex: none;
    height: max(18rem, 55vh);
  }
  .table :global(.dt) {
    border-width: 0;
  }
  /* muted cell text (author, date) stays legible on the accent background of the selected row */
  .table :global(.body.selected .muted) {
    color: var(--accent-fg);
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
