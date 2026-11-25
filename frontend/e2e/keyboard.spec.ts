import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { newCorpus, openScreen } from './helpers';

const TERM = 'parque eólico';

async function seededCorpus(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('colloca.keys'));
  await newCorpus(page, name);
  await page.getByLabel('Documents to upload').setInputFiles(join(import.meta.dirname, 'seed.txt'));
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByRole('row', { name: /seed/ })).toBeVisible();
}

test('keyboard layer: slash, help overlay, rebinding, example keys', async ({ page }) => {
  await seededCorpus(page, 'Keys');

  // "/" focuses the query; typing "/" into the field itself must not move focus or open anything.
  await page.keyboard.press('/');
  await expect(page.getByLabel('Word or phrase')).toBeFocused();
  await page.keyboard.type('a/b');
  await expect(page.getByLabel('Word or phrase')).toHaveValue('a/b');
  await page.getByLabel('Word or phrase').fill(TERM);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const hits = page.locator('[role="row"].body');
  await expect(hits).toHaveCount(4);

  // The overlay opens with "?" (not while typing) and Esc closes it.
  await page.getByLabel('Word or phrase').press('?');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await hits.first().click();
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();

  // Rebind "go to concordance" from "/" to "g".
  await help.getByRole('button', { name: /Go to concordance.*Change/ }).filter({ hasText: /^\/$/ }).click();
  await page.keyboard.press('g');
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await openScreen(page, 'Termbase');
  await page.keyboard.press('/');
  await expect(page.getByLabel('Word or phrase')).toHaveCount(0);
  await page.keyboard.press('g');
  await expect(page.getByLabel('Word or phrase')).toBeFocused();
  await page.evaluate(() => localStorage.removeItem('colloca.keys'));

  // Number keys pick an example sentence in the term dialog.
  await page.getByLabel('Word or phrase').fill(TERM);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(hits).toHaveCount(4);
  await hits.first().click();
  await page.keyboard.press('Control+e');
  const dialog = page.getByRole('dialog', { name: /term/i });
  await dialog.getByRole('button', { name: /Find examples/i }).click();
  await expect(dialog.locator('.example').first()).toBeVisible();
  const first = (await dialog.locator('.example').first().innerText()).replace(/^1\s*/, '');
  await page.keyboard.press('1');
  const ctx = dialog.getByLabel('Example sentence');
  expect(first).toContain((await ctx.inputValue()).slice(0, 20));
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
