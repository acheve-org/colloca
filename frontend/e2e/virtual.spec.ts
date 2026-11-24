import { expect, test } from '@playwright/test';

test('a long concordance renders a window of rows and still scrolls to the end', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New corpus' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Larga');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();

  const sentence = 'El contrato número N se firma hoy en la oficina del cliente con todos los socios presentes.';
  const text = Array.from({ length: 1200 }, (_, i) => sentence.replace('N', String(i))).join(' ');
  await page.getByLabel('Pasted text', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Add text' }).click();
  await expect(page.getByRole('row', { name: /Pasted text/ })).toBeVisible({ timeout: 90_000 });

  await page.getByRole('navigation').getByRole('link', { name: 'Concordance' }).click();
  await page.getByLabel('Word or phrase').fill('contrato');
  await page.getByLabel('Hits').selectOption('2000');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const grid = page.getByRole('grid');
  await expect(grid).toHaveAttribute('aria-rowcount', '1201');
  await expect(grid).toHaveAttribute('data-virtual', 'true');
  const rendered = await page.locator('[role="row"].body').count();
  expect(rendered).toBeGreaterThan(5);
  expect(rendered).toBeLessThan(120);

  await grid.focus();
  await page.keyboard.press('End');
  await expect(page.locator('[role="row"].body.selected')).toHaveAttribute('aria-rowindex', '1201');
  await expect(page.locator('[role="row"].body.selected')).toBeInViewport();

  await page.keyboard.press('Home');
  await expect(page.locator('[role="row"].body.selected')).toHaveAttribute('aria-rowindex', '2');
  await expect(page.locator('[role="row"].body.selected')).toBeInViewport();

  // the header stays on top while scrolling
  await page.locator('.dt').evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
  await expect(page.getByRole('columnheader').first()).toBeInViewport();
});
