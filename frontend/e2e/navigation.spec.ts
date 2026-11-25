import { expect, test } from '@playwright/test';
import { newCorpus, openScreen, unique } from './helpers';

const rail = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Main navigation' });
const strip = (page: import('@playwright/test').Page) => page.getByRole('group', { name: 'Section screens' });
const title = (page: import('@playwright/test').Page) => page.getByRole('heading', { level: 1 });

test('areas remember their last screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newCorpus(page, unique('Nav'));
  await rail(page).getByRole('link', { name: 'Explore', exact: true }).click();
  await openScreen(page, 'Keyness');
  await expect(title(page)).toHaveText('Keyness');

  await rail(page).getByRole('link', { name: 'Terms', exact: true }).click();
  await expect(title(page)).toHaveText('Termbase');

  await rail(page).getByRole('link', { name: 'Explore', exact: true }).click();
  await expect(title(page)).toHaveText('Keyness');
});

test('the corpus picker switches corpus and the header shows the new name', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const first = unique('First');
  const second = unique('Second');
  const project = await newCorpus(page, first);
  await page.goto('/#/projects');
  await newCorpus(page, second, undefined, project);

  const picker = page.getByRole('group', { name: 'Working in' });
  await expect(picker).toContainText(second);
  await picker.getByRole('button').click();
  await picker.getByRole('menuitem', { name: first, exact: true }).click();
  await expect(picker).toContainText(first);
  await expect(picker).not.toContainText(second);
});

test('on a 390px wide screen nothing scrolls sideways and the active tab is visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await newCorpus(page, unique('Narrow'));
  await openScreen(page, 'Related terms');
  await expect(title(page)).toHaveText('Related terms');
  await expect(strip(page).getByRole('link', { name: 'Related terms', exact: true })).toBeVisible();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
});

test('Settings shows Languages, Projects, then Backup and Trash', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await rail(page).getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(strip(page).getByRole('link')).toHaveText(['Languages', 'Projects', 'Backup and Trash']);
});

test('Manage projects… in the picker menu opens the Projects screen', async ({ page }) => {
  await newCorpus(page, unique('Manage'));
  const picker = page.getByRole('group', { name: 'Working in' });
  await picker.getByRole('button').click();
  await picker.getByRole('link', { name: 'Manage projects…' }).click();
  await expect(title(page)).toHaveText('Projects');
});
