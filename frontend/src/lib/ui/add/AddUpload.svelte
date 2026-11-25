<script lang="ts">
  import { onMount } from 'svelte';
  import { draft, previewFile, work } from '../../addDocuments.svelte';
  import { t } from '../../i18n';
  import Button from '../Button.svelte';
  import PreviewBlock from './PreviewBlock.svelte';

  const UPLOAD_ACCEPT = '.docx,.pdf,.odt,.rtf,.xlsx,.csv,.tsv,.xlf,.xliff,.srt,.vtt,.txt,.md,.html,.htm';

  let input: HTMLInputElement | undefined = $state();
  let over = $state(false);

  // The page's actions empty the input after a submit.
  onMount(() => draft.onClear('files', () => input && (input.value = '')));

  /** A new choice replaces the files, so a preview of the old ones no longer applies. */
  function setFiles(files: File[]): void {
    draft.files = files;
    if (draft.preview?.kind === 'file') draft.preview = null;
  }
  function drop(e: DragEvent): void {
    e.preventDefault();
    over = false;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    setFiles(files);
    // keep the native input in step, so the same files are not lost to a later change event
    if (input && e.dataTransfer) {
      try {
        input.files = e.dataTransfer.files;
      } catch {
        /* not assignable here: the draft already has the files */
      }
    }
  }
  const uid = $props.id();
</script>

<div class="up">
  <div
    class="drop"
    class:over
    data-testid="dropzone"
    role="group"
    aria-labelledby="{uid}-drop"
    ondragover={(e) => {
      e.preventDefault();
      over = true;
    }}
    ondragleave={() => (over = false)}
    ondrop={drop}
  >
    <span id="{uid}-drop">{t('add.up.drop')}</span>
    <Button onclick={() => input?.click()}>{t('add.up.choose')}</Button>
    <input
      bind:this={input}
      type="file"
      multiple
      hidden
      accept={UPLOAD_ACCEPT}
      aria-label={t('src.upload.files')}
      onchange={(e) => setFiles([...(e.currentTarget.files ?? [])])}
    />
    {#if draft.files.length}
      <ul class="chosen">
        {#each draft.files as f, i (`${i}-${f.name}`)}<li>{f.name}</li>{/each}
      </ul>
    {/if}
    <p class="hint">{t('src.upload.hint')}</p>
  </div>
  <label class="cols">
    {t('src.upload.columns')}
    <input type="text" bind:value={draft.textColumns} placeholder={t('src.upload.columnsHint')} />
  </label>
  <div class="row">
    <Button disabled={work.busy !== null || draft.files.length !== 1} title={t('src.preview.fileHint')} onclick={previewFile}>
      {t('src.preview.file')}
    </Button>
  </div>
  <PreviewBlock kind="file" />
</div>

<style>
  .up {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding-top: var(--s-1);
  }
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-4) var(--s-3);
    text-align: center;
    border: 1px dashed var(--line);
    border-radius: var(--radius-lg);
    background: var(--panel);
  }
  .drop.over {
    border-color: var(--accent);
  }
  .chosen {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--fs-small);
    overflow-wrap: anywhere;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .cols {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .row {
    display: flex;
    gap: var(--s-2);
  }
</style>
