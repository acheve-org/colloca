import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Rail from '../src/lib/ui/Rail.svelte';
import { catalogues, fmt, LANGS, setLang, t } from '../src/lib/i18n';
import { en } from '../src/lib/locales/en';
import { es } from '../src/lib/locales/es';
import { it as itCatalogue } from '../src/lib/locales/it';

const holes = (m: Record<string, string>) => Object.keys(en).filter((k) => !(k in m));
const extras = (m: Record<string, string>) => Object.keys(m).filter((k) => !(k in en));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// Values that are legitimately the same as the English ones: product and format names, statistics, cognates, symbols.
const SAME = new Set([
  'app.name', 'theme.auto', 'nav.group.corpus', 'trash.corpus', 'shortcuts.global', 'filter.docs',
  'ex.col.docs', 'ex.col.logdice', 'ex.col.tscore', 'ex.col.logRatio', 'ex.col.dice', 'term.langs', 'imp.langs',
  'cand.measure', 'cc.csv', 'tb.csv', 'tb.tbx', 'tb.xlsx', 'job.csv', 'job.csvOf', 'job.glossary.csv', 'job.glossary.tbx',
  'job.glossary.xlsx', 'base.leipzig', 'proj.corpora1', 'bk.k.corpora', 'trash.corpora', 'proj.corpora', 'cc.unit.lemma',
  'ex.unit.lemma', 'ex.col.lemma', 'job.col.lemma', 'ex.col.basePerMillion', 'job.col.baseM', 'ex.col.perM', 'imp.file', 'job.excel', 'term.number.plural', 'term.number.singular', 'term.number.dual',
  'lang.modelLine', 'proj.colCorpus',
]);
const loose = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(en).filter((k) => a[k] === b[k] && !SAME.has(k) && /[a-zà-ÿ]{4,}/i.test(a[k]));

describe.each([
  ['es', es],
  ['it', itCatalogue],
])('%s catalogue', (_code, m) => {
  it('has every English key and no others', () => {
    expect(holes(m)).toEqual([]);
    expect(extras(m)).toEqual([]);
  });

  it('keeps exactly the placeholders of the English text', () => {
    const bad = Object.keys(en).filter((k) => JSON.stringify(placeholders(en[k])) !== JSON.stringify(placeholders(m[k])));
    expect(bad).toEqual([]);
  });

  it('has no empty strings', () => {
    expect(Object.keys(m).filter((k) => !m[k].trim() && en[k].trim())).toEqual([]);
  });

  it('does not leave English text behind', () => {
    // A value equal to the English one is only fine for names, formats and symbols (SAME).
    expect(loose(m, en)).toEqual([]);
  });
});

describe('language switch', () => {
  beforeEach(() => {
    localStorage.clear();
    setLang('en');
  });
  afterEach(() => setLang('en'));

  it('re-renders already mounted screens without remounting them', async () => {
    render(Rail);
    expect(screen.getByRole('link', { name: 'Sources' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Sources' });
    setLang('es');
    await tick();
    expect(screen.getByRole('link', { name: 'Fuentes' })).toBe(link);
    setLang('it');
    await tick();
    expect(screen.getByRole('link', { name: 'Fonti' })).toBe(link);
  });

  it('is offered in the rail, names each language in itself, and marks the current one', async () => {
    render(Rail);
    const group = screen.getByRole('group', { name: 'Language' });
    expect(group.querySelectorAll('button')).toHaveLength(LANGS.length);
    const spanish = screen.getByRole('button', { name: 'Español' });
    expect(spanish).toHaveAttribute('aria-pressed', 'false');
    spanish.click();
    await tick();
    expect(spanish).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Idioma' })).toBeInTheDocument();
  });

  it('sets <html lang> and remembers the choice', () => {
    setLang('it');
    expect(document.documentElement.lang).toBe('it');
    expect(localStorage.getItem('colloca.lang')).toBe('it');
  });

  it('falls back to English for a key a language lacks, and returns an unknown key as is', () => {
    const saved = es['nav.sources'];
    delete es['nav.sources'];
    try {
      setLang('es');
      expect(t('nav.sources')).toBe('Sources');
    } finally {
      es['nav.sources'] = saved;
    }
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('fills placeholders in every language', () => {
    for (const code of LANGS) {
      setLang(code);
      expect(t('scope.summary', { docs: 3, total: 7 })).toMatch(/3.*7/);
    }
  });

  it('formats numbers by the conventions of the language', () => {
    setLang('en');
    expect(fmt(1234567.5)).toBe('1,234,567.5');
    setLang('es');
    expect(fmt(1234567.5)).toBe('1.234.567,5');
    setLang('it');
    expect(fmt(1234567.5)).toBe('1.234.567,5');
  });

  it('catalogues are exposed for the three languages', () => {
    expect(Object.keys(catalogues).sort()).toEqual(['en', 'es', 'it']);
  });
});

describe('first-visit language', () => {
  async function fresh(languages: string[]) {
    vi.resetModules();
    localStorage.clear();
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
    return (await import('../src/lib/locale.svelte')).locale.code;
  }
  afterEach(() => vi.restoreAllMocks());

  it('follows the browser language when it is supported', async () => {
    expect(await fresh(['es-ES', 'en'])).toBe('es');
    expect(await fresh(['it'])).toBe('it');
  });

  it('takes the first supported language of the list, else English', async () => {
    expect(await fresh(['fr-FR', 'it-IT'])).toBe('it');
    expect(await fresh(['de', 'fr'])).toBe('en');
  });

  it('a stored choice wins over the browser', async () => {
    vi.resetModules();
    localStorage.setItem('colloca.lang', 'en');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['es']);
    expect((await import('../src/lib/locale.svelte')).locale.code).toBe('en');
  });
});
