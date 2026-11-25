import { expect, test } from '@playwright/test';
import { escapeRegExp, newCorpus, openScreen, unique } from './helpers';

test('Scope: pill, chip and panel in the page header', async ({ page }) => {
  await page.goto('/');
  await newCorpus(page, unique('Scope'));

  // Two documents, one tagged "wind".
  for (const [text, tag] of [
    ['The wind farm produces clean power.', 'wind'],
    ['The market opened higher today.', ''],
  ] as const) {
    await page.getByRole('link', { name: '+ Add documents' }).click();
    await page.getByRole('tab', { name: 'Paste text' }).click();
    const title = unique('Doc');
    await page.getByLabel('Title of the pasted text').fill(title);
    await page.getByLabel('Pasted text', { exact: true }).fill(text);
    await page.getByLabel('Tags').fill(tag);
    await page.getByRole('button', { name: 'Add text' }).click();
    await expect(page).toHaveURL(/#\/sources$/);
    await expect(page.getByRole('row', { name: new RegExp(escapeRegExp(title)) })).toBeVisible({ timeout: 60_000 });
  }

  await openScreen(page, 'Concordance');
  const pill = page.getByRole('button', { name: /^(All documents|\d+ of \d+ documents)/ });
  await expect(pill).toHaveText(/All documents/);

  await pill.click();
  const panel = page.getByRole('group', { name: 'Scope: which documents?' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('Tags').fill('wind');
  await expect(pill).toHaveText(/1 of 2 documents/);
  await expect(page.getByText('Tags: wind', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(panel).toBeHidden();

  await openScreen(page, 'Frequency list');
  await expect(pill).toHaveText(/1 of 2 documents/);
  await expect(page.getByText('Tags: wind', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Remove Tags: wind' }).click();
  await expect(pill).toHaveText(/All documents/);
  await expect(page.getByText('Tags: wind', { exact: true })).toHaveCount(0);

  await pill.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(pill).toBeFocused();

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#/termbase');
  await expect(page.getByRole('heading', { level: 1, name: 'Termbase' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(All documents|\d+ of \d+ documents)/ })).toHaveCount(0);
});
