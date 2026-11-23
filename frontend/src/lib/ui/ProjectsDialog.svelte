<script lang="ts">
  import { del, patch, post } from '../api';
  import { corpusStore } from '../corpus.svelte';
  import { t } from '../i18n';
  import { messages } from '../messages.svelte';
  import { projectStore, reloadProjects } from '../projects.svelte';
  import type { Project } from '../types';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  const uid = $props.id();
  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

  let newName = $state('');
  // Edited names by project id; a row shows the stored name until edited.
  let names = $state<Record<number, string>>({});
  let busy = $state(false);
  let confirmOpen = $state(false);
  let toDelete = $state.raw<Project | null>(null);

  $effect(() => {
    if (!open) return;
    names = {};
    reloadProjects().catch((err) => messages.say(errMsg(err), 'err'));
  });

  const nameOf = (p: Project) => names[p.id] ?? p.name;
  const corporaLabel = (n: number) => (n === 1 ? t('proj.corpora1') : t('proj.corpora', { n }));

  /** After any change: the project list (counts) and the corpora (their project) are reloaded. */
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

  const add = (e: SubmitEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    return run(async () => {
      await post('/api/projects', { name });
      newName = '';
      messages.say(t('proj.created'), 'ok');
      await changed();
    });
  };

  const rename = (p: Project) =>
    run(async () => {
      const name = nameOf(p).trim();
      if (!name || name === p.name) return;
      await patch(`/api/projects/${p.id}`, { name });
      names = Object.fromEntries(Object.entries(names).filter(([k]) => k !== String(p.id)));
      messages.say(t('proj.renamed'), 'ok');
      await changed();
    });

  function askDelete(p: Project): void {
    toDelete = p;
    confirmOpen = true;
  }

  async function confirmDelete(): Promise<void> {
    const p = toDelete;
    confirmOpen = false;
    if (!p) return;
    await run(async () => {
      await del(`/api/projects/${p.id}`);
      if (projectStore.filter === String(p.id)) projectStore.filter = '';
      messages.say(t('proj.deleted'), 'ok');
      await changed();
    });
  }
</script>

<Dialog bind:open title={t('proj.title')}>
  <p class="muted">{t('proj.intro')}</p>
  {#if projectStore.list.length}
    <ul class="list">
      {#each projectStore.list as p (p.id)}
        <li>
          <input
            value={nameOf(p)}
            maxlength="120"
            aria-label={t('proj.nameOf', { name: p.name })}
            oninput={(e) => (names = { ...names, [p.id]: e.currentTarget.value })}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                rename(p);
              }
            }}
          />
          <Button disabled={busy || !nameOf(p).trim() || nameOf(p).trim() === p.name} onclick={() => rename(p)}>
            <span aria-hidden="true">{t('proj.rename')}</span><span class="sr">{t('proj.renameOf', { name: p.name })}</span>
          </Button>
          <Button variant="danger" disabled={busy} onclick={() => askDelete(p)}>
            <span aria-hidden="true">{t('common.delete')}</span><span class="sr">{t('proj.deleteOf', { name: p.name })}</span>
          </Button>
          <span class="muted count">{corporaLabel(p.corpora)}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{t('proj.none')}</p>
  {/if}
  <form id="{uid}-new" class="new" onsubmit={add}>
    <input bind:value={newName} maxlength="120" placeholder={t('proj.newPlaceholder')} aria-label={t('proj.new')} />
    <Button type="submit" variant="primary" disabled={busy || !newName.trim()}>{t('proj.add')}</Button>
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>{t('common.close')}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={confirmOpen} title={t('proj.confirmTitle')}>
  <p class="confirm">{t('proj.confirmBody', { name: toDelete?.name ?? '' })}</p>
  {#snippet footer()}
    <Button onclick={() => (confirmOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={confirmDelete}>{t('common.delete')}</Button>
  {/snippet}
</Dialog>

<style>
  .muted {
    margin: 0;
    color: var(--muted);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li,
  .new {
    display: flex;
    align-items: center;
    gap: var(--s-1);
  }
  li input,
  .new input {
    flex: 1;
    min-width: 0;
  }
  .count {
    min-width: 5rem;
    font-size: var(--fs-small);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .confirm {
    margin: 0;
  }
</style>
