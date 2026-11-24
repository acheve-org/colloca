<script lang="ts">
  import { patch } from '../lib/api';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import type { LanguageSetting } from '../lib/types';
  import Button from '../lib/ui/Button.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Field from '../lib/ui/Field.svelte';

  interface Props {
    open: boolean;
    lang: LanguageSetting | null;
    sizes: string[];
    onsaved: () => void;
  }
  let { open = $bindable(), lang, sizes, onsaved }: Props = $props();

  let name = $state('');
  let size = $state('');
  let tesseract = $state('');
  let busy = $state(false);

  $effect(() => {
    if (open && lang) {
      name = lang.name;
      size = lang.model_size ?? '';
      tesseract = lang.tesseract;
    }
  });

  async function save(): Promise<void> {
    if (!lang || busy || !name.trim()) return;
    busy = true;
    try {
      const body: Record<string, unknown> = { name: name.trim(), tesseract: tesseract.trim() };
      if (size !== (lang.model_size ?? '')) body.model_size = size === '' ? null : size; // a new size reinstalls the model
      await patch(`/api/languages/${lang.code}`, body);
      messages.say(t('lang.saved'), 'ok');
      open = false;
      onsaved();
    } catch (err) {
      messages.say(err instanceof Error ? err.message : String(err), 'err');
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title={t('lang.editTitle', { name: lang?.name ?? '' })}>
  <div class="form">
    <Field label={t('lang.code')}><input value={lang?.code ?? ''} readonly /></Field>
    <Field label={t('lang.name')}><input bind:value={name} /></Field>
    <Field label={t('lang.size')}>
      <select bind:value={size}>
        <option value="">{t('lang.sizeDefault')}</option>
        {#each sizes as s (s)}<option value={s}>{s}</option>{/each}
      </select>
    </Field>
    <Field label={t('lang.tesseract')}><input bind:value={tesseract} maxlength="16" /></Field>
  </div>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>{t('common.cancel')}</Button>
    <Button variant="primary" disabled={busy || !name.trim()} onclick={save}>{t('common.save')}</Button>
  {/snippet}
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
</style>
