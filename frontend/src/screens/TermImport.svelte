<script module lang="ts">
  const FIELDS = [
    'src_term',
    'tgt_term',
    'pos',
    'status',
    'domain',
    'definition',
    'notes',
    'context',
    'src_lang',
    'tgt_lang',
  ] as const;
  const STATUSES = ['candidate', 'approved', 'admitted', 'superseded', 'forbidden'] as const;

  interface Preview {
    kind: 'sheet' | 'tbx';
    rows?: string[][];
    columns?: number;
    total_rows?: number;
    header?: boolean;
    mapping?: Record<string, number>;
  }
  interface Row {
    row: number | string;
    src_term: string;
    tgt_term: string;
    reason?: string;
    status?: string;
  }
  interface Report {
    format: string;
    src_lang: string;
    tgt_lang: string;
    applied: boolean;
    to_add: number;
    duplicates: number;
    rejected: number;
    total: number;
    sample: Row[];
    duplicate_rows: Row[];
    rejected_rows: Row[];
  }
</script>

<script lang="ts">
  import { get, upload } from '../lib/api';
  import { t } from '../lib/i18n';
  import { messages } from '../lib/messages.svelte';
  import type { Project } from '../lib/types';
  import Button from '../lib/ui/Button.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Select from '../lib/ui/Select.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';

  interface Props {
    open: boolean;
    projects: Project[];
    /** The termbase scope on screen: '' / 'none' / a project id. */
    scope: string;
    onimported: () => void;
  }
  let { open = $bindable(), projects, scope, onimported }: Props = $props();

  let file = $state.raw<File | null>(null);
  let preview = $state.raw<Preview | null>(null);
  let report = $state.raw<Report | null>(null);
  let busy = $state(false);
  let header = $state(true);
  let mapping = $state<Record<string, string>>({});
  let project = $state('none');
  let srcLang = $state('es');
  let tgtLang = $state('it');
  let defaultStatus = $state('candidate');
  let langs = $state.raw<Record<string, string>>({});

  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const langOptions = $derived(
    Object.entries(langs).map(([value, label]) => ({ value, label })),
  );
  const projectOptions = $derived([
    { value: 'none', label: t('tb.scope.none') },
    ...projects.map((p) => ({ value: String(p.id), label: p.name })),
  ]);
  const cols = $derived(Array.from({ length: preview?.columns ?? 0 }, (_, i) => i));
  const statusOptions = STATUSES.map((s) => ({ value: s, label: t(`badge.${s}`) }));

  function reset(): void {
    file = null;
    preview = null;
    report = null;
    mapping = {};
    header = true;
    defaultStatus = 'candidate';
    project = scope === '' ? 'none' : scope;
  }

  $effect(() => {
    if (!open) return;
    reset();
    get<Record<string, string>>('/api/languages')
      .then((l) => {
        langs = l;
        const codes = Object.keys(l);
        srcLang = codes[0] ?? '';
        tgtLang = codes[1] ?? '';
      })
      .catch((err) => messages.say(errMsg(err), 'err'));
  });

  // Any change of the settings makes an earlier dry run stale.
  const stale = () => (report = null);

  async function choose(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    file = input.files?.[0] ?? null;
    preview = null;
    report = null;
    if (!file) return;
    busy = true;
    try {
      const fd = new FormData();
      fd.append('file', file);
      preview = await upload<Preview>('/api/terms/import/preview', fd);
      if (preview.kind === 'sheet') {
        header = !!preview.header;
        mapping = Object.fromEntries(Object.entries(preview.mapping ?? {}).map(([k, v]) => [k, String(v)]));
      }
    } catch (err) {
      file = null;
      input.value = '';
      messages.say(errMsg(err), 'err');
    } finally {
      busy = false;
    }
  }

  async function send(dryRun: boolean): Promise<void> {
    if (!file || busy) return;
    busy = true;
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('dry_run', String(dryRun));
      if (project !== 'none') fd.append('project_id', project);
      if (preview?.kind === 'sheet') {
        fd.append('src_lang', srcLang);
        fd.append('tgt_lang', tgtLang);
        fd.append('header', String(header));
        fd.append(
          'mapping',
          JSON.stringify(
            Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])),
          ),
        );
      }
      fd.append('default_status', defaultStatus);
      const res = await upload<Report>('/api/terms/import', fd);
      if (dryRun) {
        report = res;
      } else {
        messages.say(t('imp.done', { n: res.to_add }), 'ok');
        open = false;
        onimported();
      }
    } catch (err) {
      messages.say(errMsg(err), 'err');
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title={t('imp.title')} wide>
  <div class="imp">
    <Field label={t('imp.file')}>
      <input type="file" accept=".xlsx,.csv,.tsv,.tbx,.xml" disabled={busy} onchange={choose} />
    </Field>
    <p class="hint">{t('imp.hint')}</p>

    {#if preview}
      <div class="grid">
        <Field label={t('imp.project')}>
          <Select label={t('imp.project')} bind:value={project} options={projectOptions} onchange={stale} />
        </Field>
        {#if preview.kind === 'sheet'}
          <Field label={t('imp.srcLang')}>
            <Select label={t('imp.srcLang')} bind:value={srcLang} options={langOptions} onchange={stale} />
          </Field>
          <Field label={t('imp.tgtLang')}>
            <Select label={t('imp.tgtLang')} bind:value={tgtLang} options={langOptions} onchange={stale} />
          </Field>
        {/if}
        <Field label={t('imp.defaultStatus')}>
          <Select label={t('imp.defaultStatus')} bind:value={defaultStatus} options={statusOptions} onchange={stale} />
        </Field>
      </div>

      {#if preview.kind === 'sheet' && preview.rows}
        <Toggle bind:checked={header} label={t('imp.header')} onchange={stale} />
        <div class="scroll">
          <table class="sample" aria-label={t('imp.preview')}>
            <thead>
              <tr>
                {#each cols as i (i)}
                  <th>
                    <Select
                      label={t('imp.mapColumn', { n: i + 1 })}
                      value={Object.entries(mapping).find(([, v]) => v === String(i))?.[0] ?? ''}
                      options={[
                        { value: '', label: t('imp.ignore') },
                        ...FIELDS.map((f) => ({ value: f, label: t(`imp.field.${f}`) })),
                      ]}
                      onchange={(f) => {
                        const next = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== String(i)));
                        if (f) next[f] = String(i);
                        mapping = next;
                        stale();
                      }}
                    />
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each preview.rows as row, r (r)}
                <tr class:head={header && r === 0}>
                  {#each cols as i (i)}<td>{row[i] ?? ''}</td>{/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if !('src_term' in mapping)}<p class="err">{t('imp.needSource')}</p>{/if}
      {:else}
        <p class="hint">{t('imp.tbxHint')}</p>
      {/if}
    {/if}

    {#if report}
      <section class="report" aria-label={t('imp.report')}>
        <p>
          <b>{t('imp.langs', { src: report.src_lang, tgt: report.tgt_lang })}</b>
          · {t('imp.toAdd', { n: report.to_add })} · {t('imp.dups', { n: report.duplicates })} ·
          {t('imp.rejected', { n: report.rejected })}
        </p>
        {#if report.rejected_rows.length}
          <h3>{t('imp.rejectedTitle')}</h3>
          <ul>
            {#each report.rejected_rows as r (r.row)}
              <li>{t('imp.rowLine', { row: r.row, term: [r.src_term, r.tgt_term].filter(Boolean).join(' → ') })}: {r.reason}</li>
            {/each}
          </ul>
        {/if}
        {#if report.duplicate_rows.length}
          <h3>{t('imp.dupTitle')}</h3>
          <ul>
            {#each report.duplicate_rows as r (r.row)}
              <li>{t('imp.rowLine', { row: r.row, term: [r.src_term, r.tgt_term].filter(Boolean).join(' → ') })}</li>
            {/each}
          </ul>
        {/if}
        {#if report.rejected > report.rejected_rows.length || report.duplicates > report.duplicate_rows.length}
          <p class="hint">{t('imp.truncated')}</p>
        {/if}
      </section>
    {/if}
  </div>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>{t('common.cancel')}</Button>
    <Button disabled={!file || busy || (preview?.kind === 'sheet' && !('src_term' in mapping))} onclick={() => send(true)}>
      {t('imp.check')}
    </Button>
    <Button variant="primary" disabled={!report || report.to_add === 0 || busy} onclick={() => send(false)}>
      {report ? t('imp.apply', { n: report.to_add }) : t('imp.applyNone')}
    </Button>
  {/snippet}
</Dialog>

<style>
  .imp {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    min-width: min(52rem, 85vw);
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-3);
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-small);
  }
  .err {
    margin: 0;
    color: var(--status-forbidden);
  }
  .scroll {
    overflow: auto;
    max-height: 16rem;
    border: 1px solid var(--line);
  }
  .sample {
    border-collapse: collapse;
    font-size: var(--fs-small);
  }
  .sample td,
  .sample th {
    padding: var(--s-1) var(--s-2);
    border-bottom: 1px solid var(--line);
    text-align: left;
    white-space: nowrap;
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .head td {
    font-weight: 600;
    color: var(--muted);
  }
  .report {
    max-height: 14rem;
    overflow: auto;
    font-size: var(--fs-small);
  }
  .report h3 {
    margin: var(--s-2) 0 var(--s-1);
    font-size: var(--fs-small);
  }
  .report ul {
    margin: 0;
    padding-left: var(--s-4);
  }
</style>
