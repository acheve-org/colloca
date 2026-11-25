import { expect, test, type Page } from '@playwright/test';
import { escapeRegExp, newCorpus, openScreen, pasteText, unique } from './helpers';

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

test('at 390px Projects shows a card per corpus with a menu, a confirmed delete and no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const other = unique('Other');
  expect((await page.request.post('/api/projects', { data: { name: other } })).ok()).toBeTruthy(); // a Move target
  const name = unique('Cards');
  await newCorpus(page, name, 'es');
  await openScreen(page, 'Projects');

  await expect(page.getByRole('heading', { name: /^Corpora in/ })).toBeVisible();
  await expect(page.locator('table')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: new RegExp(`More actions: ${escapeRegExp(name)}`) });
  await expect(trigger).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  await trigger.click();
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: new RegExp(`^Move.*${escapeRegExp(other)}`) })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(name);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeVisible(); // cancelling deleted nothing
});

test('at 640px Projects is a table again and the Concordance shows the full toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 800 });
  const name = unique('Wide');
  await newCorpus(page, name, 'es');
  await openScreen(page, 'Projects');
  await expect(page.getByRole('row', { name: new RegExp(escapeRegExp(name)) })).toBeVisible();
  await expect(page.getByRole('button', { name: /More actions/ })).toHaveCount(0);

  await openScreen(page, 'Concordance');
  await expect(page.getByRole('button', { name: /^Options/ })).toHaveCount(0);
  await expect(page.getByLabel('Search by')).toBeVisible();
  await expect(page.getByLabel('Sort', { exact: true })).toBeVisible();
});
