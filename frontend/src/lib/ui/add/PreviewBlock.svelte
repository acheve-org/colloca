<script lang="ts">
  import { answerPutBack, draft, putBack, putBackAsk, work, type Preview } from '../../addDocuments.svelte';
  import { fmt, t } from '../../i18n';
  import Badge from '../Badge.svelte';
  import Button from '../Button.svelte';
  import Dialog from '../Dialog.svelte';
  import Field from '../Field.svelte';

  /** Which method's preview this shows: one from the other method is never shown here. */
  let { kind }: { kind: Preview['kind'] } = $props();
  const words = $derived(draft.preview ? draft.preview.text.split(/\s+/).filter(Boolean).length : 0);
  const uid = $props.id();
  /** Lines shown per step; the rest are counted. */
  const SHOWN = 50;
  const groups = $derived(draft.preview ? draft.preview.removed.filter((g) => g.lines.length) : []);
  const removedLines = $derived(groups.reduce((n, g) => n + g.lines.length, 0));
</script>

{#if draft.preview?.kind === kind}
  <section class="preview" aria-labelledby="{uid}-pv">
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
    {#if removedLines}
      <details class="removed">
        <summary>{removedLines === 1 ? t('src.clean.summary1') : t('src.clean.summary', { n: fmt(removedLines) })}</summary>
        {#each groups as g (g.step)}
          <section class="group" aria-labelledby="{uid}-{g.step}">
            <div class="row">
              <h4 id="{uid}-{g.step}" class="grow">{t(`src.clean.${g.step}`)}</h4>
              <Button disabled={work.busy !== null} onclick={() => putBack(g.step)}>{t('src.clean.putBack')}</Button>
            </div>
            <ul class="lines">
              {#each g.lines.slice(0, SHOWN) as line, i (i)}<li>{line}</li>{/each}
            </ul>
            {#if g.lines.length > SHOWN}<p class="hint">{t('src.clean.more', { n: fmt(g.lines.length - SHOWN) })}</p>{/if}
          </section>
        {/each}
      </details>
    {/if}
    {#each [...new Set([...draft.preview.warnings.filter((w) => !draft.preview?.quality || !w.includes('may be unreliable')), ...draft.preview.cleanWarnings])] as w (w)}<p class="hint">{w}</p>{/each}
    <Field label={t('src.url.pvTitle')}>
      <input bind:value={draft.preview.title} />
    </Field>
    <Field label={t('src.url.pvText')}>
      <textarea rows="10" bind:value={draft.preview.text}></textarea>
    </Field>
    <div class="row">
      <span class="muted grow">{words === 1 ? t('src.word1') : t('src.words', { n: fmt(words) })}</span>
      <Button onclick={() => (draft.preview = null)}>{t('src.url.discard')}</Button>
    </div>
    <p class="hint">{t('src.url.hint')}</p>
  </section>
  <Dialog bind:open={putBackAsk.open} title={t('src.clean.confirmTitle')} onclose={() => answerPutBack(false)}>
    <p>{t('src.clean.confirm')}</p>
    {#snippet footer()}
      <Button onclick={() => answerPutBack(false)}>{t('common.cancel')}</Button>
      <Button variant="primary" onclick={() => answerPutBack(true)}>{t('src.clean.putBack')}</Button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .preview {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--panel);
  }
  .preview :global(.field) {
    display: flex;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--s-2);
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
  .muted {
    color: var(--muted);
  }
  textarea {
    width: 100%;
  }
  .quality {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin: 0;
  }
  .removed summary {
    cursor: pointer;
  }
  .group {
    margin-top: var(--s-2);
  }
  .group h4 {
    margin: 0;
    font-size: var(--fs-small);
  }
  .lines {
    margin: var(--s-1) 0 0;
    padding-left: 1.2rem;
    max-height: 12rem;
    overflow-y: auto;
    color: var(--muted);
    font-size: var(--fs-small);
    overflow-wrap: anywhere;
  }
  .issues {
    margin: 0;
    padding-left: 1.2rem;
    color: var(--muted);
    font-size: var(--fs-small);
  }
</style>
