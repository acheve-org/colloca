import { expect, test } from '@playwright/test';
import { newCorpus, openScreen } from './helpers';

test('dispersion plot: see where a word occurs and open the passage', async ({ page }) => {
  await newCorpus(page, 'Plot');

  await page.getByLabel('Title of the pasted text').fill('Contrato A');
  await page.getByLabel('Pasted text', { exact: true }).fill(
    'El contrato empieza aquí. Hablamos de otras cosas durante un rato largo. El contrato termina allí.',
  );
  await page.getByRole('button', { name: 'Add text' }).click();
  await expect(page.getByRole('row', { name: /Contrato A/ })).toBeVisible({ timeout: 60_000 });

  await openScreen(page, 'Dispersion plot');
  await page.getByLabel('Word or phrase').fill('contrato');
  await page.getByRole('button', { name: 'Plot', exact: true }).click();
  await expect(page.getByText(/2 hits in 1 of 1 documents/)).toBeVisible();
  const bar = page.getByRole('img', { name: '2 hits in “Contrato A”' });
  await expect(bar.locator('.mark')).toHaveCount(2);

  await bar.click({ position: { x: 3, y: 8 } });
  await expect(page.getByRole('dialog')).toContainText('Hit 1 of 2');
  await page.getByRole('button', { name: 'Next hit' }).click();
  await expect(page.getByRole('dialog')).toContainText('Hit 2 of 2');
});
