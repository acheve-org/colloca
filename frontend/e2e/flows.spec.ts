import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function newCorpus(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New corpus' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
}

test('aligned texts: import a two-column file, then search source + target', async ({ page }) => {
  await newCorpus(page, 'Alineados');

  await page.getByLabel('Aligned file').setInputFiles(join(import.meta.dirname, 'aligned.tsv'));
  await page.getByLabel('Translations go to').selectOption({ label: '+ new corpus…' });
  await page.getByLabel('Name of the new corpus').fill('Traduzioni');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('row', { name: /aligned/ })).toBeVisible({ timeout: 60_000 });

  // the memory goes back out as TMX
  const [tmx] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download TMX' }).click(),
  ]);
  expect(tmx.suggestedFilename()).toBe('Alineados.tmx');

  await page.getByRole('navigation').getByRole('link', { name: 'Concordance' }).click();
  await page.getByLabel('Word or phrase').fill('parque eólico');
  await page.getByLabel('Source + target').check();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const hits = page.locator('[role="row"].body');
  await expect(hits).toHaveCount(2);
  await expect(hits.first()).toContainText('parco eolico');
});

test('job analysis: paste a text and read the coverage report', async ({ page }) => {
  await newCorpus(page, 'Trabajo');
  await page.getByLabel('Pasted text', { exact: true }).fill(
    'El parque eólico produce energía limpia. El parque eólico de la sierra es nuevo.',
  );
  await page.getByRole('button', { name: 'Add text' }).click();
  await expect(page.getByRole('row', { name: /Pasted text|Untitled|parque/i }).first()).toBeVisible({ timeout: 60_000 });

  await page.getByRole('navigation').getByRole('link', { name: 'Job' }).click();
  await page.getByLabel('Or paste the text here').fill('El parque eólico necesita energía. El parque nuevo produce mucho.');
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
  await expect(page.getByText('words', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: /csv/i }).first()).toBeVisible();
});
