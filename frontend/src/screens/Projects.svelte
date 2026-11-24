<script lang="ts">
  import { onMount } from 'svelte';
  import { del, patch, post } from '../lib/api';
  import { corpusStore } from '../lib/corpus.svelte';
  import { fmt, t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import { projectStore, reloadProjects } from '../lib/projects.svelte';
  import type { Corpus, Project } from '../lib/types';
  import Badge from '../lib/ui/Badge.svelte';
  import Button from '../lib/ui/Button.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import NewCorpusDialog from './NewCorpusDialog.svelte';

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

  // undefined: not chosen yet, follow the working corpus; null: the "No project" entry.
  let picked = $state<number | null | undefined>(undefined);
  let newProject = $state('');
  let names = $state<Record<number, string>>({});
  let corpusNames = $state<Record<number, string>>({});
  let renamingId = $state<number | null>(null);
  let busy = $state(false);
  let newOpen = $state(false);
  let delCorpus = $state.raw<Corpus | null>(null);
  let delCorpusOpen = $state(false);
  let delProject = $state.raw<Project | null>(null);
  let delProjectOpen = $state(false);
  let target = $state('');

  onMount(() => {
    reloadProjects().catch((err) => messages.say(errMsg(err), 'err'));
  });

  const working = $derived(corpusStore.list.filter((c) => !c.is_reference));
  const projectIds = $derived(new Set(projectStore.list.map((p) => p.id)));
  const isLoose = (c: Corpus) => c.project_id == null || !projectIds.has(c.project_id);
  const loose = $derived(working.filter(isLoose));
  const selectedId = $derived.by((): number | null => {
    if (picked === null && loose.length) return null;
    if (typeof picked === 'number' && projectIds.has(picked)) return picked;
    const cur = corpusStore.current;
    if (cur && !cur.is_reference && cur.project_id != null && projectIds.has(cur.project_id)) return cur.project_id;
    return projectStore.list[0]?.id ?? null;
  });
  const selected = $derived(projectStore.list.find((p) => p.id === selectedId) ?? null);
  const shown = $derived(selected ? working.filter((c) => c.project_id === selected.id) : loose);
  const heading = $derived(t('proj.corporaOf', { name: selected?.name ?? t('ctx.noProject') }));

  const nameOf = (p: Project) => names[p.id] ?? p.name;
  const corporaLabel = (n: number) => (n === 1 ? t('proj.corpora1') : t('proj.corpora', { n }));

  async function changed(): Promise<void> {
    await reloadProjects();
    await corpusStore.reload();
  }

  async function run(fn: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      messages.say(errMsg(err), 'err');
    } finally {
      busy = false;
    }
  }

  const addProject = (e: SubmitEvent) => {
    e.preventDefault();
    const name = newProject.trim();
    if (!name) return;
    return run(async () => {
      await post('/api/projects', { name });
      newProject = '';
      messages.say(t('proj.created'), 'ok');
      await reloadProjects();
    });
  };

  const renameProject = (p: Project) =>
    run(async () => {
      const name = nameOf(p).trim();
      if (!name || name === p.name) return;
      await patch(`/api/projects/${p.id}`, { name });
      names = Object.fromEntries(Object.entries(names).filter(([k]) => k !== String(p.id)));
      messages.say(t('proj.renamed'), 'ok');
      await reloadProjects();
    });

  function askDeleteProject(p: Project): void {
    delProject = p;
    target = '';
    delProjectOpen = true;
  }

  const delTrashed = $derived(delProject?.trashed ?? 0);
  const delCount = $derived(delProject?.corpora ?? 0);
  const targets = $derived(projectStore.list.filter((p) => p.id !== delProject?.id));

  async function confirmDeleteProject(): Promise<void> {
    const p = delProject;
    delProjectOpen = false;
    if (!p) return;
    await run(async () => {
      try {
        if (target) {
          for (const c of corpusStore.list.filter((x) => x.project_id === p.id)) {
            await patch(`/api/corpora/${c.id}`, { project_id: Number(target) });
          }
          picked = Number(target);
        }
        await del(`/api/projects/${p.id}`);
        messages.say(t('proj.deleted'), 'ok');
      } finally {
        // Also after a failed move: corpora already moved must show under their new project.
        await changed();
      }
    });
  }

  const open = (c: Corpus) => run(() => corpusStore.select(c.id));

  function startRename(c: Corpus): void {
    corpusNames = { ...corpusNames, [c.id]: c.name };
    renamingId = c.id;
  }

  const renameCorpus = (c: Corpus) =>
    run(async () => {
      const name = (corpusNames[c.id] ?? c.name).trim();
      renamingId = null;
      if (!name || name === c.name) return;
      await patch(`/api/corpora/${c.id}`, { name });
      await changed();
    });

  const moveCorpus = (c: Corpus, to: string) => {
    if (!to) return;
    return run(async () => {
      await patch(`/api/corpora/${c.id}`, { project_id: Number(to) });
      await changed();
    });
  };

  function askDeleteCorpus(c: Corpus): void {
    delCorpus = c;
    delCorpusOpen = true;
  }

  async function confirmDeleteCorpus(): Promise<void> {
    const c = delCorpus;
    delCorpusOpen = false;
    if (!c) return;
    await run(async () => {
      await del(`/api/corpora/${c.id}`);
      await changed();
    });
  }

  async function created(id: number, projectId: number): Promise<void> {
    picked = projectId;
    await corpusStore.reload();
    await corpusStore.select(id);
    await reloadProjects();
  }
</script>

<div class="page">
  <h1>{t('nav.projects')}</h1>
  <div class="panes">
    <section class="left">
      <ul class="plist">
        {#each projectStore.list as p (p.id)}
          <li class:sel={p.id === selectedId}>
            <button type="button" class="pick" aria-pressed={p.id === selectedId} onclick={() => (picked = p.id)}>
              <span class="pname">{p.name}</span>
              <span class="muted">{corporaLabel(p.corpora)}</span>
            </button>
            {#if p.id === selectedId}
              <div class="edit">
                <input
                  value={nameOf(p)}
                  maxlength="120"
                  aria-label={t('proj.nameOf', { name: p.name })}
                  oninput={(e) => (names = { ...names, [p.id]: e.currentTarget.value })}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      renameProject(p);
                    }
                  }}
                />
                <Button
                  ariaLabel={t('proj.renameOf', { name: p.name })}
                  disabled={busy || !nameOf(p).trim() || nameOf(p).trim() === p.name}
                  onclick={() => renameProject(p)}>{t('proj.rename')}</Button
                >
                <Button
                  variant="danger"
                  ariaLabel={t('proj.deleteOf', { name: p.name })}
                  disabled={busy}
                  onclick={() => askDeleteProject(p)}>{t('common.delete')}</Button
                >
              </div>
            {/if}
          </li>
        {/each}
        {#if loose.length}
          <li class:sel={selectedId === null}>
            <button type="button" class="pick" aria-pressed={selectedId === null} onclick={() => (picked = null)}>
              <span class="pname">{t('ctx.noProject')}</span>
              <span class="muted">{corporaLabel(loose.length)}</span>
            </button>
          </li>
        {/if}
      </ul>
      {#if !projectStore.list.length && !loose.length}<p class="muted">{t('proj.none')}</p>{/if}
      <form class="new" onsubmit={addProject}>
        <input bind:value={newProject} maxlength="120" placeholder={t('proj.newPlaceholder')} aria-label={t('proj.new')} />
        <Button type="submit" variant="primary" disabled={busy || !newProject.trim()}>{t('proj.add')}</Button>
      </form>
    </section>

    <section class="right">
      <header>
        <h2>{heading}</h2>
        <Button variant="primary" disabled={!projectStore.list.length} onclick={() => (newOpen = true)}>{t('corpus.new')}</Button>
      </header>
      {#if shown.length}
        <table>
          <thead>
            <tr>
              <th>{t('proj.colCorpus')}</th>
              <th>{t('proj.colLang')}</th>
              <th class="num">{t('proj.colDocs')}</th>
              <th class="num">{t('proj.colWords')}</th>
              <th><span class="sr">{t('proj.colActions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {#each shown as c (c.id)}
              <tr>
                <td>
                  {#if renamingId === c.id}
                    <input
                      value={corpusNames[c.id] ?? c.name}
                      maxlength="120"
                      aria-label={t('proj.nameOf', { name: c.name })}
                      oninput={(e) => (corpusNames = { ...corpusNames, [c.id]: e.currentTarget.value })}
                      onkeydown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          renameCorpus(c);
                        } else if (e.key === 'Escape') renamingId = null;
                      }}
                    />
                  {:else}
                    {c.name}
                  {/if}
                </td>
                <td>{c.lang}</td>
                <td class="num">{fmt(c.docs)}</td>
                <td class="num">{fmt(c.tokens)}</td>
                <td class="actions">
                  {#if c.id === corpusStore.currentId}
                    <Badge kind="intb" label={t('proj.working')} />
                  {:else}
                    <Button ariaLabel={t('proj.open') + ' ' + c.name} disabled={busy} onclick={() => open(c)}>{t('proj.open')}</Button>
                  {/if}
                  {#if renamingId === c.id}
                    <Button disabled={busy} onclick={() => renameCorpus(c)}>{t('common.save')}</Button>
                  {:else}
                    <Button ariaLabel={t('proj.renameOf', { name: c.name })} disabled={busy} onclick={() => startRename(c)}>{t('proj.rename')}</Button>
                  {/if}
                  <select
                    aria-label={t('proj.moveOf', { name: c.name })}
                    disabled={busy}
                    value=""
                    onchange={(e) => moveCorpus(c, e.currentTarget.value)}
                  >
                    <option value="">{t('proj.move')}…</option>
                    {#each projectStore.list.filter((p) => p.id !== c.project_id) as p (p.id)}
                      <option value={String(p.id)}>{p.name}</option>
                    {/each}
                  </select>
                  <Button variant="danger" ariaLabel={t('proj.deleteOf', { name: c.name })} disabled={busy} onclick={() => askDeleteCorpus(c)}>{t('common.delete')}</Button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="muted">{t('corpus.none')}</p>
      {/if}
    </section>
  </div>
</div>

<NewCorpusDialog bind:open={newOpen} projectId={selectedId} oncreated={created} />

<Dialog bind:open={delCorpusOpen} title={t('corpus.delete')}>
  <p>{t('corpus.confirmDelete', { name: delCorpus?.name ?? '' })}</p>
  {#snippet footer()}
    <Button onclick={() => (delCorpusOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={confirmDeleteCorpus}>{t('common.delete')}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={delProjectOpen} title={t('proj.confirmTitle')}>
  {#if delTrashed > 0}
    <p>{t('proj.deleteTrashed', { name: delProject?.name ?? '' })}</p>
    <p><a href="#/trash" onclick={() => (delProjectOpen = false)}>{t('proj.trashLink')}</a></p>
  {:else if delCount > 0}
    <p>{delCount === 1 ? t('proj.deleteHas1', { name: delProject?.name ?? '' }) : t('proj.deleteHas', { name: delProject?.name ?? '', n: delCount })}</p>
    <select aria-label={t('proj.moveTo')} bind:value={target}>
      <option value="">{t('proj.moveTo')}</option>
      {#each targets as p (p.id)}<option value={String(p.id)}>{p.name}</option>{/each}
    </select>
  {:else}
    <p>{t('proj.confirmEmpty', { name: delProject?.name ?? '' })}</p>
  {/if}
  {#snippet footer()}
    <Button onclick={() => (delProjectOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" disabled={delTrashed > 0 || (delCount > 0 && !target)} onclick={confirmDeleteProject}>{t('common.delete')}</Button>
  {/snippet}
</Dialog>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  h1,
  h2 {
    margin: 0;
  }
  .panes {
    display: grid;
    grid-template-columns: minmax(14rem, 22rem) 1fr;
    gap: var(--s-3);
    align-items: start;
  }
  .left,
  .right {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .plist {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .plist li {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .plist li.sel {
    border-color: var(--accent);
  }
  .pick {
    display: flex;
    justify-content: space-between;
    gap: var(--s-1);
    padding: var(--s-1) var(--s-2);
    text-align: left;
    background: transparent;
    border: 0;
  }
  .pname {
    font-weight: 600;
  }
  .edit,
  .new,
  header {
    display: flex;
    align-items: center;
    gap: var(--s-1);
  }
  .edit {
    padding: 0 var(--s-2) var(--s-1);
  }
  header {
    justify-content: space-between;
  }
  .edit input,
  .new input {
    flex: 1;
    min-width: 0;
  }
  .muted {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-small);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    padding: var(--s-1) var(--s-2);
    text-align: left;
    border-bottom: 1px solid var(--line);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .num {
    text-align: right;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--s-1);
  }
</style>
