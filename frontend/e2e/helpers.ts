import { expect, type Page } from '@playwright/test';

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
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
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
  await expect(page.getByRole('row', { name: new RegExp(name) }).getByText('Working', { exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Sources' }).click();
  return proj;
}
