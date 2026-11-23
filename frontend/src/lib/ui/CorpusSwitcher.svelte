<script lang="ts">
  import { onMount } from 'svelte';
  import { del, get, post } from '../api';
  import { corpusStore } from '../corpus.svelte';
  import { t } from '../i18n';
  import { messages } from '../messages.svelte';
  import { inProject, projectStore, reloadProjects } from '../projects.svelte';
  import type { Corpus, Languages } from '../types';
  import ProjectsDialog from './ProjectsDialog.svelte';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import Field from './Field.svelte';
  import Select from './Select.svelte';

  let languages = $state<Languages>({});
  let newOpen = $state(false);
  let delOpen = $state(false);
  let name = $state('');
  let lang = $state('');
  let newProject = $state('');
  let projectsOpen = $state(false);

  onMount(async () => {
    reloadProjects().catch((err) => messages.say(err instanceof Error ? err.message : String(err), 'err'));
    try {
      languages = await get<Languages>('/api/languages');
      lang = Object.keys(languages)[0] ?? '';
    } catch (err) {
      messages.say(err instanceof Error ? err.message : String(err), 'err');
    }
  });

  const visible = $derived(corpusStore.list.filter((c) => inProject(c, projectStore.filter)));
  // Like the old header: grouped by project when all projects are shown.
  const groups = $derived.by(() => {
    if (projectStore.filter !== '') return null;
    const named = projectStore.list
      .map((p) => ({ label: p.name, corpora: visible.filter((c) => c.project_id === p.id) }))
      .filter((g) => g.corpora.length);
    if (!named.length) return null;
    const loose = visible.filter((c) => c.project_id == null || !projectStore.list.some((p) => p.id === c.project_id));
    return loose.length ? [...named, { label: t('corpus.noProjectGroup'), corpora: loose }] : named;
  });
  const filterOptions = $derived([
    { value: '', label: t('corpus.allProjects') },
    ...projectStore.list.map((p) => ({ value: String(p.id), label: `${p.name} (${p.corpora})` })),
    { value: 'none', label: t('corpus.noProject') },
  ]);
  const projectOptions = $derived([
    { value: '', label: t('src.noProject') },
    ...projectStore.list.map((p) => ({ value: String(p.id), label: p.name })),
  ]);

  // A corpus selected elsewhere (or moved to another project) stays visible: the filter is
  // dropped, as the old header did when selecting a corpus outside it.
  $effect(() => {
    const c = corpusStore.current;
    if (c && !inProject(c, projectStore.filter)) projectStore.filter = '';
  });

  async function onFilter(): Promise<void> {
    const c = corpusStore.current;
    if (c && inProject(c)) return;
    const next = corpusStore.list.find((x) => inProject(x));
    // No corpus in that project: show none rather than one from another project.
    if (next || c) await corpusStore.select(next?.id ?? null);
  }

  function openNew(): void {
    newProject = /^\d+$/.test(projectStore.filter) ? projectStore.filter : '';
    newOpen = true;
  }

  const pick = (e: Event) => corpusStore.select(Number((e.currentTarget as HTMLSelectElement).value));
  const langOptions = $derived(
    Object.entries(languages).map(([value, label]) => ({ value, label })),
  );
  const current = $derived(corpusStore.current);
  const canCreate = $derived(name.trim() !== '' && lang !== '');
  // The API does not report the spaCy model name yet: show the language only.
  const meta = $derived(
    current
      ? t('corpus.meta', {
          lang: languages[current.lang] ?? current.lang,
          docs: current.docs,
          words: current.tokens.toLocaleString(),
        })
      : '',
  );

  async function create(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!canCreate) return;
    try {
      const body: Record<string, unknown> = { name: name.trim(), lang };
      if (newProject) body.project_id = Number(newProject);
      const { id } = await post<{ id: number }>('/api/corpora', body);
      newOpen = false;
      name = '';
      await corpusStore.reload();
      await corpusStore.select(id);
      await reloadProjects();
    } catch (err) {
      messages.say(err instanceof Error ? err.message : String(err), 'err');
    }
  }

  async function remove(): Promise<void> {
    if (!current) return;
    try {
      const gone = current.id;
      // The next corpus comes from the same project filter, as in the old header.
      const next = visible.find((c: Corpus) => c.id !== gone);
      await del(`/api/corpora/${gone}`);
      delOpen = false;
      if (next) await corpusStore.select(next.id);
      await corpusStore.reload();
      await reloadProjects();
    } catch (err) {
      messages.say(err instanceof Error ? err.message : String(err), 'err');
    }
  }
</script>

<div class="switcher">
  <div class="proj">
    <Select label={t('corpus.project')} bind:value={projectStore.filter} options={filterOptions} onchange={onFilter} />
    <Button title={t('corpus.manageProjects')} onclick={() => (projectsOpen = true)}>
      <span aria-hidden="true">…</span><span class="sr">{t('corpus.manageProjects')}</span>
    </Button>
  </div>
  {#if visible.length}
    <select aria-label={t('corpus.switcher')} value={String(corpusStore.currentId ?? '')} onchange={pick}>
      {#if groups}
        {#each groups as g (g.label)}
          <optgroup label={g.label}>
            {#each g.corpora as c (c.id)}<option value={String(c.id)}>{c.name} [{c.lang}]</option>{/each}
          </optgroup>
        {/each}
      {:else}
        {#each visible as c (c.id)}<option value={String(c.id)}>{c.name} [{c.lang}]</option>{/each}
      {/if}
    </select>
    <div class="meta">{meta}</div>
  {:else}
    <div class="meta">{corpusStore.list.length ? t('corpus.noneInProject') : t('corpus.none')}</div>
  {/if}
  <div class="actions">
    <Button onclick={openNew}>{t('corpus.new')}</Button>
    <Button variant="danger" disabled={!current} onclick={() => (delOpen = true)}>{t('common.delete')}</Button>
  </div>
</div>

<Dialog bind:open={newOpen} title={t('corpus.new')}>
  <form id="new-corpus" onsubmit={create}>
    <Field label={t('corpus.name')}>
      <input bind:value={name} required maxlength="120" />
    </Field>
    <Field label={t('corpus.language')}>
      <Select label={t('corpus.language')} bind:value={lang} options={langOptions} />
    </Field>
    <Field label={t('corpus.projectOfNew')}>
      <Select label={t('corpus.projectOfNew')} bind:value={newProject} options={projectOptions} />
    </Field>
  </form>
  {#snippet footer()}
    <Button onclick={() => (newOpen = false)}>{t('common.cancel')}</Button>
    <button type="submit" form="new-corpus" class="primary" disabled={!canCreate}>{t('corpus.create')}</button>
  {/snippet}
</Dialog>

<ProjectsDialog bind:open={projectsOpen} />

<Dialog bind:open={delOpen} title={t('corpus.delete')}>
  <p>{t('corpus.confirmDelete', { name: current?.name ?? '' })}</p>
  {#snippet footer()}
    <Button onclick={() => (delOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={remove}>{t('common.delete')}</Button>
  {/snippet}
</Dialog>

<style>
  .switcher {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: 0 var(--s-3) var(--s-2);
  }
  .proj {
    display: flex;
    gap: var(--s-1);
  }
  .proj :global(select) {
    flex: 1;
    min-width: 0;
  }
  .proj :global(button) {
    flex: none;
    padding: 0 var(--s-2);
    color: var(--rail-fg);
    background: transparent;
    border-color: var(--rail-hover);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .switcher :global(select) {
    width: 100%;
    color: var(--rail-fg);
    background: var(--rail-hover);
    border-color: var(--rail-hover);
  }
  .meta {
    color: var(--rail-muted);
    font-size: var(--fs-small);
  }
  .actions {
    display: flex;
    gap: var(--s-1);
  }
  .actions :global(button) {
    flex: 1;
    padding: 0 var(--s-1);
    color: var(--rail-fg);
    background: transparent;
    border-color: var(--rail-hover);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
</style>
