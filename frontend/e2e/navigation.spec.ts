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

test('the gear opens Projects and Open switches corpus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const first = unique('First');
  const second = unique('Second');
  const project = await newCorpus(page, first);
  await page.goto('/#/projects');
  await newCorpus(page, second, undefined, project);

  const context = page.getByRole('group', { name: 'Working in' });
  await expect(context).toContainText(second);
  await context.getByRole('link', { name: 'Change corpus or project' }).click();
  await expect(title(page)).toHaveText('Projects');
  await page.getByRole('button', { name: `Open ${first}` }).click();
  await expect(context).toContainText(first);
  await expect(context).not.toContainText(second);
});

test('on a 390px wide screen nothing scrolls sideways and the active tab is visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const long = `${unique('Narrow')} `.padEnd(80, 'longname');
  expect(long).toHaveLength(80);
  await newCorpus(page, long);
  await expect(page.getByRole('group', { name: 'Working in' })).toContainText(long);
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

test('an error stays in the footer past the fade and its Dismiss button clears it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newCorpus(page, unique('Footer'));
  await openScreen(page, 'Concordance');
  await page.getByRole('button', { name: 'Search', exact: true }).click(); // an empty query is an error
  const status = page.getByRole('status', { name: 'Status' });
  await expect(status).toHaveText('Type a word or phrase.');
  await page.waitForTimeout(7_000); // past MESSAGE_FADE_MS: ok and info messages would be gone
  await expect(status).toHaveText('Type a word or phrase.');
  await page.getByRole('button', { name: 'Dismiss message' }).click();
  await expect(status).toHaveText('');
  await expect(page.locator('#main')).toBeFocused();
});
