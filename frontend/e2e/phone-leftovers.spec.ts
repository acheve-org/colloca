import { expect, test, type Page } from '@playwright/test';
import { escapeRegExp, newCorpus, newProject, openScreen, pasteText, pickProject, unique } from './helpers';

const TEXT =
  'El parque eólico produce energía limpia. El parque eólico de la sierra es nuevo. ' +
  'Los vecinos visitan el parque eólico cada verano. Un parque eólico marino se construye en la costa. ' +
  'El parque eólico más grande de España genera electricidad para miles de hogares.';

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** A corpus holding one pasted text with several hits for "parque eólico", on the Concordance screen. */
async function concordance(page: Page): Promise<void> {
  await newCorpus(page, unique('Phone'), 'es');
  await pasteText(page, TEXT, { row: /Pasted text|Untitled|parque/i, timeout: 60_000 });
  await openScreen(page, 'Concordance');
}

test('at 390px the Concordance folds the options, searches with Enter and leaves room for results', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await concordance(page);

  const query = page.getByLabel('Word or phrase');
  const options = page.getByRole('button', { name: /^Options/ });
  await expect(query).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
  await expect(options).toBeVisible();
  await expect(options).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Search by')).toHaveCount(0);
  await expect(page.getByLabel('Sort', { exact: true })).toHaveCount(0);

  await query.fill('parque eólico');
  await query.press('Enter');
  const cards = page.getByRole('listbox', { name: 'Hit list' }).getByRole('option');
  await expect(cards.first()).toBeVisible();

  const box = await page.getByRole('listbox', { name: 'Hit list' }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(200);
  expect(await noHorizontalScroll(page)).toBe(true);

  // Opening shows the controls; a toggle that is on stays visible as a chip once the panel is closed again.
  await options.click();
  await expect(options).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Search by')).toBeVisible();
  await expect(page.getByLabel('Sort', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Case sensitive' }).click();
  await options.click();
  await expect(page.getByLabel('Search by')).toHaveCount(0);
  await expect(options.getByText('Case sensitive')).toBeVisible();
  await expect(options).toBeFocused();
});

test('the Concordance options and the query survive crossing 640px', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await concordance(page);

  await page.getByLabel('Word or phrase').fill('parque');
  await page.getByRole('button', { name: /^Options/ }).click();
  await page.getByLabel('Context width').fill('12');

  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.getByRole('button', { name: /^Options/ })).toHaveCount(0);
  await expect(page.getByLabel('Context width')).toHaveValue('12'); // the full toolbar is back
  await expect(page.getByLabel('Word or phrase')).toHaveValue('parque');

  await page.setViewportSize({ width: 600, height: 800 });
  await expect(page.getByRole('button', { name: /^Options/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Context width')).toHaveValue('12');
});

test('at 390px Projects shows a card per corpus whose settings cover the page, rename it and delete another after confirming', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const proj = await newProject(page, 'Cards');
  const doomed = unique('Doomed');
  await newCorpus(page, doomed, 'es', proj);
  await page.goto('/#/projects');
  const name = unique('Cards');
  await pickProject(page, proj);
  await newCorpus(page, name, 'es', proj);
  await openScreen(page, 'Projects');

  // Below 900px the list comes first; choosing the project shows its panel with a Back button.
  await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
  await pickProject(page, proj);
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(page.locator('table')).toHaveCount(0);
  const card = page.getByRole('button', { name, exact: true });
  await expect(card).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  // The settings panel covers the page.
  await card.click();
  const panel = page.getByRole('complementary', { name: 'Corpus settings' });
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.width).toBe(390);
  await expect(panel.getByRole('button', { name: 'Close' })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  const renamed = unique('Renamed');
  await panel.getByLabel('Corpus name').fill(renamed);
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Corpus saved.')).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: renamed, exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);

  // Deleting asks first: Cancel keeps the corpus, Delete removes it.
  await page.getByRole('button', { name: doomed, exact: true }).click();
  await panel.getByRole('button', { name: 'Delete corpus…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete corpus' });
  await expect(dialog).toContainText(doomed);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: doomed, exact: true })).toHaveCount(1); // cancelling deleted nothing
  await panel.getByRole('button', { name: 'Delete corpus…' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: doomed, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: renamed, exact: true })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('at 640px Projects is a table again and the Concordance shows the full toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 800 });
  const name = unique('Wide');
  const proj = await newCorpus(page, name, 'es');
  await openScreen(page, 'Projects');
  await pickProject(page, proj);
  await expect(page.getByRole('table', { name: `Corpora in ${proj}` }).getByRole('row', { name: new RegExp(escapeRegExp(name)) })).toBeVisible();
  // The name button is in the table row, not on a card.
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('button', { name, exact: true }) })).toHaveCount(0);

  await openScreen(page, 'Concordance');
  await expect(page.getByRole('button', { name: /^Options/ })).toHaveCount(0);
  await expect(page.getByLabel('Search by')).toBeVisible();
  await expect(page.getByLabel('Sort', { exact: true })).toBeVisible();
});
