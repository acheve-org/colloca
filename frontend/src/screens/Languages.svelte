<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { del, get, post } from '../lib/api';
  import { t } from '../lib/i18n';
  import { loadLanguageNames } from '../lib/context.svelte';
  import { messages } from '../lib/messages.svelte';
  import { viewport } from '../lib/viewport.svelte';
  import { langStatus, type Dot } from '../lib/langStatus';
  import type { CatalogEntry, Corpus, LanguageSetting } from '../lib/types';
  import ActionMenu from '../lib/ui/ActionMenu.svelte';
  import Badge from '../lib/ui/Badge.svelte';
  import BaseCorpusCard from '../lib/ui/BaseCorpusCard.svelte';
  import Button from '../lib/ui/Button.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import EmptyCard from '../lib/ui/EmptyCard.svelte';
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

  // Force re-import applies to one language's base corpus: it is switched off when another language is shown.
  let forceFor: string | undefined;
  $effect(() => {
    const code = selected?.code;
    if (code === forceFor) return;
    forceFor = code;
    force = false;
  });

  const itemId = (code: string) => `${uid}-item-${code}`;
  const focusItem = (code: string | undefined) =>
    tick().then(() => {
      if (code) document.getElementById(itemId(code))?.focus();
    });
  // Stacked: the list unmounts when the panel opens, so focus goes to the panel's heading.
  const choose = (code: string) => {
    selectedCode = code;
    panelOpen = true;
    if (viewport.stacked) tick().then(() => document.getElementById(`${uid}-name`)?.focus());
  };
  // Stacked: the list comes back; put focus on the language the user had chosen.
  const back = () => {
    panelOpen = false;
    focusItem(selected?.code);
  };

  const hasBase = (code: string) => refs.some((x) => x.lang === code);
  const DOTS = ['model', 'ocr', 'base'] as const;
  const dotText = (part: (typeof DOTS)[number], dot: Dot) => `${t(`lang.status.${part}`)}: ${t(`lang.status.${dot}`)}`;
  // Each state has its own shape, so colour is never the only signal.
  const SHAPE: Record<Dot, string> = { ok: 'disc', missing: 'ring', busy: 'half', error: 'cross' };
  const usedBy = (n: number) => (n === 0 ? t('lang.usedBy0') : n === 1 ? t('lang.usedBy1') : t('lang.usedBy', { n }));

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

  const currentSize = (r: LanguageSetting) => chosen[r.code] ?? r.model_size ?? r.model.size ?? 'lg';
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

  // A newly added language is selected (its panel opens on stacked screens) so its model can be installed right away.
  // A poll may overtake the reload, so the row can arrive later; until then the first language is shown.
  async function added(code: string): Promise<void> {
    await load();
    choose(code);
  }

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
      // Drop it now: a reload overtaken by a poll must not leave it listed and selected.
      rows = rows.filter((x) => x.code !== r.code);
      await load();
      // The first remaining language is shown now; the list is where the user picks next. The old
      // choice is forgotten, so adding this language back does not silently select it again.
      selectedCode = null;
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
                <span class="st" title={dotText(part, st[part])}>
                  <svg class="dot {st[part]}" data-shape={SHAPE[st[part]]} viewBox="0 0 10 10" aria-hidden="true">
                    {#if st[part] === 'ok' || st[part] === 'error'}
                      <circle cx="5" cy="5" r="5" fill="currentColor" />
                      {#if st[part] === 'error'}<path class="x" d="M3 3 L7 7 M7 3 L3 7" />{/if}
                    {:else}
                      <circle cx="5" cy="5" r="4.25" fill="none" stroke="currentColor" stroke-width="1.5" />
                      {#if st[part] === 'busy'}<path d="M5 0.75 A4.25 4.25 0 0 0 5 9.25 Z" fill="currentColor" />{/if}
                    {/if}
                  </svg>
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
      <section class="lp" aria-labelledby="{uid}-name">
        <header class="ph">
          <h2 id="{uid}-name" tabindex="-1">{r.name}</h2>
          <Badge kind="neutral" label={r.code} />
          <span class="muted small">{usedBy(r.corpus_count)}</span>
          <div class="hactions">
            <Button
              ariaLabel={t('lang.editLabel', { name: r.name })}
              onclick={() => {
                editing = r;
                editOpen = true;
              }}>{t('lang.edit')}</Button
            >
            <ActionMenu
              label={t('lang.actions')}
              disabled={busy}
              items={[{ label: t('lang.remove'), danger: true, disabled: r.corpus_count > 0, onclick: () => askRemove(r) }]}
            />
          </div>
        </header>
        {#if r.corpus_count > 0}<p class="muted small blocked">{t('lang.blocked')}</p>{/if}

        <section class="sec" aria-labelledby="{uid}-model">
          <h3 id="{uid}-model">{t('lang.model')}</h3>
          <div class="line">
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
        </section>

        <section class="sec" aria-labelledby="{uid}-ocr">
          <h3 id="{uid}-ocr">{t('lang.ocr')}</h3>
          <div class="line">
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
        </section>

        <section class="sec" aria-labelledby="{uid}-base">
          <h3 id="{uid}-base">{t('lang.baseCorpus')}</h3>
          <BaseCorpusCard lang={r.code} name={r.name} reference={refs.find((x) => x.lang === r.code) ?? null} {force} onchange={load} />
          <!-- Applies to this base corpus's uploads. -->
          <Toggle bind:checked={force} label={t('src.force')} />
        </section>
      </section>
    {:else if loaded}
      <EmptyCard icon="list" title={t('lang.empty')} hint={t('lang.emptyHint')}>
        {#snippet actions()}
          <Button variant="primary" onclick={() => (addOpen = true)}>{t('lang.add')}</Button>
        {/snippet}
      </EmptyCard>
    {/if}
  {/snippet}
</ListPanel>

<AddLanguageDialog bind:open={addOpen} {catalog} onadded={added} />
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
  .lp {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    min-width: 0;
    padding: var(--page-pad);
  }
  .ph {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
  }
  .ph h2 {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .hactions {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    margin-left: auto;
  }
  .blocked {
    margin: calc(-1 * var(--s-2)) 0 0;
  }
  .sec {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
    padding: var(--s-3);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
  }
  .sec h3 {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-small);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .small {
    font-size: var(--fs-small);
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
  /* Shapes per state: ok a disc, missing a ring, busy a half disc, error a disc with a cross. */
  .dot {
    flex: none;
    width: 0.625rem;
    height: 0.625rem;
    color: var(--muted);
  }
  .dot.ok {
    color: var(--status-approved);
  }
  .dot.busy {
    color: var(--status-candidate);
  }
  .dot.error {
    color: var(--danger);
  }
  .dot .x {
    stroke: var(--panel); /* the selected row's background; contrast with --danger is checked in contrast.test */
    stroke-width: 1.5;
    stroke-linecap: round;
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
