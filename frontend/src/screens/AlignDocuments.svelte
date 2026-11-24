<script lang="ts">
  import { post, upload } from '../lib/api';
  import {
    fromProposal, isLow, linkType, mergeNext, removeLink, report, splitLink, storable,
    type AlignLink, type AlignProposal,
  } from '../lib/align';
  import { corpusStore } from '../lib/corpus.svelte';
  import { t } from '../lib/i18n';
  import { trackJobs } from '../lib/jobs.svelte';
  import { messages } from '../lib/messages.svelte';
  import Badge from '../lib/ui/Badge.svelte';
  import Button from '../lib/ui/Button.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';

  const uid = $props.id();
  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

  let sourceFile = $state.raw<File | null>(null);
  let targetFile = $state.raw<File | null>(null);
  let sourceInput: HTMLInputElement | undefined = $state();
  let targetInput: HTMLInputElement | undefined = $state();
  let busy = $state(false);

  // The proposal under review; `corpusId` is the corpus it was made for.
  let proposal = $state.raw<AlignProposal | null>(null);
  let corpusId = $state<number | null>(null);
  let links = $state.raw<AlignLink[]>([]);
  let onlyLow = $state(false);
  let docTitle = $state('');
  let partner = $state('');
  let partnerName = $state('');
  let splitting = $state<number | null>(null);
  let splitS = $state('1');
  let splitT = $state('1');

  const rep = $derived(report(links));
  const shown = $derived(links.map((l, i) => ({ l, i })).filter(({ l }) => !onlyLow || isLow(l)));
  const typeSummary = $derived(
    Object.entries(rep.byType)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ×${n}`)
      .join(', ') || '–',
  );
  const partnerOptions = $derived.by(() => {
    const cur = corpusStore.current;
    const others = cur ? corpusStore.list.filter((c) => c.id !== cur.id && c.lang !== cur.lang && !c.is_reference) : [];
    return [
      ...others.map((c) => ({ value: String(c.id), label: `${c.name} [${c.lang}]` })),
      { value: 'new', label: t('src.pair.newCorpus') },
    ];
  });
  $effect(() => {
    if (!partnerOptions.some((o) => o.value === partner)) partner = partnerOptions[0].value;
  });

  async function propose(): Promise<void> {
    const id = corpusStore.currentId;
    if (id === null) return;
    if (!sourceFile || !targetFile) {
      messages.say(t('align.choose'), 'err');
      return;
    }
    const fd = new FormData();
    fd.append('source', sourceFile);
    fd.append('target', targetFile);
    busy = true;
    try {
      const p = await upload<AlignProposal>(`/api/corpora/${id}/align/propose`, fd);
      if (corpusStore.currentId !== id) return;
      proposal = p;
      corpusId = id;
      links = fromProposal(p);
      docTitle = p.title;
      onlyLow = false;
      splitting = null;
    } catch (err) {
      messages.say(t('align.failed', { error: errMsg(err) }), 'err');
    } finally {
      busy = false;
    }
  }

  function discard(): void {
    proposal = null;
    links = [];
    splitting = null;
  }

  function openSplit(i: number): void {
    if (splitting === i) {
      splitting = null;
      return;
    }
    splitting = i;
    splitS = String(Math.min(1, links[i].src.length));
    splitT = String(Math.min(1, links[i].tgt.length));
  }

  function doSplit(i: number): void {
    links = splitLink(links, i, Number(splitS), Number(splitT));
    splitting = null;
  }

  const range = (n: number) => Array.from({ length: n + 1 }, (_, k) => ({ value: String(k), label: String(k) }));
  const canSplit = (l: AlignLink) => l.src.length + l.tgt.length >= 2;

  async function confirm(): Promise<void> {
    if (corpusId === null || !proposal) return;
    if (partner === 'new' && !partnerName.trim()) {
      messages.say(t('src.pair.nameNeeded'), 'err');
      return;
    }
    busy = true;
    try {
      const target = partner === 'new' ? { partner_name: partnerName.trim() } : { partner_corpus_id: Number(partner) };
      await post(`/api/corpora/${corpusId}/align/confirm`, {
        links: links.map((l) => ({ src: l.src, tgt: l.tgt, low: isLow(l) })),
        title: docTitle.trim(),
        ...target,
      });
      messages.say(t('align.confirmed'), 'ok');
      trackJobs(corpusId, true);
      discard();
      partnerName = '';
      sourceFile = targetFile = null;
      if (sourceInput) sourceInput.value = '';
      if (targetInput) targetInput.value = '';
    } catch (err) {
      messages.say(errMsg(err), 'err');
    } finally {
      busy = false;
    }
  }
</script>

<section class="card" class:wide={proposal} aria-labelledby="{uid}-t">
  <h3 id="{uid}-t">{t('align.title')}</h3>
  {#if !proposal}
    <Field label={t('align.source')}>
      <input bind:this={sourceInput} type="file" accept=".docx,.pdf,.txt,.md,.html,.htm" aria-label={t('align.source')}
        onchange={(e) => (sourceFile = e.currentTarget.files?.[0] ?? null)} />
    </Field>
    <Field label={t('align.target')}>
      <input bind:this={targetInput} type="file" accept=".docx,.pdf,.txt,.md,.html,.htm" aria-label={t('align.target')}
        onchange={(e) => (targetFile = e.currentTarget.files?.[0] ?? null)} />
    </Field>
    <div class="row">
      <span class="grow"></span>
      <Button variant="primary" disabled={busy} onclick={propose}>{busy ? t('align.working') : t('align.go')}</Button>
    </div>
    <p class="hint">{t('align.hint')}</p>
  {:else}
    <h4>{t('align.review', { title: proposal.title })}</h4>
    <p class="report" role="status">
      {t('align.report', { links: rep.links, types: typeSummary, low: rep.low, pct: Math.round(rep.lowShare * 100) })}
      {#if rep.unstorable}<br />{t('align.unstorable', { n: rep.unstorable })}{/if}
    </p>
    <Toggle bind:checked={onlyLow} label={t('align.onlyLow')} />
    {#if shown.length === 0}
      <p class="hint">{t('align.noLinks')}</p>
    {:else}
      <div class="grid" role="table" aria-label={t('align.title')}>
        <div class="head" role="row">
          <span role="columnheader">{t('align.colType')}</span>
          <span role="columnheader">{t('align.colSource', { lang: proposal.source_lang })}</span>
          <span role="columnheader">{t('align.colTarget', { lang: proposal.target_lang })}</span>
          <span role="columnheader">{t('align.colActions')}</span>
        </div>
        {#each shown as { l, i } (i)}
          <div class="link" class:low={isLow(l)} role="row" data-testid="link">
            <span role="cell" class="type">
              {linkType(l)}
              {#if isLow(l)}
                <Badge kind="candidate" label={`⚠ ${t('align.low')}`} />
                <span class="sr" title={t('align.lowTitle', { pct: Math.round(l.confidence * 100) })}>{Math.round(l.confidence * 100)}%</span>
              {:else if l.edited}
                <Badge kind="neutral" label={t('align.reviewed')} />
              {/if}
            </span>
            <span role="cell" class="side">
              {#each l.src as s, k (k)}<span class="sent">{s}</span>{:else}<em>{t('align.empty')}</em>{/each}
            </span>
            <span role="cell" class="side">
              {#each l.tgt as s, k (k)}<span class="sent">{s}</span>{:else}<em>{t('align.empty')}</em>{/each}
            </span>
            <span role="cell" class="actions">
              <Button disabled={i + 1 >= links.length} onclick={() => (links = mergeNext(links, i))}>{t('align.mergeNext')}</Button>
              <Button disabled={!canSplit(l)} onclick={() => openSplit(i)}>{t('align.split')}</Button>
              <Button variant="danger" onclick={() => (links = removeLink(links, i))}>{t('align.remove')}</Button>
              {#if splitting === i}
                <span class="splitform">
                  <Select label={t('align.splitSource')} bind:value={splitS} options={range(l.src.length)} />
                  <Select label={t('align.splitTarget')} bind:value={splitT} options={range(l.tgt.length)} />
                  <Button onclick={() => doSplit(i)}>{t('align.splitDo')}</Button>
                </span>
              {/if}
            </span>
          </div>
        {/each}
      </div>
    {/if}
    <div class="row">
      <Field label={t('align.docTitle')}><input bind:value={docTitle} maxlength="200" /></Field>
      <Field label={t('align.partner')}><Select label={t('align.partner')} bind:value={partner} options={partnerOptions} /></Field>
      {#if partner === 'new'}
        <input bind:value={partnerName} maxlength="120" placeholder={t('src.pair.namePlaceholder')} aria-label={t('src.pair.name')} />
      {/if}
      <span class="grow"></span>
      <Button onclick={discard}>{t('align.discard')}</Button>
      <Button variant="primary" disabled={busy || links.filter(storable).length === 0} onclick={confirm}>{t('align.confirm')}</Button>
    </div>
  {/if}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
  }
  .card.wide {
    grid-column: 1 / -1;
  }
  .card :global(.field) {
    display: flex;
  }
  .card input[type='file'] {
    height: auto;
    padding: var(--s-1);
    max-width: 100%;
  }
  .hint {
    margin: var(--s-1) 0 0;
    color: var(--muted);
    font-size: var(--fs-small);
  }
  h3,
  h4 {
    margin: 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--s-2);
  }
  .grow {
    flex: 1;
  }
  .report {
    margin: var(--s-1) 0;
  }
  .grid {
    max-height: 60vh;
    overflow: auto;
    border: 1px solid var(--line);
    margin: var(--s-2) 0;
  }
  .head,
  .link {
    display: grid;
    grid-template-columns: 7rem 1fr 1fr 14rem;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-2);
  }
  .head {
    position: sticky;
    top: 0;
    background: var(--surface);
    font-weight: 600;
    border-bottom: 1px solid var(--line);
  }
  .link {
    border-bottom: 1px solid var(--line);
  }
  .link.low {
    border-left: 4px solid var(--status-candidate);
  }
  .sent {
    display: block;
  }
  .sent + .sent {
    margin-top: var(--s-1);
    padding-top: var(--s-1);
    border-top: 1px dotted var(--line);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
    align-content: flex-start;
  }
  .splitform {
    display: flex;
    gap: var(--s-1);
    flex-basis: 100%;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .type {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;
  }
</style>
