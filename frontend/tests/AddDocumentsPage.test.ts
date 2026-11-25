import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddDocuments from '../src/screens/AddDocuments.svelte';
import Sources from '../src/screens/Sources.svelte';
import { actionFor, draft, resetDraft, work } from '../src/lib/addDocuments.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { stopAllJobs } from '../src/lib/jobs.svelte';
import { go, route } from '../src/lib/router.svelte';
import { t } from '../src/lib/i18n';

const NO_META = 'no tags, type, date or author';
const NAMES = ['From the web', 'Upload files', 'Paste text', 'Aligned texts'];

beforeEach(() => {
  corpusStore.list = [{ id: 1, name: 'Wind', lang: 'es', project_id: null, is_reference: 0, docs: 0, tokens: 0 }];
  corpusStore.currentId = 1;
  corpusStore.loaded = true;
  work.busy = null;
  resetDraft();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const facets = String(url).endsWith('/facets');
    return { ok: true, status: 200, statusText: 'x', json: async () => (facets ? { tags: [], text_types: [], date_min: '', date_max: '' } : []) };
  }));
});

afterEach(() => {
  stopAllJobs();
  vi.unstubAllGlobals();
  go('sources');
});

const open = (params: Record<string, string> = {}) => {
  go('sources-add', params);
  return render(AddDocuments);
};
const tab = (name: string) => screen.getByRole('tab', { name });

describe('tabs', () => {
  it('shows the four tabs with From the web selected', () => {
    open();
    expect(screen.getByRole('tablist', { name: 'Ways to add documents' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((x) => x.textContent?.trim())).toEqual(NAMES);
    expect(tab('From the web')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Upload files')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
    expect(document.querySelector('[data-method="web"]')).not.toBeNull();
  });

  it('reads the method from the address', () => {
    open({ m: 'up' });
    expect(tab('Upload files')).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('[data-method="up"]')).not.toBeNull();
  });

  it('falls back to From the web for an unknown method or sub', () => {
    open({ m: 'zzz' });
    expect(tab('From the web')).toHaveAttribute('aria-selected', 'true');
  });

  it('falls back for an unknown sub', () => {
    open({ m: 'web', sub: 'zzz' });
    expect(tab('From the web')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Add to corpus' })).toBeInTheDocument();
  });

  it('clicking a tab updates the address', async () => {
    open();
    await fireEvent.click(tab('Paste text'));
    expect(route.params.m).toBe('paste');
    expect(window.location.hash).toBe('#/sources/add?m=paste');
    expect(tab('Paste text')).toHaveAttribute('aria-selected', 'true');
  });

  it('arrow keys move between tabs', async () => {
    open();
    tab('From the web').focus();
    await fireEvent.keyDown(tab('From the web'), { key: 'ArrowRight' });
    expect(route.params.m).toBe('up');
    expect(tab('Upload files')).toHaveFocus();
    await fireEvent.keyDown(tab('Upload files'), { key: 'ArrowLeft' });
    expect(route.params.m).toBe('web');
    await fireEvent.keyDown(tab('From the web'), { key: 'ArrowLeft' });
    expect(route.params.m).toBe('al');
    await fireEvent.keyDown(tab('Aligned texts'), { key: 'Home' });
    expect(route.params.m).toBe('web');
    await fireEvent.keyDown(tab('From the web'), { key: 'End' });
    expect(route.params.m).toBe('al');
  });
});

describe('About card', () => {
  it('has the metadata fields and the language toggle, bound to the draft', async () => {
    open();
    expect(screen.getByText('About these documents')).toBeInTheDocument();
    await fireEvent.input(screen.getByLabelText('Tags'), { target: { value: 'wind' } });
    await fireEvent.input(screen.getByLabelText('Type'), { target: { value: 'news' } });
    await fireEvent.input(screen.getByLabelText('Date'), { target: { value: '2024' } });
    await fireEvent.input(screen.getByLabelText('Author'), { target: { value: 'Ana' } });
    expect(draft.meta).toEqual({ tags: 'wind', text_type: 'news', doc_date: '2024', author: 'Ana' });
    await fireEvent.click(screen.getByRole('switch', { name: 'Import even if the language looks wrong' }));
    expect(draft.force).toBe(true);
  });

  it('is hidden for Align two documents, with the bar', () => {
    open({ m: 'al', sub: 'two' });
    expect(screen.queryByText('About these documents')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('is shown for the translation memory', () => {
    open({ m: 'al', sub: 'tm' });
    expect(screen.getByText('About these documents')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
  });
});

describe('action bar', () => {
  it('names the corpus and the empty metadata, with a disabled primary', () => {
    open();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add to corpus' })).toBeDisabled();
    expect(screen.getByText(new RegExp(`into Wind · ${NO_META}`))).toBeInTheDocument();
  });

  it('follows the metadata being typed', async () => {
    open();
    await fireEvent.input(screen.getByLabelText('Tags'), { target: { value: 'wind' } });
    expect(screen.getByText(/into Wind · Tags: wind/)).toBeInTheDocument();
  });

  it('enables the primary when the form is ready and disables it while busy', async () => {
    open({ m: 'paste' });
    expect(screen.getByRole('button', { name: 'Add text' })).toBeDisabled();
    draft.pasteText = 'hola';
    await tick();
    expect(screen.getByRole('button', { name: 'Add text' })).toBeEnabled();
    work.busy = 'paste';
    await tick();
    expect(screen.getByRole('button', { name: 'Add text' })).toBeDisabled();
  });

  it('Cancel goes back to Sources and clears the draft', async () => {
    open();
    draft.meta.tags = 'wind';
    draft.pasteText = 'x';
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(window.location.hash).toBe('#/sources');
    expect(draft.meta.tags).toBe('');
    expect(draft.pasteText).toBe('');
  });
});

describe('without a corpus', () => {
  it('shows the empty state and no form', () => {
    corpusStore.currentId = null;
    open();
    expect(screen.getByText(t('corpus.selectFirst'))).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByText('About these documents')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});

describe('Sources entry point', () => {
  it('links to the add page', async () => {
    go('sources');
    render(Sources);
    const link = await screen.findByRole('link', { name: '+ Add documents' });
    expect(link).toHaveAttribute('href', '#/sources/add');
  });
});

describe('actionFor', () => {
  it('web: one page', () => {
    expect(actionFor('web', 'one')).toMatchObject({ label: 'Add to corpus', enabled: false });
    draft.preview = { source: 's', title: 't', text: 'x', kind: 'url', warnings: [] };
    expect(actionFor('web', 'one')).toMatchObject({ label: 'Add to corpus', enabled: true });
  });

  it('web: several addresses', () => {
    expect(actionFor('web', 'list')).toMatchObject({ label: 'Add all', enabled: false });
    draft.urlList = '\n  \n';
    expect(actionFor('web', 'list').enabled).toBe(false);
    draft.urlList = 'https://a.example/\nhttps://b.example/';
    expect(actionFor('web', 'list')).toMatchObject({ label: 'Add all', enabled: true });
  });

  it('web: index page counts the selected visible links', () => {
    expect(actionFor('web', 'index')).toMatchObject({ enabled: false, summary: `Find the links first · into Wind · ${NO_META}` });
    draft.catalog = {
      links: [
        { url: 'https://a.example/1', text: 'a', same_host: true },
        { url: 'https://a.example/2', text: 'b', same_host: true },
      ],
      max_per_request: 20,
      truncated: false,
    } as never;
    draft.picked.add('https://a.example/1');
    expect(actionFor('web', 'index')).toMatchObject({ label: 'Import 1 pages', enabled: true, summary: `1 of 2 selected · into Wind · ${NO_META}` });
    draft.picked.clear();
    expect(actionFor('web', 'index').enabled).toBe(false);
  });

  it('upload, paste and translation memory', () => {
    expect(actionFor('up', 'one')).toMatchObject({ label: 'Upload', enabled: false });
    draft.files = [new File(['x'], 'a.txt')];
    expect(actionFor('up', 'one')).toMatchObject({ label: 'Upload', enabled: true });

    expect(actionFor('paste', 'one')).toMatchObject({ label: 'Add text', enabled: false });
    draft.pasteText = '  ';
    expect(actionFor('paste', 'one').enabled).toBe(false);
    draft.pasteText = 'hola';
    expect(actionFor('paste', 'one')).toMatchObject({ label: 'Add text', enabled: true });

    expect(actionFor('al', 'tm')).toMatchObject({ label: 'Import', enabled: false });
    draft.pairFile = new File(['x'], 'a.tmx');
    expect(actionFor('al', 'tm').enabled).toBe(true);
    draft.partner = 'new';
    expect(actionFor('al', 'tm').enabled).toBe(false);
    draft.pairName = 'Translations';
    expect(actionFor('al', 'tm').enabled).toBe(true);
  });
});
