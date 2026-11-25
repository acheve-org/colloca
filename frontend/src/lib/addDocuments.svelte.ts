import { SvelteSet } from 'svelte/reactivity';
import { post, upload } from './api';
import { chunk, filterLinks, type Discovery } from './catalog';
import { CORPUS_CHANGED, corpusStore } from './corpus.svelte';
import { t } from './i18n';
import { trackJobs } from './jobs.svelte';
import { messages } from './messages.svelte';

export interface Quality {
  score: number;
  level: 'good' | 'fair' | 'poor';
  issues: { code: string; message: string }[];
}
export interface Preview {
  source: string;
  title: string;
  text: string;
  kind: 'url' | 'file';
  /** Only for a PDF: how reliable the extracted text looks. */
  quality?: Quality;
  warnings: string[];
}
export interface Meta {
  tags: string;
  text_type: string;
  doc_date: string;
  author: string;
}
export interface UploadResult {
  file: string;
  ok: boolean;
  job_id?: number;
  error?: string;
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const emptyMeta = (): Meta => ({ tags: '', text_type: '', doc_date: '', author: '' });

/** Everything typed, chosen or fetched for the documents to add next. */
class AddDraft {
  // Metadata applied to the documents added next, and the language override.
  meta = $state<Meta>(emptyMeta());
  force = $state(false);
  textColumns = $state('');
  url = $state('');
  urlList = $state('');
  preview = $state<Preview | null>(null);
  catalogUrl = $state('');
  catalog = $state.raw<Discovery | null>(null);
  picked = new SvelteSet<string>();
  linkFilter = $state('');
  sameHostOnly = $state(true);
  files = $state.raw<File[]>([]);
  pairFile = $state.raw<File | null>(null);
  partner = $state('');
  pairName = $state('');
  pairLang = $state('');
  swap = $state(false);
  pasteTitle = $state('');
  pasteText = $state('');
  /** Like the old select: the first option until one is picked. Not reactive on purpose. */
  partnerPicked = false;
  /** Whether more than one other language is set up, so a new partner needs its language. Set by the pairs form. */
  multiLang = false;
  /** File inputs register how to empty themselves, so an action can clear them after a submit. */
  clearInputs: { files?: () => void; pair?: () => void } = {};

  reset(): void {
    this.meta = emptyMeta();
    this.force = false;
    this.textColumns = '';
    this.url = '';
    this.urlList = '';
    this.preview = null;
    this.catalogUrl = '';
    this.catalog = null;
    this.picked.clear();
    this.linkFilter = '';
    this.sameHostOnly = true;
    this.files = [];
    this.pairFile = null;
    this.partner = '';
    this.pairName = '';
    this.pairLang = '';
    this.swap = false;
    this.pasteTitle = '';
    this.pasteText = '';
    this.partnerPicked = false;
    this.clearInputs.files?.();
    this.clearInputs.pair?.();
  }
}

export const draft = new AddDraft();
export const resetDraft = (): void => draft.reset();

/** What is being sent; the matching buttons are disabled meanwhile. */
export const work = $state<{ busy: string | null }>({ busy: null });

/** True while `id` is still the current corpus. */
export const still = (id: number): boolean => corpusStore.currentId === id;

/** Follows the jobs of the current corpus app-wide; `started` after submitting one. */
export function watch(started: boolean): void {
  const id = corpusStore.currentId;
  if (id !== null) trackJobs(id, started);
}

/**
 * Runs an action for the current corpus; nothing is applied if the corpus changed meanwhile.
 * Resolves to true only when the action resolved to true.
 */
export async function act(name: string, fn: (id: number) => Promise<boolean | void>): Promise<boolean> {
  const id = corpusStore.currentId;
  if (id === null) {
    messages.say(t('corpus.selectFirst'), 'err');
    return false;
  }
  if (work.busy) return false;
  work.busy = name;
  messages.say(t('corpus.working'));
  let ok = false;
  try {
    ok = (await fn(id)) === true;
  } catch (err) {
    if (corpusStore.currentId === id) messages.say(errMsg(err), 'err');
  } finally {
    if (work.busy === name) work.busy = null;
    // An action that ended without a message of its own (the corpus changed meanwhile).
    messages.clearWorking();
  }
  return ok;
}

export function metaSummary(): string {
  const m = draft.meta;
  return [
    m.tags.trim() && t('src.meta.sumTags', { v: m.tags.trim() }),
    m.text_type.trim() && t('src.meta.sumType', { v: m.text_type.trim() }),
    m.doc_date.trim() && t('src.meta.sumDate', { v: m.doc_date.trim() }),
    m.author.trim() && t('src.meta.sumAuthor', { v: m.author.trim() }),
  ]
    .filter(Boolean)
    .join(' · ');
}

const metaParams = () => ({ ...draft.meta });

function reportUpload(res: UploadResult[]): void {
  const bad = res.filter((r) => !r.ok);
  const n = res.length - bad.length;
  if (bad.length) {
    const list = bad.map((b) => `${b.file} (${b.error ?? ''})`).join('; ');
    messages.say(t('src.queuedRejected', { n, list }), 'err');
  } else {
    messages.say(t('src.queued', { n }), 'ok');
  }
}

export const visibleLinks = () => (draft.catalog ? filterLinks(draft.catalog.links, draft.linkFilter, draft.sameHostOnly) : []);
export const pickedCount = () => visibleLinks().filter((l) => draft.picked.has(l.url)).length;

export type Method = 'web' | 'up' | 'paste' | 'al';

/** The primary action of the add page for a method and sub-choice: its label, whether it can run, and the summary line. */
export function actionFor(m: Method, sub: string): { label: string; enabled: boolean; summary: string } {
  let label: string;
  let enabled: boolean;
  let what: string;
  if (m === 'web' && sub === 'list') {
    const n = draft.urlList.split('\n').filter((l) => l.trim()).length;
    label = t('src.urls.go');
    enabled = n > 0;
    what = n ? t('add.what.addresses', { n }) : t('add.what.typeAddresses');
  } else if (m === 'web' && sub === 'index') {
    const n = pickedCount();
    const found = draft.catalog !== null;
    label = found ? t('add.act.import', { n }) : t('add.act.importNone');
    enabled = found && n > 0;
    what = found ? t('add.what.selected', { n, total: visibleLinks().length }) : t('add.what.findLinks');
  } else if (m === 'web') {
    label = t('src.url.add');
    enabled = draft.preview !== null;
    what = enabled ? t('add.what.page') : t('add.what.fetchFirst');
  } else if (m === 'up') {
    const n = draft.files.length;
    label = t('src.upload.go');
    enabled = n > 0;
    what = n ? t('add.what.files', { n }) : t('add.what.chooseFiles');
  } else if (m === 'paste') {
    label = t('src.paste.go');
    enabled = draft.pasteText.trim() !== '';
    what = enabled ? t('add.what.text') : t('add.what.pasteFirst');
  } else {
    label = t('src.pair.go');
    const named = draft.partner !== 'new' || draft.pairName.trim() !== '';
    enabled = draft.pairFile !== null && named;
    what = draft.pairFile === null ? t('add.what.chooseFile') : named ? draft.pairFile.name : t('add.what.nameCorpus');
  }
  const into = t('add.summary.into', { name: corpusStore.current?.name ?? '' });
  return { label, enabled, summary: [what, into, metaSummary() || t('add.noMeta')].join(' · ') };
}

export function pickLinks(urls: string[], on: boolean): void {
  for (const u of urls) {
    if (on) draft.picked.add(u);
    else draft.picked.delete(u);
  }
}

export const fetchPreview = () =>
  act('preview', async (id) => {
    const u = draft.url.trim();
    if (!u) {
      messages.say(t('src.url.needed'), 'err');
      return false;
    }
    const r = await post<{ url: string; title: string; text: string; quality?: Quality; warnings?: string[] }>('/api/preview-url', { url: u });
    if (!still(id)) return false;
    draft.preview = { source: r.url, title: r.title, text: r.text, kind: 'url', quality: r.quality, warnings: r.warnings ?? [] };
    messages.clear();
    return true;
  });

/** Read the one chosen file without adding it, so the text (and, for a PDF, its quality) can be checked first. */
export const previewFile = () =>
  act('preview', async (id) => {
    if (draft.files.length !== 1) {
      messages.say(t('src.preview.one'), 'err');
      return false;
    }
    const fd = new FormData();
    fd.append('file', draft.files[0]);
    const r = await upload<{ source: string; title: string; text: string; quality?: Quality; warnings?: string[] }>('/api/preview-file', fd, {
      corpus_id: id,
      columns: draft.textColumns.trim(),
    });
    if (!still(id)) return false;
    draft.preview = { source: r.source, title: r.title, text: r.text, kind: 'file', quality: r.quality, warnings: r.warnings ?? [] };
    messages.clear();
    return true;
  });

export const addPreview = () =>
  act('add', async (id) => {
    const p = draft.preview;
    if (!p) return false;
    await post(
      `/api/corpora/${id}/documents`,
      { title: p.title, text: p.text, source: p.source, kind: p.kind, ...metaParams() },
      { background: true, force_language: draft.force },
    );
    if (!still(id)) return false;
    draft.preview = null;
    draft.url = '';
    messages.say(t('src.queuedProgress'), 'ok');
    watch(true);
    return true;
  });

export const addUrlList = () =>
  act('urls', async (id) => {
    const urls = draft.urlList.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!urls.length) {
      messages.say(t('src.urls.needed'), 'err');
      return false;
    }
    const res = await post<{ url: string; ok: boolean; error?: string }[]>(`/api/corpora/${id}/urls`, {
      urls,
      force_language: draft.force,
      ...metaParams(),
    });
    if (!still(id)) return false;
    draft.urlList = '';
    reportUpload(res.map((r) => ({ file: r.url, ok: r.ok, error: r.error })));
    watch(true);
    return true;
  });

export const findLinks = () =>
  act('catalog', async (id) => {
    const u = draft.catalogUrl.trim();
    if (!u) {
      messages.say(t('src.url.needed'), 'err');
      return false;
    }
    const found = await post<Discovery>('/api/discover-links', { url: u });
    if (!still(id)) return false;
    draft.catalog = found;
    draft.picked.clear();
    for (const l of filterLinks(found.links, '', true)) draft.picked.add(l.url);
    draft.linkFilter = '';
    draft.sameHostOnly = true;
    messages.say(found.links.length ? t('src.catalog.found', { n: found.links.length }) : t('src.catalog.none'), 'ok');
    return true;
  });

export const importSelected = () =>
  act('catalog', async (id) => {
    const urls = visibleLinks().filter((l) => draft.picked.has(l.url)).map((l) => l.url);
    if (!urls.length) {
      messages.say(t('src.catalog.needed'), 'err');
      return false;
    }
    const results: UploadResult[] = [];
    for (const part of chunk(urls, draft.catalog?.max_per_request ?? 20)) {
      try {
        const res = await post<{ url: string; ok: boolean; error?: string }[]>(`/api/corpora/${id}/urls`, {
          urls: part,
          force_language: draft.force,
          ...metaParams(),
        });
        results.push(...res.map((r) => ({ file: r.url, ok: r.ok, error: r.error })));
      } catch (err) {
        // one failed request must not stop the next ones
        results.push(...part.map((u) => ({ file: u, ok: false, error: errMsg(err) })));
      }
      if (!still(id)) return false;
    }
    reportUpload(results);
    watch(true);
    return true;
  });

export const uploadFiles = () =>
  act('upload', async (id) => {
    if (!draft.files.length) {
      messages.say(t('src.upload.choose'), 'err');
      return false;
    }
    const fd = new FormData();
    for (const f of draft.files) fd.append('files', f);
    const res = await upload<UploadResult[]>(`/api/corpora/${id}/upload`, fd, {
      force_language: draft.force,
      columns: draft.textColumns.trim(),
      ...metaParams(),
    });
    if (!still(id)) return false;
    draft.files = [];
    draft.clearInputs.files?.();
    reportUpload(res);
    watch(true);
    return true;
  });

export const uploadPairs = () =>
  act('pairs', async (id) => {
    const f = draft.pairFile;
    if (!f) {
      messages.say(t('src.pair.choose'), 'err');
      return false;
    }
    if (draft.partner === 'new' && !draft.pairName.trim()) {
      messages.say(t('src.pair.nameNeeded'), 'err');
      return false;
    }
    const fd = new FormData();
    fd.append('files', f);
    const target =
      draft.partner === 'new'
        ? { partner_name: draft.pairName.trim(), ...(draft.multiLang ? { partner_lang: draft.pairLang } : {}) }
        : { partner_corpus_id: draft.partner };
    const res = await upload<UploadResult[]>(`/api/corpora/${id}/upload-pairs`, fd, {
      ...target,
      swap: draft.swap,
      force_language: draft.force,
      ...metaParams(),
    });
    if (!still(id)) return false;
    draft.pairFile = null;
    draft.pairName = '';
    draft.partnerPicked = false; // back to the first option, which may be the corpus just created
    draft.partner = '';
    draft.clearInputs.pair?.();
    const bad = res.filter((r) => !r.ok);
    if (bad.length) messages.say(t('src.pair.rejected', { error: bad[0].error ?? '' }), 'err');
    else messages.say(t('src.queuedProgress'), 'ok');
    watch(true);
    return true;
  });

export const addPaste = () =>
  act('paste', async (id) => {
    if (!draft.pasteText.trim()) {
      messages.say(t('src.paste.needed'), 'err');
      return false;
    }
    await post(
      `/api/corpora/${id}/documents`,
      { title: draft.pasteTitle.trim() || t('src.paste.defaultTitle'), text: draft.pasteText, kind: 'paste', ...metaParams() },
      { background: true, force_language: draft.force },
    );
    if (!still(id)) return false;
    draft.pasteText = '';
    draft.pasteTitle = '';
    messages.say(t('src.queuedProgress'), 'ok');
    watch(true);
    return true;
  });

if (typeof window !== 'undefined') {
  window.addEventListener(CORPUS_CHANGED, () => {
    resetDraft();
    work.busy = null;
  });
}
