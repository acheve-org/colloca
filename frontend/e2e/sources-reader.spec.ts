import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { addDocuments, escapeRegExp, newCorpus, pasteText, unique } from './helpers';

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Selects a document's row on Sources and returns its side panel. */
async function openPanel(page: Page, title: string) {
  await page.getByRole('row', { name: new RegExp(escapeRegExp(title)) }).click();
  const panel = page.getByRole('complementary', { name: title });
  await expect(panel).toBeVisible();
  return panel;
}

test('reader: Read from the side panel, scroll to the end and find a word', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await newCorpus(page, unique('Lectura'), 'es');
  await addDocuments(page, join(import.meta.dirname, 'seed.txt'));

  // the toolbar: count, then the size gauge with its readiness popover
  await expect(page.getByText('1 document', { exact: true })).toBeVisible();
  const pill = page.getByRole('button', { name: /words · small/ });
  await expect(pill).toHaveAttribute('aria-expanded', 'false');
  await pill.click();
  await expect(pill).toHaveAttribute('aria-expanded', 'true');
  const pop = page.getByRole('group', { name: /words: enough to read in context/ });
  await expect(pop).toBeVisible();
  await expect(pop.getByText('Collocations')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();

  const panel = await openPanel(page, 'seed');
  await panel.getByRole('link', { name: 'Read' }).click();
  await expect(page).toHaveURL(/#\/sources\/read\?doc=\d+$/);
  await expect(page.getByRole('heading', { level: 2, name: 'seed' })).toBeVisible();
  await expect(page.getByText(/El parque eólico de la sierra produce energía limpia/)).toBeVisible();

  await page.mouse.wheel(0, 10_000);
  await expect(page.getByText(/parque eólico marino frente a la costa/)).toBeInViewport();

  // "parque" is in every line of the seed: Enter steps forward, Shift+Enter back
  const find = page.getByRole('searchbox', { name: 'Find in document' });
  await find.fill('parque');
  await expect(page.getByText('1 of 4', { exact: true })).toBeVisible();
  await find.press('Enter');
  await expect(page.getByText('2 of 4', { exact: true })).toBeVisible();
  await expect(page.locator('mark.current')).toHaveText(/parque/i);
  await find.press('Shift+Enter');
  await expect(page.getByText('1 of 4', { exact: true })).toBeVisible();
  await find.fill('aerogenerador');
  await expect(page.getByText('No matches', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: '← Documents' }).click();
  await expect(page).toHaveURL(/#\/sources$/);
});

test('reader: a long document loads more pages as it scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await newCorpus(page, unique('Largo'), 'es');
  const title = unique('Largo');
  const paras = Array.from({ length: 230 }, (_, i) => `Párrafo número ${i + 1} sobre el parque eólico.`);
  await pasteText(page, paras.join('\n\n'), { title, row: new RegExp(escapeRegExp(title)), timeout: 60_000 });

  const panel = await openPanel(page, title);
  await panel.getByRole('link', { name: 'Read' }).click();
  await expect(page.getByText('Párrafo número 1 sobre', { exact: false })).toBeVisible();
  const paragraphs = page.locator('.prose p');
  await expect(paragraphs).toHaveCount(100); // the first page only
  const last = page.getByText('Párrafo número 230 sobre', { exact: false });
  await expect(async () => {
    await page.mouse.wheel(0, 20_000);
    await expect(last).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(paragraphs).toHaveCount(230);
});

test('reader: an aligned document shows numbered pairs side by side', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await newCorpus(page, unique('Alineado'), 'es');
  await page.getByRole('link', { name: '+ Add documents' }).click();
  await page.getByRole('tab', { name: 'Aligned texts' }).click();
  await page.getByLabel('Aligned file').setInputFiles(join(import.meta.dirname, 'aligned.tsv'));
  await page.getByLabel('Translations go to').selectOption({ label: '+ new corpus…' });
  await page.getByLabel('Name of the new corpus').fill(unique('Traduzioni'));
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('row', { name: /aligned/ })).toBeVisible({ timeout: 60_000 });

  const panel = await openPanel(page, 'aligned');
  await panel.getByRole('link', { name: 'Read' }).click();
  const pairs = page.locator('ol.pairs > li');
  await expect(pairs).toHaveCount(3);
  const first = pairs.first();
  await expect(first).toContainText('El parque eólico produce energía limpia.');
  await expect(first).toContainText('Il parco eolico produce energia pulita.');
  const [src, tgt] = await first.locator('.seg').all();
  const a = await src.boundingBox();
  const b = await tgt.boundingBox();
  expect(a && b && b.x > a.x + a.width - 1 && Math.abs(a.y - b.y) < 2).toBe(true); // beside, on the same line

  // below 640px the pair stacks and nothing scrolls sideways
  await page.setViewportSize({ width: 390, height: 800 });
  const c = await src.boundingBox();
  const d = await tgt.boundingBox();
  expect(c && d && d.y >= c.y + c.height - 1).toBe(true);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('at 390px neither Sources nor the reader scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newCorpus(page, unique('Movil'), 'es');
  await addDocuments(page, join(import.meta.dirname, 'seed.txt'));
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByRole('button', { name: /words · small/ })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  await page.getByRole('button', { name: /words · small/ }).click();
  const pop = page.getByRole('group', { name: /words: enough/ });
  const box = await pop.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  await page.keyboard.press('Escape');

  const panel = await openPanel(page, 'seed');
  await panel.getByRole('link', { name: 'Read' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'seed' })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});
