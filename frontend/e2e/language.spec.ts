import { expect, test } from '@playwright/test';

test('the interface switches between English, Spanish and Italian and remembers the choice', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Sources' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.getByRole('button', { name: 'Español' }).click();
  await expect(nav.getByRole('link', { name: 'Fuentes' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');

  await page.reload();
  await expect(nav.getByRole('link', { name: 'Fuentes' })).toBeVisible();

  await page.getByRole('button', { name: 'Italiano' }).click();
  await expect(nav.getByRole('link', { name: 'Fonti' })).toBeVisible();
  await page.goto('/#/projects');
  await expect(page.getByRole('button', { name: 'New corpus' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nuovo corpus' })).toBeVisible();

  await page.getByRole('button', { name: 'English' }).click();
  await expect(nav.getByRole('link', { name: 'Sources' })).toBeVisible();
});
