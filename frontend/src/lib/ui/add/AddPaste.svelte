<script lang="ts">
  import { draft } from '../../addDocuments.svelte';
  import { t } from '../../i18n';
</script>

<div class="paste">
  <input bind:value={draft.pasteTitle} placeholder={t('src.paste.titlePlaceholder')} aria-label={t('src.paste.titleLabel')} />
  <textarea rows="10" bind:value={draft.pasteText} placeholder={t('add.paste.placeholder')} aria-label={t('src.paste.text')}></textarea>
</div>

<style>
  .paste {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding-top: var(--s-1);
  }
  textarea {
    width: 100%;
  }
</style>
