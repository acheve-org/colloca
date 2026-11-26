<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { del, patch, post } from '../lib/api';
  import { languageName } from '../lib/context.svelte';
  import { corpusStore } from '../lib/corpus.svelte';
  import { fmt, t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import { viewport } from '../lib/viewport.svelte';
  import { projectStore, reloadProjects } from '../lib/projects.svelte';
  import type { Corpus, Project } from '../lib/types';
  import ActionMenu from '../lib/ui/ActionMenu.svelte';
  import Badge from '../lib/ui/Badge.svelte';
  import Button from '../lib/ui/Button.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import EmptyCard from '../lib/ui/EmptyCard.svelte';
  import Field from '../lib/ui/Field.svelte';
  import ListPanel from '../lib/ui/ListPanel.svelte';
  import ReadyHint from '../lib/ui/ReadyHint.svelte';
  import Select from '../lib/ui/Select.svelte';
  import SidePanel from '../lib/ui/SidePanel.svelte';
  import NewCorpusDialog from './NewCorpusDialog.svelte';

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

  // undefined: not chosen yet, follow the working corpus; null: the "No project" entry.
  let picked = $state<number | null | undefined>(undefined);
  let newProject = $state('');
  let newProjectOpen = $state(false);
  // The project name is renamed in place: ✎ swaps the heading for this draft.
  let renaming = $state(false);
  let draft = $state('');
  let pencil = $state<HTMLButtonElement | null>(null);
  // The corpus row the user picked: its settings panel is open. Only meaningful within the shown project.
  let selectedCorpusId = $state<number | null>(null);
  // The settings panel's form, reset from the corpus whenever the selection changes.
  let setName = $state('');
  let setProject = $state('');
  let busy = $state(false);
  let newOpen = $state(false);
  let delCorpus = $state.raw<Corpus | null>(null);
  let delCorpusOpen = $state(false);
  let delProject = $state.raw<Project | null>(null);
  let delProjectOpen = $state(false);
  let target = $state('');
  // Stacked screens show the list or the chosen project's panel: choosing opens the panel, Back closes it.
  let panelOpen = $state(false);

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
  // Nothing to choose from yet (and the list has been fetched, not just empty while loading).
  const firstRun = $derived(projectStore.loaded && !projectStore.list.length && !loose.length);
  const heading = $derived(selected?.name ?? t('ctx.noProject'));
  const tableLabel = $derived(t('proj.corporaOf', { name: heading }));

  const itemId = (id: number | null) => `proj-item-${id ?? 'none'}`;
  const focusItem = (id: number | null) => tick().then(() => document.getElementById(itemId(id))?.focus());
  // Any change of the shown project (a click, a deleted project, a corpus switched from the header)
  // drops the corpus selection and any rename in progress: both belong to the project they started in.
  $effect(() => {
    void selectedId;
    selectedCorpusId = null;
    renaming = false;
    draft = '';
  });
  const choose = (id: number | null) => {
    picked = id;
    panelOpen = true;
  };
  // Stacked: the list comes back; put focus on the project the user had chosen.
  const back = () => {
    panelOpen = false;
    focusItem(selectedId);
  };

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
      const { id } = await post<{ id: number }>('/api/projects', { name });
      newProject = '';
      newProjectOpen = false;
      messages.say(t('proj.created'), 'ok');
      await reloadProjects();
      picked = id;
      focusItem(id);
    });
  };

  const focusPencil = () => tick().then(() => pencil?.focus());

  function startRenameProject(p: Project): void {
    draft = p.name;
    renaming = true;
  }

  function cancelRenameProject(): void {
    renaming = false;
    focusPencil();
  }

  // A failed PATCH keeps the input open with the draft, so the user can retry or press Escape.
  const renameProject = (p: Project) =>
    run(async () => {
      const name = draft.trim();
      if (name && name !== p.name) {
        await patch(`/api/projects/${p.id}`, { name });
        messages.say(t('proj.renamed'), 'ok');
        await reloadProjects();
      }
      renaming = false;
      focusPencil();
    });

  function askDeleteProject(p: Project): void {
    delProject = p;
    target = '';
    delProjectOpen = true;
  }

  const delTrashed = $derived(delProject?.trashed ?? 0);
  const delTerms = $derived(delProject?.terms ?? 0);
  const delCount = $derived(delProject?.corpora ?? 0);
  const targets = $derived(projectStore.list.filter((p) => p.id !== delProject?.id));

  async function confirmDeleteProject(): Promise<void> {
    const p = delProject;
    delProjectOpen = false;
    if (!p) return;
    let deleted = false;
    await run(async () => {
      try {
        if (target) {
          for (const c of corpusStore.list.filter((x) => x.project_id === p.id)) {
            await patch(`/api/corpora/${c.id}`, { project_id: Number(target) });
          }
          picked = Number(target);
        }
        await del(`/api/projects/${p.id}`);
        deleted = true;
        messages.say(t('proj.deleted'), 'ok');
      } finally {
        // Also after a failed move: corpora already moved must show under their new project.
        await changed();
      }
    });
    // Stacked, the panel showed the project that is gone: go back to the list, on the project now chosen.
    if (deleted && viewport.stacked) {
      panelOpen = false;
      focusItem(selectedId);
    }
  }

  const open = (c: Corpus) => run(() => corpusStore.select(c.id));

  // Rename mode is explicit: put the cursor in the field it opens.
  const focusOnMount = (node: HTMLInputElement) => {
    node.focus();
    node.select();
  };

  const SETTINGS_ID = 'corpus-settings';
  // The corpus name button, in the table row or the card: one id, so focus finds it in either layout.
  const nameId = (id: number) => `corpus-${id}`;
  let headingEl = $state<HTMLHeadingElement | null>(null);
  const projectValue = (c: Corpus) => (c.project_id != null && projectIds.has(c.project_id) ? String(c.project_id) : '');
  const editing = $derived(shown.find((c) => c.id === selectedCorpusId) ?? null);
  const projectOptions = $derived([
    ...(setProject ? [] : [{ value: '', label: t('src.chooseProject'), disabled: true }]),
    ...projectStore.list.map((p) => ({ value: String(p.id), label: p.name })),
  ]);
  const canSave = $derived(
    !!editing && !!setName.trim() && (setName.trim() !== editing.name || setProject !== projectValue(editing)),
  );
  // Only a change of selection resets the form: a list reload must not wipe what the user is typing.
  $effect(() => {
    const id = selectedCorpusId;
    untrack(() => {
      const c = corpusStore.list.find((x) => x.id === id);
      setName = c?.name ?? '';
      setProject = c ? projectValue(c) : '';
    });
  });

  const selectCorpus = (c: Corpus) => (selectedCorpusId = c.id);

  const saveCorpus = (e: SubmitEvent) => {
    e.preventDefault();
    const c = editing;
    if (!c || !canSave) return;
    const name = setName.trim();
    const projectId = setProject ? Number(setProject) : null;
    return run(async () => {
      await patch(`/api/corpora/${c.id}`, { name, ...(projectId != null ? { project_id: projectId } : {}) });
      await changed();
      messages.say(t('src.corpusSaved'), 'ok');
      if (projectId != null && projectId !== c.project_id) {
        // Showing the new project resets the selection; re-select the corpus once that has run,
        // with focus on its name so closing the panel returns there.
        picked = projectId;
        await tick();
        document.getElementById(nameId(c.id))?.focus();
        selectedCorpusId = c.id;
      } else if (selectedCorpusId === c.id) {
        setName = name;
      }
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
    // Focus moves to the next corpus, else the previous one, else the heading: the panel it was in is gone.
    const ids = shown.map((x) => x.id);
    const at = ids.indexOf(c.id);
    const neighbours = [...ids.slice(at + 1), ...ids.slice(0, Math.max(at, 0)).reverse()];
    await run(async () => {
      await del(`/api/corpora/${c.id}`);
      if (selectedCorpusId === c.id) selectedCorpusId = null;
      await changed();
      await tick();
      const next = neighbours.map((id) => document.getElementById(nameId(id))).find((el) => el !== null);
      (next ?? headingEl)?.focus();
    });
  }

  async function created(id: number, projectId: number): Promise<void> {
    picked = projectId;
    await corpusStore.reload();
    await corpusStore.select(id);
    await reloadProjects();
  }
</script>

<ListPanel label={t('nav.projects')} showPanel={panelOpen} onback={back}>
  {#snippet list()}
    <div class="lh">
      <span class="ltitle">{t('nav.projects')}</span>
      <Button pending={firstRun} onclick={() => (newProjectOpen = true)}><span aria-hidden="true">+</span> {t('proj.new')}</Button>
    </div>
    {#if firstRun}
      <div class="hint">
        <ReadyHint title={t('setup.project.title')} hint={t('setup.project.hint')} />
      </div>
    {/if}
    <ul class="plist">
      {#each projectStore.list as p (p.id)}
        <li>
          <button type="button" id={itemId(p.id)} class="pick" aria-pressed={p.id === selectedId} onclick={() => choose(p.id)}>
            <span class="pname">{p.name}</span>
            <Badge kind="neutral" label={String(p.corpora)} />
          </button>
        </li>
      {/each}
      {#if loose.length}
        <li>
          <button type="button" id={itemId(null)} class="pick" aria-pressed={selectedId === null} onclick={() => choose(null)}>
            <span class="pname loose">{t('ctx.noProject')}</span>
            <Badge kind="neutral" label={String(loose.length)} />
          </button>
        </li>
      {/if}
    </ul>
  {/snippet}

  {#snippet panel()}
    <div class="split">
      <section class="right" class:cardsOn={viewport.narrow}>
        <header>
          {#if selected && renaming}
            {@const p = selected}
            <input
              class="rename"
              bind:value={draft}
              maxlength="120"
              use:focusOnMount
              aria-label={t('proj.nameOf', { name: p.name })}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  renameProject(p);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelRenameProject();
                }
              }}
            />
          {:else}
            <!-- Focusable from script only: focus lands here when the last corpus is deleted. -->
            <h2 tabindex="-1" bind:this={headingEl}>{heading}</h2>
            {#if selected}
              {@const p = selected}
              <!-- Never disabled: focus comes back here right after a save, while busy is still set. -->
              <button type="button" class="pencil" aria-label={t('proj.renameProject')} bind:this={pencil} onclick={() => startRenameProject(p)}>✎</button>
            {/if}
          {/if}
          <div class="hactions">
            <Button variant="primary" disabled={!projectStore.list.length} onclick={() => (newOpen = true)}>{t('corpus.new')}</Button>
            {#if selected}
              {@const p = selected}
              <ActionMenu
                label={t('proj.projectMenu')}
                disabled={busy}
                items={[{ label: t('proj.deleteProject'), danger: true, onclick: () => askDeleteProject(p) }]}
              />
            {/if}
          </div>
        </header>
        {#if shown.length && viewport.narrow}
          <ul class="cards">
            {#each shown as c (c.id)}
              <li class="ccard">
                <button
                  type="button"
                  id={nameId(c.id)}
                  class="cname"
                  aria-expanded={c.id === selectedCorpusId}
                  aria-controls={c.id === selectedCorpusId ? SETTINGS_ID : undefined}
                  onclick={() => selectCorpus(c)}>{c.name}</button
                >
                <div class="cmeta">
                  <span>{languageName(c.lang)}</span>
                  <span>{t('proj.colDocs')} {fmt(c.docs)}</span>
                  <span>{t('proj.colWords')} {fmt(c.tokens)}</span>
                </div>
                {#if c.id === corpusStore.currentId}
                  <Badge kind="intb" label={t('proj.working')} />
                {:else}
                  <Button variant="primary" ariaLabel={t('proj.open') + ' ' + c.name} disabled={busy} onclick={() => open(c)}>{t('proj.open')}</Button>
                {/if}
              </li>
            {/each}
          </ul>
        {:else if shown.length}
          <table aria-label={tableLabel}>
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
                <!-- The whole row is a mouse target; keyboard and screen-reader users have the name button. -->
                <tr class:cur={c.id === corpusStore.currentId} onclick={() => selectCorpus(c)}>
                  <td>
                    <button
                      type="button"
                      id={nameId(c.id)}
                      class="cname"
                      aria-expanded={c.id === selectedCorpusId}
                      aria-controls={c.id === selectedCorpusId ? SETTINGS_ID : undefined}
                      onclick={() => selectCorpus(c)}>{c.name}</button
                    >
                  </td>
                  <td>{languageName(c.lang)}</td>
                  <td class="num">{fmt(c.docs)}</td>
                  <td class="num">{fmt(c.tokens)}</td>
                  <td>
                    <div class="actions">
                      {#if c.id === corpusStore.currentId}
                        <Badge kind="intb" label={t('proj.working')} />
                      {:else}
                        <!-- Open switches the working corpus; it must not also select the row. -->
                        <Button
                          ariaLabel={t('proj.open') + ' ' + c.name}
                          disabled={busy}
                          onclick={(e) => {
                            e.stopPropagation();
                            open(c);
                          }}>{t('proj.open')}</Button
                        >
                      {/if}
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else if selected}
          <EmptyCard icon="folder" title={t('proj.noCorpusTitle')} hint={t('proj.noCorpusHint')}>
            {#snippet actions()}
              <Button variant="primary" onclick={() => (newOpen = true)}>{t('corpus.new')}</Button>
            {/snippet}
          </EmptyCard>
        {:else}
          <p class="muted">{t('corpus.none')}</p>
        {/if}
      </section>
      <!-- Keyed: each corpus opens its own panel (focus moves into it), and closing returns to that corpus's name. -->
      {#key editing?.id}
        <SidePanel
          open={editing !== null}
          id={SETTINGS_ID}
          title={t('proj.settings')}
          returnFocus={editing ? nameId(editing.id) : undefined}
          onclose={() => (selectedCorpusId = null)}
        >
          {#if editing}
            {@const c = editing}
            <form class="settings" onsubmit={saveCorpus}>
              <Field label={t('src.corpusName')}>
                <input bind:value={setName} required maxlength="120" />
              </Field>
              <Field label={t('src.project')}>
                <Select label={t('src.project')} bind:value={setProject} options={projectOptions} />
              </Field>
              <p class="muted">{t('proj.summary', { lang: languageName(c.lang), docs: fmt(c.docs), words: fmt(c.tokens) })}</p>
              <div><Button type="submit" variant="primary" disabled={busy || !canSave}>{t('common.save')}</Button></div>
            </form>
          {/if}
          {#snippet footer()}
            {#if editing}
              {@const c = editing}
              <Button variant="danger" disabled={busy} onclick={() => askDeleteCorpus(c)}>{t('proj.deleteCorpus')}</Button>
            {/if}
          {/snippet}
        </SidePanel>
      {/key}
    </div>
  {/snippet}
</ListPanel>

<Dialog bind:open={newProjectOpen} title={t('proj.newTitle')}>
  <form id="proj-new-form" onsubmit={addProject}>
    <Field label={t('corpus.name')}>
      <input bind:value={newProject} required maxlength="120" placeholder={firstRun ? t('proj.firstPlaceholder') : t('proj.newPlaceholder')} />
    </Field>
  </form>
  {#snippet footer()}
    <Button onclick={() => (newProjectOpen = false)}>{t('common.cancel')}</Button>
    <button type="submit" form="proj-new-form" class="primary" disabled={busy || !newProject.trim()}>{t('proj.create')}</button>
  {/snippet}
</Dialog>

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
  {#if delTerms > 0 && delTrashed === 0}
    <p class="warn" role="alert">{t('proj.deleteTerms', { name: delProject?.name ?? '', n: delTerms })}</p>
  {/if}
  {#snippet footer()}
    <Button onclick={() => (delProjectOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" disabled={delTrashed > 0 || (delCount > 0 && !target)} onclick={confirmDeleteProject}>{t('common.delete')}</Button>
  {/snippet}
</Dialog>

<style>
  .lh {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    padding: var(--s-4) var(--s-4) var(--s-2);
  }
  .ltitle {
    color: var(--muted);
    font-size: var(--fs-small);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .hint {
    padding: 0 var(--s-4) var(--s-2);
  }
  /* The project's content and, when a corpus is selected, its settings panel beside or over it.
     Fills the panel column: the content scrolls on its own and the settings panel stays in view. */
  .split {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .right {
    flex: 1;
    min-width: 0;
    /* No top padding on the scroller: the sticky table header would stick below it, with rows showing above. */
    padding: 0 var(--s-6) var(--page-pad);
    overflow-y: auto;
  }
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .settings input {
    width: 100%;
  }
  h2 {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere; /* a long project name wraps instead of pushing the button out */
  }
  @media (max-width: 899px) {
    .right {
      overflow-x: auto; /* a wide corpus table scrolls inside its pane, not the page */
    }
    .right.cardsOn {
      overflow: visible; /* cards have no wide table, and the menu popover must overlay the page, not grow a scroll area */
    }
  }
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
    padding: 0 var(--s-2) var(--s-2);
    list-style: none;
  }
  .pick {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    width: 100%;
    height: auto; /* base.css gives every button a fixed control height; a long name wraps and the row grows */
    min-height: var(--row-h);
    padding: var(--s-2) var(--s-3);
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-lg);
  }
  .pick[aria-pressed='true'] {
    background: var(--panel);
    border-color: var(--accent);
    box-shadow: inset 3px 0 0 var(--accent); /* literal: the selection bar width */
  }
  .pname {
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .pname.loose {
    color: var(--muted);
    font-weight: 500;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    padding-top: var(--page-pad);
  }
  header :global(button) {
    flex: none;
    white-space: nowrap; /* "New corpus" keeps its one line next to a long heading */
  }
  .rename {
    flex: 1;
    min-width: 0;
  }
  .pencil {
    padding: 0 var(--s-2);
    color: var(--muted);
    background: transparent;
    border-color: transparent;
  }
  .pencil:hover {
    color: var(--fg);
    border-color: var(--line);
  }
  .hactions {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    margin-left: auto;
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
  tbody tr {
    cursor: pointer;
  }
  tbody tr:not(.cur):hover {
    background: var(--surface);
  }
  /* the working corpus: tinted row, normal text (accent text is not safe on --accent-soft) */
  tr.cur {
    background: var(--accent-soft);
  }
  tr.cur :global(.badge) {
    background: var(--panel); /* the pill stays legible on the tinted row */
  }
  tr:has(.cname[aria-expanded='true']) {
    box-shadow: inset 3px 0 0 var(--accent); /* literal: the selection bar width */
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .ccard {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-1);
    padding: var(--s-2);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
  }
  .cname {
    max-width: 100%;
    height: auto; /* base.css gives every button a fixed control height; a long name wraps and the card grows */
    padding: 0;
    color: var(--fg);
    font-weight: 600;
    text-align: left;
    overflow-wrap: anywhere;
    background: none;
    border: 0;
  }
  .cname[aria-expanded='true'] {
    text-decoration: underline;
    text-decoration-color: var(--accent);
    text-decoration-thickness: 2px; /* literal: the selection underline weight */
  }
  .cmeta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1) var(--s-2);
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .warn {
    color: var(--danger, inherit);
    font-weight: 600;
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
