import { expect, test } from '@playwright/test';
import { setInterfaceLanguage } from './helpers';

test('the interface switches between English, Spanish and Italian and remembers the choice', async ({ page }) => {
  await page.goto('/');
  const title = page.getByRole('heading', { level: 1 });
  await expect(title).toHaveText('Sources');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await setInterfaceLanguage(page, 'ES');
  await expect(title).toHaveText('Fuentes');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');

  await page.reload();
  await expect(title).toHaveText('Fuentes');

  await setInterfaceLanguage(page, 'IT');
  await expect(title).toHaveText('Fonti');
  await page.goto('/#/projects');
  await expect(page.getByRole('button', { name: 'New corpus' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nuovo corpus' })).toBeVisible();

  await setInterfaceLanguage(page, 'EN');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Projects');
});
