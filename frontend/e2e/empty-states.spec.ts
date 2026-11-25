import { expect, test } from '@playwright/test';
import { newCorpus, openScreen, pasteText, unique } from './helpers';

test('Frequency list: quiet hint and chips that run the analysis', async ({ page }) => {
  await page.goto('/');
  await newCorpus(page, unique('Hint'));
  const title = unique('Doc');
  await pasteText(page, 'The wind farm produces clean power for the town.', { title, row: new RegExp(title), timeout: 60_000 });

  await openScreen(page, 'Frequency list');
  await expect(page.getByText('Word frequencies', { exact: true })).toBeVisible();
  for (const chip of ['word forms', 'only nouns', 'with stopwords']) {
    await expect(page.getByRole('button', { name: chip, exact: true })).toBeVisible();
  }

  await page.getByRole('button', { name: 'with stopwords', exact: true }).click();
  await expect(page.getByRole('row').nth(1)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'with stopwords', exact: true })).toHaveCount(0);
});

test('Concordance: no hits under a filter offers to clear it and search again', async ({ page }) => {
  await page.goto('/');
  await newCorpus(page, unique('NoHits'));
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
    await expect(page.getByRole('row', { name: new RegExp(title) })).toBeVisible({ timeout: 60_000 });
  }

  await openScreen(page, 'Concordance');
  const pill = page.getByRole('button', { name: /^Document filter:/ });
  await pill.click();
  const panel = page.getByRole('group', { name: 'Scope: which documents?' });
  await panel.getByLabel('Tags').fill('wind');
  await expect(pill).toHaveText(/1 of 2 documents/);
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(panel).toBeHidden();

  await page.getByLabel('Word or phrase').fill('market');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /No hits for/ })).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Clear the filter and search' }).click();
  await expect(page.locator('[role="row"].body').first()).toBeVisible({ timeout: 60_000 });
  await expect(pill).toHaveText(/All documents/);
  await expect(page.getByText('No hits for')).toHaveCount(0);
});

test('Termbase: an empty termbase offers the glossary import', async ({ page }) => {
  await page.goto('/');
  await newCorpus(page, unique('Terms'));
  await openScreen(page, 'Termbase');
  await page.getByRole('button', { name: 'Import a glossary', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Import a glossary' })).toBeVisible();
});

test('Guided card fits a phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await newCorpus(page, unique('Phone'));
  await openScreen(page, 'Termbase');
  await expect(page.getByRole('button', { name: 'Import a glossary', exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
