<script lang="ts">
  import {
    draft, fetchPreview, findLinks, pickedCount, pickLinks, visibleLinks, work,
  } from '../../addDocuments.svelte';
  import { fmt, t } from '../../i18n';
  import { go, route } from '../../router.svelte';
  import Badge from '../Badge.svelte';
  import Button from '../Button.svelte';
  import Field from '../Field.svelte';
  import Toggle from '../Toggle.svelte';

  const SUBS = ['one', 'list', 'index'] as const;
  const sub = $derived(SUBS.find((x) => x === route.params.sub) ?? 'one');
  const visible = $derived(visibleLinks());
  const nPicked = $derived(pickedCount());
  const words = $derived(draft.preview ? draft.preview.text.split(/\s+/).filter(Boolean).length : 0);
  const uid = $props.id();
</script>

<div class="web">
  <div class="chips">
    {#each SUBS as id (id)}
      <button type="button" class="chip" aria-pressed={sub === id} onclick={() => go('sources-add', { m: 'web', sub: id })}>
        {t(`add.web.${id}`)}
      </button>
    {/each}
  </div>

  {#if sub === 'one'}
    <form
      class="row"
      onsubmit={(e) => {
        e.preventDefault();
        fetchPreview();
      }}
    >
      <input class="grow" type="text" inputmode="url" bind:value={draft.url} placeholder="https://…" aria-label={t('src.url.address')} />
      <Button type="submit" disabled={work.busy !== null}>{t('src.url.fetch')}</Button>
    </form>
    {#if draft.preview?.kind === 'url'}
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
        {#each draft.preview.warnings.filter((w) => !draft.preview?.quality || !w.includes('may be unreliable')) as w (w)}<p class="hint">{w}</p>{/each}
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
    {/if}
  {:else if sub === 'list'}
    <Field label={t('src.urls.label')}>
      <textarea rows="6" bind:value={draft.urlList} placeholder="https://…" spellcheck="false"></textarea>
    </Field>
    <p class="hint">{t('src.urls.hint')}</p>
  {:else}
    <form
      class="row"
      onsubmit={(e) => {
        e.preventDefault();
        findLinks();
      }}
    >
      <input class="grow" type="text" inputmode="url" bind:value={draft.catalogUrl} placeholder="https://…" aria-label={t('src.catalog.address')} />
      <Button type="submit" disabled={work.busy !== null}>{t('src.catalog.find')}</Button>
    </form>
    <p class="hint">{t('src.catalog.hint')}</p>
    {#if draft.catalog}
      <div class="row">
        <input class="grow" type="text" bind:value={draft.linkFilter} placeholder={t('src.catalog.filterPlaceholder')} aria-label={t('src.catalog.filter')} />
        <Toggle bind:checked={draft.sameHostOnly} label={t('src.catalog.sameHost')} />
      </div>
      <div class="row">
        <Button onclick={() => pickLinks(visible.map((l) => l.url), true)}>{t('src.catalog.selectAll')}</Button>
        <Button onclick={() => pickLinks(visible.map((l) => l.url), false)}>{t('src.catalog.selectNone')}</Button>
        <span class="hint grow">{t('src.catalog.count', { n: nPicked, total: draft.catalog.links.length })}</span>
      </div>
      <ul class="catalog-links">
        {#each visible as l (l.url)}
          <li>
            <label>
              <input type="checkbox" checked={draft.picked.has(l.url)} onchange={(e) => pickLinks([l.url], e.currentTarget.checked)} />
              <span class="ctext">{l.text}</span>
              <small class="curl">{l.url}</small>
            </label>
          </li>
        {/each}
      </ul>
      {#if draft.catalog.truncated}<p class="hint">{t('src.catalog.truncated')}</p>{/if}
    {/if}
  {/if}
</div>

<style>
  .web {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding-top: var(--s-1);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .chip {
    padding: 0 var(--s-2);
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    font: inherit;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
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
  .web :global(.field) {
    display: flex;
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
  }
  .quality {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin: 0;
  }
  .issues {
    margin: 0;
    padding-left: 1.2rem;
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .catalog-links {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 18rem;
    overflow: auto;
    border: 1px solid var(--line);
  }
  .catalog-links label {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-2);
  }
  .ctext {
    overflow-wrap: anywhere;
  }
  .curl {
    color: var(--muted);
    overflow-wrap: anywhere;
  }
</style>
