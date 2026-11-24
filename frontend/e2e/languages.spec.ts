import { expect, test } from '@playwright/test';

test('the Languages screen adds a language from the catalog and removes it again', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: 'Languages' }).click();
  await expect(page.getByRole('region', { name: 'Spanish' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Italian' })).toBeVisible();

  await page.getByRole('button', { name: 'Add language' }).click();
  const dlg = page.getByRole('dialog', { name: 'Add a language' });
  await expect(dlg.getByRole('radio', { name: 'Spanish' })).toHaveCount(0);   // already added
  await dlg.getByRole('radio', { name: 'French' }).check();
  await dlg.getByRole('switch', { name: 'Install the model' }).uncheck();      // no download in the test
  await dlg.getByRole('switch', { name: 'Install OCR data' }).uncheck();
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();

  const fr = page.getByRole('region', { name: 'French' });
  await expect(fr).toBeVisible();
  await expect(fr.getByText('Model not installed')).toBeVisible();

  // the new language is offered when creating a corpus
  await page.getByRole('navigation').getByRole('link', { name: 'Sources' }).click();
  await page.getByRole('button', { name: 'New corpus' }).click();
  await expect(page.getByRole('dialog').getByRole('option', { name: 'French' })).toHaveCount(1);
  await page.keyboard.press('Escape');

  await page.getByRole('navigation').getByRole('link', { name: 'Languages' }).click();
  await page.getByRole('button', { name: 'Remove French' }).click();
  await page.getByRole('dialog', { name: 'Remove French?' }).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('region', { name: 'French' })).toHaveCount(0);
});

test('a language with a corpus cannot be removed', async ({ page, request }) => {
  const made = await request.post('/api/corpora', { data: { name: 'lang-e2e', lang: 'it' } });
  expect(made.ok()).toBeTruthy();
  await page.goto('/#/languages');
  const it = page.getByRole('region', { name: 'Italian' });
  await expect(it.getByRole('button', { name: 'Remove Italian' })).toBeDisabled();
  await expect(it.getByText(/corpora use this language/)).toBeVisible();
});

test('the old Base corpora address leads to the Languages screen', async ({ page }) => {
  await page.goto('/#/base');
  await expect(page.getByRole('region', { name: 'Spanish' })).toBeVisible();
});
