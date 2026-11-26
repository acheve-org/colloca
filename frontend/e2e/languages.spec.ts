import { expect, test, type Page } from '@playwright/test';
import { escapeRegExp, newProject, unique, openScreen } from './helpers';

// The list button of a language: its name is the language name, then the code and the status dots.
const item = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Languages' }).getByRole('button', { name: new RegExp(`^${escapeRegExp(name)} `) });
// The panel shows the chosen language as a region named after it.
const panel = (page: Page, name: string) => page.getByRole('region', { name });

test('the Languages screen adds a language from the catalog and removes it again', async ({ page }) => {
  await page.goto('/');
  await openScreen(page, 'Languages');
  await expect(item(page, 'Spanish')).toBeVisible();
  await expect(item(page, 'Italian')).toBeVisible();
  await item(page, 'Italian').click();
  await expect(item(page, 'Italian')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page, 'Italian').getByRole('heading', { level: 2, name: 'Italian' })).toBeVisible();
  for (const name of ['Language model', 'OCR data', 'Base corpus']) {
    await expect(panel(page, 'Italian').getByRole('heading', { level: 3, name })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Add language' }).click();
  const dlg = page.getByRole('dialog', { name: 'Add a language' });
  await expect(dlg.getByRole('radio', { name: 'Spanish' })).toHaveCount(0);   // already added
  await dlg.getByRole('radio', { name: 'French' }).check();
  await dlg.getByRole('switch', { name: 'Install the model' }).uncheck();      // no download in the test
  await dlg.getByRole('switch', { name: 'Install OCR data' }).uncheck();
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();

  // The new language is chosen in the list, and its panel is shown.
  await expect(item(page, 'French')).toHaveAttribute('aria-pressed', 'true');
  await expect(item(page, 'French')).toContainText('Model: missing');
  const fr = panel(page, 'French');
  await expect(fr.getByText('Model not installed')).toBeVisible();
  await expect(fr.getByText('Not used by any corpus')).toBeVisible();

  // the new language is offered when creating a corpus
  await openScreen(page, 'Projects');
  await newProject(page);
  await page.getByRole('button', { name: 'New corpus' }).first().click(); // a project without corpora also shows the guided card's button
  await expect(page.getByRole('dialog').getByRole('option', { name: 'French' })).toHaveCount(1);
  await page.keyboard.press('Escape');

  await openScreen(page, 'Languages');
  await item(page, 'French').click();
  await panel(page, 'French').getByRole('button', { name: 'Language actions' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await page.getByRole('dialog', { name: 'Remove French?' }).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(item(page, 'French')).toHaveCount(0);
  await expect(panel(page, 'French')).toHaveCount(0);
});

test('a language with a corpus cannot be removed', async ({ page, request }) => {
  const project = await request.post('/api/projects', { data: { name: unique('Lang project') } });
  expect(project.ok()).toBeTruthy();
  const { id: project_id } = await project.json();
  const made = await request.post('/api/corpora', { data: { name: 'lang-e2e', lang: 'it', project_id } });
  expect(made.ok()).toBeTruthy();
  await page.goto('/#/languages');
  await item(page, 'Italian').click();
  const it = panel(page, 'Italian');
  await expect(it.getByText(/^Used by \d+ corp/)).toBeVisible();
  await expect(it.getByText('Remove is unavailable while corpora use this language.')).toBeVisible();
  await it.getByRole('button', { name: 'Language actions' }).click();
  const remove = page.getByRole('menuitem', { name: 'Remove' });
  await expect(remove).toHaveAttribute('aria-disabled', 'true');
  // Inert but reachable: it takes focus, and Enter on it opens nothing.
  await expect(remove).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Remove Italian?' })).toHaveCount(0);
});

test('at 390px the list comes first, then the panel with Back, and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/#/languages');
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  await expect(item(page, 'Spanish')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
  expect(await fits()).toBe(true);

  await item(page, 'Italian').click();
  await expect(panel(page, 'Italian').getByRole('heading', { level: 2, name: 'Italian' })).toBeVisible();
  await expect(item(page, 'Spanish')).toBeHidden();
  expect(await fits()).toBe(true);

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(item(page, 'Italian')).toBeFocused();
  await expect(panel(page, 'Italian')).toHaveCount(0);
});

test('the old Base corpora address leads to the Languages screen', async ({ page }) => {
  await page.goto('/#/base');
  await expect(item(page, 'Spanish')).toBeVisible();
});
