import { expect, type Page } from '@playwright/test';

export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A name no other test (or earlier run on the shared database) has used. */
export function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Creates a project through the API (the page then loads it), opens it on the Projects page,
 * and returns its name. The database is shared by the whole run, so the name is unique.
 */
export async function newProject(page: Page, prefix = 'Project'): Promise<string> {
  const name = unique(prefix);
  const made = await page.request.post('/api/projects', { data: { name } });
  expect(made.ok()).toBeTruthy();
  await page.goto('/#/projects');
  await page.reload();
  await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}`) }).click();
  await expect(page.getByRole('heading', { name: `Corpora in ${name}` })).toBeVisible();
  return name;
}

/**
 * Creates a corpus through the Projects page (in a fresh project, or in `project` when given),
 * waits for it to be the working corpus, then moves to Sources.
 */
export async function newCorpus(page: Page, name: string, lang?: string, project?: string): Promise<string> {
  const proj = project ?? (await newProject(page));
  await page.getByRole('button', { name: 'New corpus' }).click();
  const dialog = page.getByRole('dialog', { name: 'New corpus' });
  await dialog.getByLabel('Name').fill(name);
  if (lang) await dialog.getByLabel('Language').selectOption(lang);
  await dialog.getByLabel('Project').selectOption({ label: proj });
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row', { name: new RegExp(escapeRegExp(name)) }).getByText('Working', { exact: true })).toBeVisible();
  await openScreen(page, 'Sources');
  return proj;
}

const AREA_OF: Record<string, string> = {
  Sources: 'Corpus',
  Concordance: 'Explore',
  Collocations: 'Explore',
  'N-grams': 'Explore',
  'Frequency list': 'Explore',
  'Dispersion plot': 'Explore',
  Keyness: 'Explore',
  'Word cloud': 'Explore',
  'Related terms': 'Explore',
  Equivalents: 'Explore',
  'Segment lookup': 'Explore',
  Termbase: 'Terms',
  Candidates: 'Terms',
  'Check text': 'Terms',
  Job: 'Job',
  Languages: 'Settings',
  Projects: 'Settings',
  'Backup and Trash': 'Settings',
};

/** Single-screen areas have no tab strip. */
const SINGLE = new Set(['Corpus', 'Job']);

/** Opens a screen by its display name: the rail area first, then its tab (through More when folded). */
export async function openScreen(page: Page, name: string): Promise<void> {
  const area = AREA_OF[name];
  if (!area) throw new Error(`Unknown screen: ${name}`);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: area, exact: true }).click();
  if (SINGLE.has(area)) {
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    return;
  }
  const strip = page.getByRole('group', { name: 'Section screens' });
  await expect(strip).toBeVisible();
  const tab = strip.getByRole('link', { name, exact: true });
  const more = strip.getByRole('button', { name: 'More' });
  await expect(tab.or(more)).toBeVisible(); // the strip measures itself after it renders
  if (!(await tab.isVisible())) await more.click();
  await tab.click();
  // The route changes after the click: wait for it, or the next step may act on the screen being left.
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

const LANG_BUTTON = { EN: 'English', ES: 'Español', IT: 'Italiano' } as const;

/** Switches the interface language through the rail Menu. */
export async function setInterfaceLanguage(page: Page, code: 'EN' | 'ES' | 'IT'): Promise<void> {
  const menu = page.getByRole('button', { name: /^(Menu|Menú|Menù)$/ });
  await menu.click();
  await page.getByRole('button', { name: LANG_BUTTON[code], exact: true }).click();
  await page.keyboard.press('Escape');
}
