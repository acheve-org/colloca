<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { del, get, post } from '../lib/api';
  import { t } from '../lib/i18n';
  import { loadLanguageNames } from '../lib/context.svelte';
  import { messages } from '../lib/messages.svelte';
  import { langStatus, type Dot } from '../lib/langStatus';
  import type { CatalogEntry, Corpus, LanguageSetting } from '../lib/types';
  import Badge from '../lib/ui/Badge.svelte';
  import BaseCorpusCard from '../lib/ui/BaseCorpusCard.svelte';
  import Button from '../lib/ui/Button.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import ListPanel from '../lib/ui/ListPanel.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import AddLanguageDialog from './AddLanguageDialog.svelte';
  import EditLanguageDialog from './EditLanguageDialog.svelte';

  const uid = $props.id();
  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const SIZES = ['sm', 'md', 'lg'];

  let rows = $state.raw<LanguageSetting[]>([]);
  let refs = $state.raw<Corpus[]>([]);
  let catalog = $state.raw<CatalogEntry[]>([]);
  let loaded = $state(false);
  let force = $state(false);
  let busy = $state(false);
  let chosen = $state.raw<Record<string, string>>({});
  let addOpen = $state(false);
  let editOpen = $state(false);
  let editing = $state.raw<LanguageSetting | null>(null);
  let removeOpen = $state(false);
  let removing = $state.raw<LanguageSetting | null>(null);
  let alsoUninstall = $state(false);

  let seq = 0;
  let mounted = true;
  // Last state seen per language, to announce an install that just finished or failed.
  let seen: Record<string, { model: string; ocr: string }> = {};

  // The chosen language; it stays chosen across reloads while it exists, else the first one is shown.
  let selectedCode = $state<string | null>(null);
  // Stacked layouts only: the panel replaces the list.
  let panelOpen = $state(false);
  const selected = $derived(rows.find((r) => r.code === selectedCode) ?? rows[0] ?? null);

  const itemId = (code: string) => `${uid}-item-${code}`;
  const focusItem = (code: string | undefined) =>
    tick().then(() => {
      if (code) document.getElementById(itemId(code))?.focus();
    });
  const choose = (code: string) => {
    selectedCode = code;
    panelOpen = true;
  };
  // Stacked: the list comes back; put focus on the language the user had chosen.
  const back = () => {
    panelOpen = false;
    focusItem(selected?.code);
  };

  const hasBase = (code: string) => refs.some((x) => x.lang === code);
  const DOTS = ['model', 'ocr', 'base'] as const;
  const dotText = (part: (typeof DOTS)[number], dot: Dot) => `${t(`lang.status.${part}`)}: ${t(`lang.status.${dot}`)}`;

  const installing = $derived(rows.some((r) => r.model.state === 'installing' || r.ocr.state === 'installing'));
  const sizesOf = (code: string) => catalog.find((e) => e.code === code)?.sizes ?? SIZES;

  function announce(next: LanguageSetting[]): void {
    for (const r of next) {
      const prev = seen[r.code];
      if (prev?.model === 'installing' && r.model.state === 'idle') messages.say(t('lang.modelDone', { name: r.name }), 'ok');
      if (prev?.model === 'installing' && r.model.state === 'failed') {
        messages.say(t('lang.modelFailed', { name: r.name, message: r.model.message }), 'err');
      }
      if (prev?.ocr === 'installing' && r.ocr.state === 'idle') messages.say(t('lang.ocrDone', { name: r.name }), 'ok');
      if (prev?.ocr === 'installing' && r.ocr.state === 'failed') {
        messages.say(t('lang.ocrFailed', { name: r.name, message: r.ocr.message }), 'err');
      }
      seen[r.code] = { model: r.model.state, ocr: r.ocr.state };
    }
  }

  async function loadSettings(): Promise<void> {
    const n = ++seq;
    try {
      const next = await get<LanguageSetting[]>('/api/language-settings');
      if (n !== seq || !mounted) return;
      announce(next);
      rows = next;
    } catch (err) {
      if (n === seq) messages.say(errMsg(err), 'err');
    }
  }

  async function load(): Promise<void> {
    try {
      const [r, c] = await Promise.all([get<Corpus[]>('/api/references'), get<CatalogEntry[]>('/api/language-catalog')]);
      refs = r;
      catalog = c;
      await loadSettings();
      loaded = true;
      // The rail and the context strip show language names: refresh them after any change here.
      loadLanguageNames().catch(() => {});
    } catch (err) {
      messages.say(errMsg(err), 'err');
    }
  }

  onMount(() => {
    load();
    return () => {
      mounted = false;
      seq++;
    };
  });

  $effect(() => {
    if (!installing) return;
    const id = setInterval(loadSettings, 2000);
    return () => clearInterval(id);
  });

  async function act(fn: () => Promise<void>): Promise<void> {
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

  const currentSize = (r: LanguageSetting) => chosen[r.code] ?? r.model_size ?? r.model.size ?? 'md';
  const sizeChanged = (r: LanguageSetting) => chosen[r.code] !== undefined && chosen[r.code] !== (r.model.size ?? r.model_size);

  const installModel = (r: LanguageSetting) =>
    act(async () => {
      const size = chosen[r.code];
      await post(`/api/languages/${r.code}/model`, size ? { size } : {});
      await loadSettings();
    });
  let uninstalling = $state.raw<LanguageSetting | null>(null);
  let uninstallOpen = $state(false);
  function askUninstall(r: LanguageSetting): void {
    uninstalling = r;
    uninstallOpen = true;
  }
  async function confirmUninstall(): Promise<void> {
    const r = uninstalling;
    uninstallOpen = false;
    if (!r) return;
    await act(async () => {
      await del(`/api/languages/${r.code}/model`);
      await loadSettings();
    });
  }
  const installOcr = (r: LanguageSetting) =>
    act(async () => {
      await post(`/api/languages/${r.code}/ocr`);
      await loadSettings();
    });
  const removeOcr = (r: LanguageSetting) =>
    act(async () => {
      await del(`/api/languages/${r.code}/ocr`);
      await loadSettings();
    });

  function askRemove(r: LanguageSetting): void {
    removing = r;
    alsoUninstall = false;
    removeOpen = true;
  }

  async function confirmRemove(): Promise<void> {
    const r = removing;
    removeOpen = false;
    if (!r) return;
    await act(async () => {
      await del(`/api/languages/${r.code}${alsoUninstall ? '?uninstall_model=true' : ''}`);
      messages.say(t('lang.removed', { name: r.name }), 'ok');
      delete seen[r.code];
      await load();
      // The first remaining language is shown now; the list is where the user picks next.
      panelOpen = false;
      focusItem(selected?.code);
    });
  }
</script>

<ListPanel label={t('nav.languages')} showPanel={panelOpen} onback={back}>
  {#snippet list()}
    <div class="lh">
      <span class="ltitle">{t('nav.languages')}</span>
      <Button onclick={() => (addOpen = true)}><span aria-hidden="true">+</span> {t('lang.add')}</Button>
    </div>
    <p class="lintro">{t('lang.introShort')}</p>
    <ul class="llist">
      {#each rows as r (r.code)}
        {@const st = langStatus(r, hasBase(r.code))}
        <li>
          <button type="button" id={itemId(r.code)} class="pick" aria-pressed={r.code === selected?.code} onclick={() => choose(r.code)}>
            <span class="ptop">
              <span class="pname">{r.name}</span>
              <Badge kind="neutral" label={r.code} />
            </span>
            <span class="dots">
              {#each DOTS as part (part)}
                <span class="st">
                  <span class="dot {st[part]}" aria-hidden="true"></span>
                  <span aria-hidden="true">{t(`lang.status.${part}`)}</span>
                  <span class="sr-only">{dotText(part, st[part])}</span>
                </span>
              {/each}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/snippet}

  {#snippet panel()}
    {#if loaded && selected}
      {@const r = selected}
      <div class="languages">
        <!-- Stays here until the panel is rebuilt; it applies to the base corpus import below. -->
        <Toggle bind:checked={force} label={t('src.force')} />
        <section class="card" aria-labelledby="{uid}-{r.code}">
          <h3><span id="{uid}-{r.code}">{r.name}</span> <span class="code">{r.code}</span></h3>

          <div class="line">
            <b>{t('lang.model')}</b>
            {#if r.model.state === 'installing'}
              <progress aria-label={t('lang.installing')}></progress>
              <span>{t('lang.installing')}</span>
            {:else if r.model.name}
              <span>{t('lang.modelLine', { name: r.model.name, version: r.model.version ?? '', size: r.model.size ?? '' })}</span>
            {:else}
              <span class="muted">{t('lang.notInstalled')}</span>
            {/if}
            {#if r.model.state === 'failed'}<span class="err" role="alert">{r.model.message}</span>{/if}
          </div>
          {#if r.model.state !== 'installing'}
            <div class="row">
              <select
                aria-label={t('lang.sizeFor', { name: r.name })}
                value={currentSize(r)}
                onchange={(e) => (chosen = { ...chosen, [r.code]: e.currentTarget.value })}
              >
                {#each sizesOf(r.code) as s (s)}<option value={s}>{s}</option>{/each}
              </select>
              {#if r.model.name}
                <Button
                  disabled={busy || !sizeChanged(r)}
                  ariaLabel={t('lang.changeSizeFor', { name: r.name })}
                  onclick={() => installModel(r)}>{t('lang.changeSize')}</Button
                >
                <Button variant="danger" disabled={busy} ariaLabel={t('lang.uninstallFor', { name: r.name })} onclick={() => askUninstall(r)}>
                  {t('lang.uninstall')}
                </Button>
              {:else}
                <Button variant="primary" disabled={busy} ariaLabel={t('lang.installFor', { name: r.name })} onclick={() => installModel(r)}>
                  {t('lang.install')}
                </Button>
              {/if}
            </div>
          {/if}

          <div class="line">
            <b>{t('lang.ocr')}</b>
            {#if !r.ocr.engine}
              <span class="muted">{t('lang.engineMissing')}</span>
            {:else if !r.tesseract}
              <span class="muted">{t('lang.noOcrCode')}</span>
            {:else if r.ocr.state === 'installing'}
              <progress aria-label={t('lang.installing')}></progress>
              <span>{t('lang.installing')}</span>
            {:else if r.ocr.available}
              <span>{t('lang.dataReady')}</span>
              <Button disabled={busy} ariaLabel={t('lang.removeOcrFor', { name: r.name })} onclick={() => removeOcr(r)}>{t('lang.removeData')}</Button>
            {:else}
              <span class="muted">{t('lang.dataMissing')}</span>
              <Button disabled={busy} ariaLabel={t('lang.installOcrFor', { name: r.name })} onclick={() => installOcr(r)}>{t('lang.installData')}</Button>
            {/if}
            {#if r.ocr.state === 'failed'}<span class="err" role="alert">{r.ocr.message}</span>{/if}
          </div>

          <div class="row">
            <Button
              ariaLabel={t('lang.editLabel', { name: r.name })}
              onclick={() => {
                editing = r;
                editOpen = true;
              }}>{t('lang.edit')}</Button
            >
            <Button variant="danger" disabled={busy || r.corpus_count > 0} ariaLabel={t('lang.removeLabel', { name: r.name })} onclick={() => askRemove(r)}>
              {t('lang.remove')}
            </Button>
            {#if r.corpus_count > 0}<span class="muted">{t('lang.blocked', { n: r.corpus_count })}</span>{/if}
          </div>

          <h4>{t('lang.baseCorpus')}</h4>
          <BaseCorpusCard lang={r.code} name={r.name} reference={refs.find((x) => x.lang === r.code) ?? null} {force} onchange={load} />
        </section>
      </div>
    {/if}
  {/snippet}
</ListPanel>

<AddLanguageDialog bind:open={addOpen} {catalog} onadded={load} />
<EditLanguageDialog bind:open={editOpen} lang={editing} sizes={editing ? sizesOf(editing.code) : SIZES} onsaved={load} />
<Dialog bind:open={uninstallOpen} title={t('lang.uninstallTitle', { name: uninstalling?.name ?? '' })}>
  <p class="confirm">{t('lang.uninstallBody')}</p>
  {#if uninstalling && uninstalling.corpus_count > 0}
    <p class="confirm err" role="alert">{t('lang.uninstallCorpora', { n: uninstalling.corpus_count })}</p>
  {/if}
  {#snippet footer()}
    <Button onclick={() => (uninstallOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={confirmUninstall}>{t('lang.uninstall')}</Button>
  {/snippet}
</Dialog>
<Dialog bind:open={removeOpen} title={t('lang.removeTitle', { name: removing?.name ?? '' })}>
  <p class="confirm">{t('lang.removeBody')}</p>
  <Toggle bind:checked={alsoUninstall} label={t('lang.alsoUninstall')} />
  {#snippet footer()}
    <Button onclick={() => (removeOpen = false)}>{t('common.cancel')}</Button>
    <Button variant="danger" onclick={confirmRemove}>{t('lang.remove')}</Button>
  {/snippet}
</Dialog>

<style>
  .languages {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3);
  }
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
  .lintro {
    margin: 0;
    padding: 0 var(--s-4) var(--s-2);
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .llist {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    margin: 0;
    padding: 0 var(--s-2) var(--s-2);
    list-style: none;
  }
  .pick {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--s-1);
    width: 100%;
    height: auto; /* base.css gives every button a fixed control height; the row holds two lines */
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
  .ptop {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
  }
  .pname {
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .dots {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1) var(--s-2);
    color: var(--muted);
    font-size: var(--fs-small);
    font-weight: 400;
  }
  .st {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
  }
  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--line);
  }
  .dot.ok {
    background: var(--status-approved);
  }
  .dot.busy {
    background: var(--status-candidate);
  }
  .dot.error {
    background: var(--danger);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
  }
  h3,
  h4 {
    margin: 0;
  }
  h4 {
    font-size: var(--fs-small);
    color: var(--muted);
  }
  .code {
    font-size: var(--fs-small);
    font-weight: 400;
    color: var(--muted);
  }
  .line,
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
  }
  .muted {
    color: var(--muted);
  }
  .err {
    color: var(--danger);
  }
  progress {
    width: 8rem;
    accent-color: var(--accent);
  }
  .confirm {
    margin: 0 0 var(--s-2);
  }
</style>
