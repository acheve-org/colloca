<script module lang="ts">
  interface TrashCorpus {
    id: number;
    name: string;
    lang: string;
    docs: number;
    deleted_at: string;
  }
  interface TrashDoc {
    id: number;
    title: string;
    corpus: string;
    aligned: number;
    partner: string | null;
    deleted_at: string;
  }
  interface TrashTerm {
    id: number;
    src_term: string;
    tgt_term: string;
    project: string | null;
    deleted_at: string;
  }
  interface TrashList {
    retention_days: number;
    corpora: TrashCorpus[];
    documents: TrashDoc[];
    terms: TrashTerm[];
  }
  interface ImportReport {
    dry_run: boolean;
    created: Record<string, number>;
    existing: Record<string, number>;
    rejected: number;
    conflicts: { kind: string; message: string }[];
    conflict_count: number;
    jobs: { corpus_id: number; job_id: number }[];
  }
  type Kind = 'corpus' | 'document' | 'term';
  const KEYS = ['projects', 'corpora', 'documents', 'terms', 'links'];
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { del, get, post, upload } from '../lib/api';
  import { corpusStore } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import { projectStore, reloadProjects } from '../lib/projects.svelte';
  import Button from '../lib/ui/Button.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';

  const uid = $props.id();
  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

  let data = $state.raw<TrashList>({ retention_days: 30, corpora: [], documents: [], terms: [] });
  let busy = $state(false);
  let days = $state(30);
  let confirm = $state.raw<{ kind: Kind | 'all'; id?: number; label: string } | null>(null);
  let confirmOpen = $state(false);
  const total = $derived(data.corpora.length + data.documents.length + data.terms.length);

  // import
  let file = $state.raw<File | null>(null);
  let projectId = $state('');
  let annotate = $state(true);
  let report = $state.raw<ImportReport | null>(null);
  let exportProject = $state('');
  let exportPass = $state('');
  let importPass = $state('');

  async function load(): Promise<void> {
    try {
      data = await get<TrashList>('/api/trash');
      days = data.retention_days;
    } catch (err) {
      messages.say(errMsg(err), 'err');
    }
  }

  async function refreshApp(): Promise<void> {
    await Promise.all([corpusStore.reload(), reloadProjects()]);
  }

  async function act(fn: () => Promise<unknown>, done?: string): Promise<void> {
    busy = true;
    try {
      await fn();
      if (done) messages.say(done, 'ok');
    } catch (err) {
      messages.say(errMsg(err), 'err');
    } finally {
      busy = false;
    }
    await load();
    await refreshApp().catch(() => {});
  }

  const restore = (kind: Kind, id: number) =>
    act(() => post('/api/trash/restore', { kind, ids: [id] }), t('trash.restored'));

  function askForever(kind: Kind | 'all', label: string, id?: number): void {
    confirm = { kind, id, label };
    confirmOpen = true;
  }

  async function confirmForever(): Promise<void> {
    const c = confirm;
    confirmOpen = false;
    if (!c) return;
    await act(
      () =>
        c.kind === 'all'
          ? del('/api/trash?confirm=true')
          : post('/api/trash/delete', { kind: c.kind, ids: [c.id] }),
      t('trash.deleted'),
    );
  }

  const saveDays = () =>
    act(() => put('/api/trash/settings', { retention_days: Number(days) }), t('trash.saved'));

  async function put(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
    return res.json();
  }

  async function runImport(dry: boolean): Promise<void> {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('dry_run', String(dry));
    form.append('annotate', String(annotate));
    if (projectId) form.append('project_id', projectId);
    if (importPass) form.append('passphrase', importPass);
    busy = true;
    try {
      report = await upload<ImportReport>('/api/import', form);
      if (!dry) {
        messages.say(t('bk.imported'), 'ok');
        await refreshApp();
      }
    } catch (err) {
      report = null;
      messages.say(errMsg(err), 'err');
    } finally {
      busy = false;
    }
  }

  const download = (href: string) => {
    window.location.href = href;
  };

  /** An encrypted export: a POST (the passphrase never travels in a URL), saved from the response. */
  async function downloadEncrypted(projectId?: string): Promise<void> {
    if (exportPass.length < 8) {
      messages.say(t('bk.passShort'), 'err');
      return;
    }
    busy = true;
    try {
      const res = await fetch('/api/backup/encrypted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: exportPass, ...(projectId ? { project_id: Number(projectId) } : {}) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
      const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'colloca-backup.zip.enc';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      messages.say(t('bk.encrypted', { name }), 'ok');
    } catch (err) {
      messages.say(errMsg(err), 'err');
    } finally {
      busy = false;
    }
  }
  const backupAll = () => (exportPass ? downloadEncrypted() : download('/api/backup'));
  const backupProject = () => (exportPass ? downloadEncrypted(exportProject) : download(`/api/projects/${exportProject}/export`));

  onMount(() => {
    load();
  });
</script>

<div class="trash">
  <section aria-labelledby="{uid}-bk">
    <h3 id="{uid}-bk">{t('bk.title')}</h3>
    <p class="muted">{t('bk.intro')}</p>
    <div class="row">
      <Button variant="primary" disabled={busy} onclick={backupAll}>{t('bk.database')}</Button>
      <select bind:value={exportProject} aria-label={t('bk.project')}>
        <option value="">{t('bk.chooseProject')}</option>
        {#each projectStore.list as p (p.id)}
          <option value={String(p.id)}>{p.name}</option>
        {/each}
      </select>
      <Button disabled={!exportProject || busy} onclick={backupProject}>
        {t('bk.exportProject')}
      </Button>
    </div>
    <div class="row">
      <input
        type="password"
        bind:value={exportPass}
        autocomplete="new-password"
        aria-label={t('bk.passphrase')}
        placeholder={t('bk.passphrasePlaceholder')}
      />
      <span class="muted">{t('bk.passphraseHint')}</span>
    </div>

    <h4>{t('bk.importTitle')}</h4>
    <div class="row">
      <input
        type="file"
        accept=".zip,.json,.enc"
        aria-label={t('bk.file')}
        onchange={(e) => {
          file = e.currentTarget.files?.[0] ?? null;
          report = null;
        }}
      />
      <select bind:value={projectId} aria-label={t('bk.intoProject')}>
        <option value="">{t('bk.asInFile')}</option>
        {#each projectStore.list as p (p.id)}
          <option value={String(p.id)}>{t('bk.into', { name: p.name })}</option>
        {/each}
      </select>
      <Toggle bind:checked={annotate} label={t('bk.annotate')} />
      <input
        type="password"
        bind:value={importPass}
        autocomplete="off"
        aria-label={t('bk.importPassphrase')}
        placeholder={t('bk.importPassphrase')}
      />
    </div>
    <div class="row">
      <Button disabled={!file || busy} onclick={() => runImport(true)}>{t('bk.check')}</Button>
      <Button variant="primary" disabled={!file || busy} onclick={() => runImport(false)}>{t('bk.import')}</Button>
    </div>
    {#if report}
      <div class="report" role="status" aria-live="polite">
        <p>
          <b>{report.dry_run ? t('bk.reportDry') : t('bk.reportDone')}</b>
          {#each KEYS as k (k)}
            <span class="chip">{t(`bk.k.${k}`)}: +{report.created[k] ?? 0} / {report.existing[k] ?? 0} {t('bk.existing')}</span>
          {/each}
          {#if report.rejected}<span class="chip err">{t('bk.rejected', { n: report.rejected })}</span>{/if}
        </p>
        {#if report.conflicts.length}
          <ul>
            {#each report.conflicts as c, i (i)}<li>{c.message}</li>{/each}
          </ul>
          {#if report.conflict_count > report.conflicts.length}
            <p class="muted">{t('bk.more', { n: report.conflict_count - report.conflicts.length })}</p>
          {/if}
        {:else}
          <p class="muted">{t('bk.noConflicts')}</p>
        {/if}
      </div>
    {/if}
  </section>

  <section aria-labelledby="{uid}-tr">
    <h3 id="{uid}-tr">{t('trash.title')}</h3>
    <p class="muted">{t('trash.intro', { days: data.retention_days })}</p>
    <div class="row">
      <label for="{uid}-days">{t('trash.keep')}</label>
      <input id="{uid}-days" type="number" min="0" max="3650" bind:value={days} />
      <span class="muted">{t('trash.daysHint')}</span>
      <Button disabled={busy} onclick={saveDays}>{t('common.save')}</Button>
      <span class="grow"></span>
      <Button variant="danger" disabled={busy || total === 0} onclick={() => askForever('all', t('trash.everything'))}>
        {t('trash.empty')}
      </Button>
    </div>

    {#if total === 0}
      <p class="muted">{t('trash.nothing')}</p>
    {/if}

    {#if data.corpora.length}
      <h4>{t('trash.corpora')}</h4>
      <table>
        <thead><tr><th>{t('trash.name')}</th><th>{t('trash.docs')}</th><th>{t('trash.when')}</th><th></th></tr></thead>
        <tbody>
          {#each data.corpora as c (c.id)}
            <tr>
              <td>{c.name} <span class="muted">({c.lang})</span></td>
              <td>{c.docs}</td>
              <td>{c.deleted_at}</td>
              <td class="act">
                <Button disabled={busy} onclick={() => restore('corpus', c.id)}>{t('trash.restore')}</Button>
                <Button variant="danger" disabled={busy} onclick={() => askForever('corpus', c.name, c.id)}>{t('trash.forever')}</Button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if data.documents.length}
      <h4>{t('trash.documents')}</h4>
      <table>
        <thead><tr><th>{t('trash.name')}</th><th>{t('trash.corpus')}</th><th>{t('trash.when')}</th><th></th></tr></thead>
        <tbody>
          {#each data.documents as d (d.id)}
            <tr>
              <td>
                {d.title}
                {#if d.aligned}<span class="muted">· {t('trash.aligned', { title: d.partner ?? '' })}</span>{/if}
              </td>
              <td>{d.corpus}</td>
              <td>{d.deleted_at}</td>
              <td class="act">
                <Button disabled={busy} onclick={() => restore('document', d.id)}>{t('trash.restore')}</Button>
                <Button variant="danger" disabled={busy} onclick={() => askForever('document', d.title, d.id)}>{t('trash.forever')}</Button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if data.terms.length}
      <h4>{t('trash.terms')}</h4>
      <table>
        <thead><tr><th>{t('trash.name')}</th><th>{t('trash.project')}</th><th>{t('trash.when')}</th><th></th></tr></thead>
        <tbody>
          {#each data.terms as x (x.id)}
            <tr>
              <td>{x.src_term}{x.tgt_term ? ` → ${x.tgt_term}` : ''}</td>
              <td>{x.project ?? t('trash.general')}</td>
              <td>{x.deleted_at}</td>
              <td class="act">
                <Button disabled={busy} onclick={() => restore('term', x.id)}>{t('trash.restore')}</Button>
                <Button variant="danger" disabled={busy} onclick={() => askForever('term', x.src_term, x.id)}>{t('trash.forever')}</Button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</div>

<Dialog bind:open={confirmOpen} title={t('trash.confirmTitle')}>
  <p class="confirm">{t('trash.confirmBody', { name: confirm?.label ?? '' })}</p>
  {#snippet footer()}
    <Button onclick={() => (confirmOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={confirmForever}>{t('trash.forever')}</Button>
  {/snippet}
</Dialog>

<style>
  .trash {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    padding: var(--s-3);
    overflow: auto;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    max-width: 70rem;
  }
  h3,
  h4,
  p {
    margin: 0;
  }
  h4 {
    margin-top: var(--s-2);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
  }
  .grow {
    flex: 1;
  }
  .muted {
    color: var(--muted);
  }
  .act {
    display: flex;
    gap: var(--s-1);
    justify-content: flex-end;
  }
  input[type='number'] {
    width: 5rem;
  }
  input[type='file'] {
    height: auto;
    padding: var(--s-1);
    max-width: 100%;
  }
  .report {
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    font-size: var(--fs-small);
  }
  .report ul {
    margin: var(--s-1) 0 0;
    padding-left: var(--s-4);
  }
  .chip {
    margin-left: var(--s-2);
    white-space: nowrap;
  }
  .err {
    color: var(--danger);
  }
</style>
