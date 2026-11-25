import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { newCorpus, openScreen } from './helpers';

const TERM = 'parque eólico';

/** The app's own platform rule (shortcuts.svelte.ts), read from the browser under test. */
async function modifier(page: Page): Promise<'Meta' | 'Control'> {
  const mac = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform ?? '');
  });
  return mac ? 'Meta' : 'Control';
}

test('translator workflow', async ({ page }) => {
  await newCorpus(page, 'Eolica');

  await page.getByLabel('Documents to upload').setInputFiles(join(import.meta.dirname, 'seed.txt'));
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByRole('row', { name: /seed/ })).toBeVisible();

  const MOD = await modifier(page);
  await page.keyboard.press(`${MOD}+k`);
  await expect(page.getByLabel('Word or phrase')).toBeFocused();
  await page.getByLabel('Word or phrase').fill(TERM);
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const hits = page.locator('[role="row"].body');
  await expect(hits).toHaveCount(4);
  await expect(hits.first().locator('.hit-query')).toHaveText(TERM, { ignoreCase: true });

  await hits.first().click();
  await page.keyboard.press('ArrowDown');
  await expect(hits.nth(1)).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press(`${MOD}+e`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Source term')).not.toHaveValue('');
  await dialog.getByLabel('Translation').fill('wind farm');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  await openScreen(page, 'Termbase');
  await expect(page.getByRole('row', { name: /wind farm/ })).toBeVisible();

  await openScreen(page, 'Concordance');
  // Leaving the screen drops the search: run it again to get the CSV link.
  await page.getByLabel('Word or phrase').fill(TERM);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(hits).toHaveCount(4);
  const download = page.waitForEvent('download');
  await page.locator('a.csv[href*="/concordance"]').first().click();
  const csv = readFileSync(await (await download).path(), 'utf8').replace(/^\uFEFF/, '');
  const lines = csv.trim().split(/\r?\n/);
  expect(lines[0]).toMatch(/node/);
  expect(lines.length).toBeGreaterThan(1);
  expect(csv.toLowerCase()).toContain(TERM);
});

test('a document title is shown as literal text', async ({ page }) => {
  await newCorpus(page, 'Escape');
  const title = '<script>x</script>';

  await page.getByLabel('Title of the pasted text').fill(title);
  await page.getByLabel('Pasted text', { exact: true }).fill('Un texto breve sobre el parque eólico.');
  await page.getByRole('button', { name: 'Add text' }).click();

  await expect(page.getByRole('row', { name: /<script>x<\/script>/ })).toBeVisible();
  await expect(page.locator('script', { hasText: /^x$/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.body.innerHTML.includes('<script>x'))).toBe(false);
});
