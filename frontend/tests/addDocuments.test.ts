import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  addPaste,
  findLinks,
  addUrlList,
  importSelected,
  draft,
  metaSummary,
  resetDraft,
  still,
  uploadFiles,
  work,
} from '../src/lib/addDocuments.svelte';
import { CORPUS_CHANGED, corpusStore } from '../src/lib/corpus.svelte';
import { stopAllJobs } from '../src/lib/jobs.svelte';
import { messages } from '../src/lib/messages.svelte';
import { t } from '../src/lib/i18n';

interface Call { method: string; path: string; params: URLSearchParams; body?: unknown }
let calls: Call[];
let postStatus: number;

beforeEach(() => {
  calls = [];
  postStatus = 202;
  corpusStore.list = [{ id: 1, name: 'C1', lang: 'es', project_id: null, is_reference: 0, docs: 0, tokens: 0 }];
  corpusStore.currentId = 1;
  corpusStore.loaded = true;
  messages.clear();
  work.busy = null;
  resetDraft();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://x');
    const raw = init?.body;
    calls.push({ method: init?.method ?? 'GET', path: u.pathname, params: u.searchParams, body: typeof raw === 'string' ? JSON.parse(raw) : raw });
    if (u.pathname.endsWith('/documents') && init?.method === 'POST') {
      return { ok: postStatus < 400, status: postStatus, statusText: 'x', json: async () => ({ detail: 'boom' }) };
    }
    return { ok: true, status: 200, statusText: 'x', json: async () => [] };
  }));
});

afterEach(() => {
  stopAllJobs();
  vi.unstubAllGlobals();
});

const posts = () => calls.filter((c) => c.method === 'POST');

describe('draft', () => {
  it('resetDraft restores every field', () => {
    draft.meta.tags = 'x';
    draft.force = true;
    draft.url = 'u';
    draft.sameHostOnly = false;
    draft.picked.add('a');
    draft.pasteText = 'hi';
    draft.files = [new File(['a'], 'a.txt')];
    resetDraft();
    expect(draft.meta).toEqual({ tags: '', text_type: '', doc_date: '', author: '' });
    expect(draft.force).toBe(false);
    expect(draft.url).toBe('');
    expect(draft.sameHostOnly).toBe(true);
    expect(draft.picked.size).toBe(0);
    expect(draft.pasteText).toBe('');
    expect(draft.files).toEqual([]);
    expect(draft.preview).toBeNull();
  });

  it('resetDraft({ keepMeta }) clears the source inputs but keeps the details and the language override', () => {
    draft.meta.tags = 'x';
    draft.meta.author = 'Ana';
    draft.force = true;
    draft.url = 'u';
    draft.urlList = 'l';
    draft.catalogUrl = 'c';
    draft.picked.add('a');
    draft.pasteText = 'hi';
    draft.pasteTitle = 'T';
    draft.textColumns = '2';
    draft.files = [new File(['a'], 'a.txt')];
    draft.preview = { source: 's', title: 't', text: 'x', kind: 'file', warnings: [] };
    const clear = vi.fn();
    draft.onClear('files', clear);
    resetDraft({ keepMeta: true });
    expect(draft.meta).toEqual({ tags: 'x', text_type: '', doc_date: '', author: 'Ana' });
    expect(draft.force).toBe(true);
    expect(draft.url).toBe('');
    expect(draft.urlList).toBe('');
    expect(draft.catalogUrl).toBe('');
    expect(draft.picked.size).toBe(0);
    expect(draft.pasteText).toBe('');
    expect(draft.pasteTitle).toBe('');
    expect(draft.textColumns).toBe('');
    expect(draft.files).toEqual([]);
    expect(draft.preview).toBeNull();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('the file input clear callbacks are registered and removed per key', () => {
    const files = vi.fn();
    const pair = vi.fn();
    const offFiles = draft.onClear('files', files);
    const offPair = draft.onClear('pair', pair);
    offFiles();
    resetDraft();
    expect(files).not.toHaveBeenCalled();
    expect(pair).toHaveBeenCalledTimes(1);
    offPair();
    // a stale unregister does not remove a newer registration of the same key
    const newer = vi.fn();
    const stale = draft.onClear('files', files);
    draft.onClear('files', newer);
    stale();
    resetDraft();
    expect(newer).toHaveBeenCalledTimes(1);
    expect(files).not.toHaveBeenCalled();
  });

  it('metaSummary joins the filled pieces', () => {
    draft.meta.tags = ' wind ';
    draft.meta.text_type = 'news';
    expect(metaSummary()).toBe(`${t('src.meta.sumTags', { v: 'wind' })} · ${t('src.meta.sumType', { v: 'news' })}`);
    resetDraft();
    expect(metaSummary()).toBe('');
  });

  it('a corpus change clears the draft and the busy flag', () => {
    draft.pasteText = 'hi';
    work.busy = 'paste';
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED));
    expect(draft.pasteText).toBe('');
    expect(work.busy).toBeNull();
  });
});

describe('act', () => {
  it('sends nothing and says so when no corpus is selected', async () => {
    corpusStore.currentId = null;
    const fn = vi.fn(async () => true);
    expect(await act('x', fn)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(messages.current?.text).toBe(t('corpus.selectFirst'));
  });

  it('resolves true only when the action resolves true', async () => {
    expect(await act('a', async () => true)).toBe(true);
    expect(await act('a', async () => false)).toBe(false);
    expect(await act('a', async () => {})).toBe(false);
    expect(await act('a', async () => { throw new Error('no'); })).toBe(false);
    expect(work.busy).toBeNull();
  });

  it('ignores a second call while one runs', async () => {
    let release!: () => void;
    const first = act('one', () => new Promise<boolean>((r) => (release = () => r(true))));
    expect(work.busy).toBe('one');
    const fn = vi.fn(async () => true);
    expect(await act('two', fn)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(work.busy).toBe('one');
    release();
    expect(await first).toBe(true);
    expect(work.busy).toBeNull();
  });

  it('does not apply a result once the corpus changed in flight', async () => {
    let release!: () => void;
    let applied = false;
    const p = act('slow', async (id) => {
      await new Promise<void>((r) => (release = r));
      if (!still(id)) return false;
      applied = true;
      return true;
    });
    corpusStore.currentId = 2;
    window.dispatchEvent(new CustomEvent(CORPUS_CHANGED));
    release();
    expect(await p).toBe(false);
    expect(applied).toBe(false);
  });
});

describe('submit actions', () => {
  it('addPaste needs text', async () => {
    expect(await addPaste()).toBe(false);
    expect(posts()).toHaveLength(0);
    expect(messages.current?.text).toBe(t('src.paste.needed'));
  });

  it('addPaste posts the text with the metadata and clears what it consumed', async () => {
    draft.pasteText = 'Some text';
    draft.meta.tags = 'wind';
    expect(await addPaste()).toBe(true);
    const c = posts()[0];
    expect(c.path).toBe('/api/corpora/1/documents');
    expect(c.params.get('background')).toBe('true');
    expect(c.params.get('force_language')).toBe('false');
    expect(c.body).toEqual({ title: 'Pasted text', text: 'Some text', kind: 'paste', tags: 'wind', text_type: '', doc_date: '', author: '' });
    expect(draft.pasteText).toBe('');
    expect(draft.pasteTitle).toBe('');
  });

  it('a failing addPaste keeps the typed text', async () => {
    postStatus = 500;
    draft.pasteText = 'Keep me';
    draft.pasteTitle = 'T';
    expect(await addPaste()).toBe(false);
    expect(draft.pasteText).toBe('Keep me');
    expect(draft.pasteTitle).toBe('T');
  });

  it('uploadFiles without files asks to choose', async () => {
    expect(await uploadFiles()).toBe(false);
    expect(calls).toHaveLength(0);
    expect(messages.current?.text).toBe(t('src.upload.choose'));
  });

  it('a late discover-links reply after a corpus change does not repopulate the catalog', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inner = (globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<unknown>);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/discover-links')) {
        await gate;
        return { ok: true, status: 200, statusText: 'x', json: async () => ({ url: 'https://n.example/', title: 'N', links: [{ url: 'https://n.example/1', text: 'One', same_host: true }], max_per_request: 20, truncated: false }) };
      }
      return inner(url, init);
    }));
    draft.catalogUrl = 'https://n.example/';
    const pending = findLinks();
    corpusStore.currentId = 2;
    release();
    expect(await pending).toBe(false);
    expect(draft.catalog).toBeNull();
    expect(draft.picked.size).toBe(0);
    corpusStore.currentId = 1;
  });
});

describe('a bulk import where nothing was accepted stays on the page', () => {
  type Reply = { status: number; body: unknown };
  let reply: (c: Call) => Reply;
  const link = (n: number) => ({ url: `https://n.example/${n}`, text: `L${n}`, same_host: true });
  beforeEach(() => {
    const inner = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<unknown>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url, 'http://x');
      if (u.pathname.endsWith('/urls') || u.pathname.endsWith('/upload')) {
        const raw = init?.body;
        const r = reply({ method: 'POST', path: u.pathname, params: u.searchParams, body: typeof raw === 'string' ? JSON.parse(raw) : raw });
        return { ok: r.status < 400, status: r.status, statusText: 'x', json: async () => r.body };
      }
      return inner(url, init);
    }));
  });
  const fill = () => {
    draft.catalog = { url: 'https://n.example/', title: 'N', links: [link(1), link(2)], truncated: false, max_per_request: 1 };
    draft.picked.add('https://n.example/1');
    draft.picked.add('https://n.example/2');
  };

  it('importSelected: every request failing returns false and keeps the catalog and selection', async () => {
    reply = () => ({ status: 500, body: { detail: 'down' } });
    fill();
    expect(await importSelected()).toBe(false);
    expect(draft.catalog).not.toBeNull();
    expect(draft.picked.size).toBe(2);
    expect(messages.current?.kind).toBe('err');
  });

  it('importSelected: every link rejected returns false', async () => {
    reply = (c) => ({ status: 200, body: (c.body as { urls: string[] }).urls.map((u) => ({ url: u, ok: false, error: 'no' })) });
    fill();
    expect(await importSelected()).toBe(false);
    expect(draft.picked.size).toBe(2);
    expect(messages.current?.text).toContain('no');
  });

  it('importSelected: some accepted returns true', async () => {
    reply = (c) => {
      const [u] = (c.body as { urls: string[] }).urls;
      return { status: 200, body: [{ url: u, ok: u.endsWith('/1'), error: 'no' }] };
    };
    fill();
    expect(await importSelected()).toBe(true);
  });

  it('addUrlList: every address rejected returns false and keeps the addresses', async () => {
    reply = (c) => ({ status: 200, body: (c.body as { urls: string[] }).urls.map((u) => ({ url: u, ok: false, error: 'bad' })) });
    draft.urlList = 'https://a.example/\nhttps://b.example/';
    expect(await addUrlList()).toBe(false);
    expect(draft.urlList).toBe('https://a.example/\nhttps://b.example/');
    expect(messages.current?.kind).toBe('err');
  });

  it('addUrlList: some accepted returns true and clears the addresses', async () => {
    reply = (c) => ({ status: 200, body: (c.body as { urls: string[] }).urls.map((u, i) => ({ url: u, ok: i === 0, error: 'bad' })) });
    draft.urlList = 'https://a.example/\nhttps://b.example/';
    expect(await addUrlList()).toBe(true);
    expect(draft.urlList).toBe('');
  });

  it('uploadFiles: every file rejected returns false and keeps the files', async () => {
    reply = () => ({ status: 200, body: [{ file: 'a.txt', ok: false, error: 'unsupported' }] });
    draft.files = [new File(['x'], 'a.txt')];
    expect(await uploadFiles()).toBe(false);
    expect(draft.files).toHaveLength(1);
    expect(messages.current?.kind).toBe('err');
  });

  it('uploadFiles: some accepted returns true and clears the files', async () => {
    reply = () => ({ status: 200, body: [{ file: 'a.txt', ok: true, job_id: 1 }, { file: 'b.txt', ok: false, error: 'no' }] });
    draft.files = [new File(['x'], 'a.txt'), new File(['y'], 'b.txt')];
    expect(await uploadFiles()).toBe(true);
    expect(draft.files).toHaveLength(0);
  });
});
