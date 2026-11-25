import { expect, test, type Page } from '@playwright/test';
import { escapeRegExp, newCorpus, unique } from './helpers';

const TABS = ['From the web', 'Upload files', 'Paste text', 'Aligned texts'];

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('Add documents: the page, its tabs, the details card and the bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newCorpus(page, unique('Add'));
  await page.getByRole('link', { name: '+ Add documents' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Add documents' })).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Ways to add documents' });
  for (const name of TABS) await expect(tabs.getByRole('tab', { name })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'About these documents' })).toBeVisible();
  await expect(page.getByLabel('Tags')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to corpus' })).toBeDisabled();
});

test('Add documents: pasted text with a tag lands on Sources with the tag', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newCorpus(page, unique('Paste'));
  await page.getByRole('link', { name: '+ Add documents' }).click();
  await page.getByRole('tab', { name: 'Paste text' }).click();
  const title = unique('Nota');
  await page.getByLabel('Title of the pasted text').fill(title);
  await page.getByLabel('Pasted text', { exact: true }).fill('Un texto breve sobre el parque eólico.');
  await page.getByLabel('Tags').fill('legal');
  await page.getByRole('button', { name: 'Add text' }).click();

  await expect(page).toHaveURL(/#\/sources$/);
  const row = page.getByRole('row', { name: new RegExp(escapeRegExp(title)) });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row).toContainText('legal');
});

test('Add documents: Cancel and the browser Back button return to Sources', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newCorpus(page, unique('Back'));
  await page.getByRole('link', { name: '+ Add documents' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/#\/sources$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sources' })).toBeVisible();

  await page.getByRole('link', { name: '+ Add documents' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Add documents' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/sources$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sources' })).toBeVisible();
});

test('Add documents: a reload keeps the method in the address', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newCorpus(page, unique('Reload'));
  await page.goto('/#/sources/add?m=up');
  await expect(page.getByRole('tab', { name: 'Upload files' })).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Upload files' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 1, name: 'Add documents' })).toBeVisible();
});

test('Add documents: on a phone the page fits, the details are folded and the action is in view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newCorpus(page, unique('Phone'));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/#/sources/add?m=paste');
  await expect(page.getByRole('heading', { level: 1, name: 'Add documents' })).toBeVisible();

  const fold = page.locator('details.about-fold');
  await expect(fold).toBeVisible();
  await expect(fold).not.toHaveAttribute('open', '');
  expect(await noHorizontalScroll(page)).toBe(true);

  const primary = page.getByRole('button', { name: 'Add text' });
  await expect(primary).toBeInViewport();
  const box = await primary.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
});

test('Add documents: an empty corpus offers the four methods as tiles', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newCorpus(page, unique('Empty'));
  const tiles = page.locator('a.tile');
  await expect(tiles).toHaveCount(4);
  for (const name of TABS) await expect(tiles.filter({ hasText: name })).toBeVisible();

  await tiles.filter({ hasText: 'Paste text' }).click();
  await expect(page.getByRole('tab', { name: 'Paste text' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/#\/sources\/add\?m=paste/);
});
