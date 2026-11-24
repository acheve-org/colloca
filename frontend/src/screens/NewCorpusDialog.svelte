<script lang="ts">
  import { get, post } from '../lib/api';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import { projectStore } from '../lib/projects.svelte';
  import type { Languages } from '../lib/types';
  import Button from '../lib/ui/Button.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';

  interface Props {
    open: boolean;
    /** Project preselected when the dialog opens. */
    projectId: number | null;
    /** Called with the new corpus id and its project once it exists. */
    oncreated: (id: number, projectId: number) => void | Promise<void>;
  }
  let { open = $bindable(false), projectId, oncreated }: Props = $props();

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const uid = $props.id();

  let languages = $state<Languages>({});
  let name = $state('');
  let lang = $state('');
  let project = $state('');
  let busy = $state(false);

  // The languages can change in the Languages screen: read them again each time the dialog opens.
  $effect(() => {
    if (!open) return;
    project = projectId === null ? String(projectStore.list[0]?.id ?? '') : String(projectId);
    get<Languages>('/api/languages')
      .then((l) => {
        languages = l;
        if (!(lang in l)) lang = Object.keys(l)[0] ?? '';
      })
      .catch((err) => messages.say(errMsg(err), 'err'));
  });

  const langOptions = $derived(Object.entries(languages).map(([value, label]) => ({ value, label })));
  const projectOptions = $derived(projectStore.list.map((p) => ({ value: String(p.id), label: p.name })));
  const canCreate = $derived(name.trim() !== '' && lang !== '' && project !== '' && !busy);

  async function create(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!canCreate) return;
    busy = true;
    try {
      const pid = Number(project);
      const { id } = await post<{ id: number }>('/api/corpora', { name: name.trim(), lang, project_id: pid });
      open = false;
      name = '';
      await oncreated(id, pid);
    } catch (err) {
      messages.say(errMsg(err), 'err');
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title={t('corpus.new')}>
  <form id="{uid}-new-corpus" onsubmit={create}>
    <Field label={t('corpus.name')}>
      <input bind:value={name} required maxlength="120" />
    </Field>
    <Field label={t('corpus.language')}>
      <Select label={t('corpus.language')} bind:value={lang} options={langOptions} />
    </Field>
    <Field label={t('src.project')}>
      <Select label={t('src.project')} bind:value={project} options={projectOptions} />
    </Field>
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>{t('common.cancel')}</Button>
    <button type="submit" form="{uid}-new-corpus" class="primary" disabled={!canCreate}>{t('corpus.create')}</button>
  {/snippet}
</Dialog>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
</style>
