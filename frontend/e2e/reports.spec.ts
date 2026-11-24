import { expect, test } from '@playwright/test';

test('job report: save it, reopen it after a reload, delete it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New corpus' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Informes');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await page.getByLabel('Pasted text', { exact: true }).fill(
    'El parque eólico produce energía limpia. El parque eólico de la sierra es nuevo.',
  );
  await page.getByRole('button', { name: 'Add text' }).click();
  await expect(page.getByRole('row', { name: /Pasted text|parque/i }).first()).toBeVisible({ timeout: 60_000 });

  await page.getByRole('navigation').getByRole('link', { name: 'Job' }).click();
  await page.getByLabel('Or paste the text here').fill('El parque eólico necesita energía. El parque nuevo produce mucho.');
  await page.getByLabel('keep the text with a saved report').check();
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save report' })).toBeVisible({ timeout: 90_000 });

  // the workbook of the whole report
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Excel: whole report' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('job-report.xlsx');

  await page.getByRole('button', { name: 'Save report' }).click();
  await expect(page.getByText('Saved reports')).toBeVisible();
  await expect(page.getByText(/· text kept/)).toBeVisible();

  // leave and come back to a fresh page: the report is still there
  await page.reload();
  const option = page.locator('option', { hasText: 'Informes' });
  await page.getByLabel('Corpus', { exact: true }).selectOption(await option.first().getAttribute('value'));
  await page.getByRole('navigation').getByRole('link', { name: 'Job' }).click();
  await page.getByRole('button', { name: /^Open report/ }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show the text' }).click();
  await expect(page.getByRole('region', { name: 'Analysed text' })).toContainText('El parque eólico necesita energía');

  await page.getByRole('button', { name: /^Delete report/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Saved reports')).toHaveCount(0);
});
