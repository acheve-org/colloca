import { expect, test, type Page } from '@playwright/test';
import { escapeRegExp, newCorpus, openScreen, pasteText, unique } from './helpers';

const TEXT = 'El parque eólico produce energía limpia. El parque eólico de la sierra es nuevo.';

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** A corpus holding one pasted text, ready for a Concordance search. */
async function corpusWithText(page: Page): Promise<void> {
  await newCorpus(page, unique('Visual'), 'es');
  await pasteText(page, TEXT, { row: /Pasted text|Untitled|parque/i, timeout: 60_000 });
}

async function searchConcordance(page: Page): Promise<void> {
  await openScreen(page, 'Concordance');
  await page.getByLabel('Word or phrase').fill('parque eólico');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}

test('at 390px a Concordance search shows cards, a card can be selected and the page does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await corpusWithText(page);
  await searchConcordance(page);

  const cards = page.getByRole('listbox', { name: 'Hit list' }).getByRole('option'); // <select> options are options too
  await expect(cards.first()).toBeVisible();
  await expect(page.locator('[role="row"].body')).toHaveCount(0);
  await cards.first().click();
  await expect(cards.first()).toHaveAttribute('aria-selected', 'true');
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('at 1280px the same search shows the table', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await corpusWithText(page);
  await searchConcordance(page);

  await expect(page.locator('[role="row"].body').first()).toBeVisible();
  await expect(page.getByRole('listbox', { name: 'Hit list' })).toHaveCount(0);
});

test('at 800px Projects stacks, shows the list first and does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await page.request.post('/api/projects', { data: { name: unique('Stack') } });
  await page.goto('/#/projects');
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('stacked Projects: choosing a project shows its panel and Back returns focus to it', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  const a = unique('Focus A');
  const b = unique('Focus B');
  for (const name of [a, b]) expect((await page.request.post('/api/projects', { data: { name } })).ok()).toBeTruthy();
  await page.goto('/#/projects');
  await page.reload();
  const list = page.getByRole('navigation', { name: 'Projects' });
  const item = list.getByRole('button', { name: new RegExp(`^${escapeRegExp(b)}`) });
  await item.click();
  await expect(page.getByRole('heading', { level: 2, name: b, exact: true })).toBeVisible();
  await expect(list).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(item).toHaveAttribute('aria-pressed', 'true');
  await expect(item).toBeFocused();
});

test('the More tab has the geometry of its sibling tabs and its popover opens right under it', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await newCorpus(page, unique('More'), 'es');
  await openScreen(page, 'Concordance'); // Explore has ten tabs: More shows at this width
  const strip = page.getByRole('group', { name: 'Section screens' });
  const more = strip.getByRole('button', { name: 'More' });
  await expect(more).toBeVisible();
  const sibling = strip.getByRole('link', { name: 'Concordance', exact: true });

  const m = (await more.boundingBox())!;
  const s = (await sibling.boundingBox())!;
  expect(Math.abs(m.height - s.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(m.y - s.y)).toBeLessThanOrEqual(1);

  await more.click();
  const pop = strip.locator('.pop');
  await expect(pop).toBeVisible();
  const p = (await pop.boundingBox())!;
  expect(Math.abs(p.y - (m.y + m.height))).toBeLessThanOrEqual(2);
});

for (const [scheme, accent] of [
  ['light', '#0f756d'],
  ['dark', '#4fd1c0'],
] as const) {
  test(`the accent token is ${accent} in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    const value = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    expect(value).toBe(accent);
  });
}

test('no screen scrolls sideways at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await corpusWithText(page);
  for (const name of ['Sources', 'Concordance', 'Termbase', 'Job', 'Projects', 'Languages']) {
    await openScreen(page, name);
    expect(await noHorizontalScroll(page), name).toBe(true);
  }
  await searchConcordance(page);
  await expect(page.getByRole('listbox', { name: 'Hit list' }).getByRole('option').first()).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});
