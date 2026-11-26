import { expect, test } from '@playwright/test';
import { escapeRegExp, newCorpus, newProject, unique, openScreen } from './helpers';

const context = (page: import('@playwright/test').Page) => page.getByRole('group', { name: 'Working in' });
const list = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Projects' });
const item = (page: import('@playwright/test').Page, name: string) =>
  list(page).getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}`) });

test('a project and a corpus made on the Projects page show as project, corpus and language in the rail', async ({ page }) => {
  await page.goto('/#/projects');
  const name = unique('Client');
  await list(page).getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog).toBeHidden();
  // The new project is chosen and marked in the list.
  await expect(item(page, name)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
  await expect(page.getByText('This project has no corpus yet.')).toBeVisible();

  const corpus = unique('Corpus');
  await newCorpus(page, corpus, 'es', name);
  const bar = context(page);
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(name);
  await expect(bar).toContainText(corpus);
  await expect(bar).toContainText('ES');
});

test('switching: opening a corpus of another project changes the context', async ({ page }) => {
  const a = unique('Proj A');
  const b = unique('Proj B');
  const ca = unique('Corpus A');
  const cb = unique('Corpus B');
  const projA = await page.request.post('/api/projects', { data: { name: a } });
  const projB = await page.request.post('/api/projects', { data: { name: b } });
  const idA = (await projA.json()).id;
  const idB = (await projB.json()).id;
  expect((await page.request.post('/api/corpora', { data: { name: ca, lang: 'es', project_id: idA } })).ok()).toBeTruthy();
  expect((await page.request.post('/api/corpora', { data: { name: cb, lang: 'es', project_id: idB } })).ok()).toBeTruthy();

  await page.goto('/#/projects');
  await page.reload();
  await item(page, a).click();
  await page.getByRole('button', { name: `Open ${ca}` }).click();
  await expect(page.getByRole('row', { name: new RegExp(escapeRegExp(ca)) }).getByText('Current', { exact: true })).toBeVisible();

  await openScreen(page, 'Sources');
  await expect(context(page).getByText(ca)).toBeVisible();
  await expect(context(page).getByText(a, { exact: true })).toBeVisible();

  await openScreen(page, 'Projects');
  await item(page, b).click();
  await page.getByRole('button', { name: `Open ${cb}` }).click();
  await openScreen(page, 'Sources');
  await expect(context(page).getByText(cb)).toBeVisible();
  await expect(context(page).getByText(b, { exact: true })).toBeVisible();
  await expect(context(page).getByText(ca)).toHaveCount(0);
});

test('delete guard: a project with a corpus asks where the corpora go', async ({ page }) => {
  const p = await newProject(page, 'Doomed');
  const other = unique('Safe');
  expect((await page.request.post('/api/projects', { data: { name: other } })).ok()).toBeTruthy();
  const corpus = unique('Orphan');
  await newCorpus(page, corpus, undefined, p);
  await openScreen(page, 'Projects');
  await item(page, p).click();
  await expect(page.getByRole('heading', { level: 2, name: p, exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete project…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this project?' });
  await expect(dialog.getByText(/still has 1 corpus/)).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Delete', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Move corpora to…').selectOption({ label: other });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();

  await expect(item(page, p)).toHaveCount(0);
  await item(page, other).click();
  await expect(page.getByRole('row', { name: new RegExp(escapeRegExp(corpus)) })).toBeVisible();
});

test('corpus settings: rename and move the current corpus from Projects', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const from = await newProject(page, 'From');
  const to = unique('To');
  expect((await page.request.post('/api/projects', { data: { name: to } })).ok()).toBeTruthy();
  const corpus = unique('Settle');
  await newCorpus(page, corpus, 'es', from);
  await openScreen(page, 'Projects'); // reloads the project list with the new target

  const row = page.getByRole('row', { name: new RegExp(escapeRegExp(corpus)) });
  await expect(row.getByText('Current', { exact: true })).toBeVisible();
  await row.click();
  const panel = page.getByRole('complementary', { name: 'Corpus settings' });
  await expect(panel).toBeVisible();
  await expect(row.getByRole('button', { name: corpus, exact: true })).toHaveAttribute('aria-expanded', 'true');

  const renamed = unique('Settled');
  await panel.getByLabel('Corpus name').fill(renamed);
  await panel.getByLabel('Project').selectOption({ label: to });
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Corpus saved.')).toBeVisible();

  // The header follows: new name, new project.
  await expect(context(page)).toContainText(renamed);
  await expect(context(page).getByText(to, { exact: true })).toBeVisible();
  await expect(context(page).getByText(from, { exact: true })).toHaveCount(0);
  // The panel now shows the new project, with the corpus row still marked as current.
  await expect(item(page, to)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 2, name: to, exact: true })).toBeVisible();
  const moved = page.getByRole('table', { name: `Corpora in ${to}` }).getByRole('row', { name: new RegExp(escapeRegExp(renamed)) });
  await expect(moved.getByText('Current', { exact: true })).toBeVisible();
});

for (const size of [{ width: 1100, height: 800 }, { width: 1440, height: 900 }]) {
  test(`corpus settings stay in view when the table is scrolled (${size.width}×${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    const name = unique('Many');
    const made = await page.request.post('/api/projects', { data: { name } });
    expect(made.ok()).toBeTruthy();
    const id = (await made.json()).id;
    const prefix = unique('Bulk');
    for (let i = 1; i <= 25; i++) {
      const label = `${prefix} ${String(i).padStart(2, '0')}`;
      expect((await page.request.post('/api/corpora', { data: { name: label, lang: 'es', project_id: id } })).ok()).toBeTruthy();
    }
    await page.goto('/#/projects');
    await page.reload();
    await item(page, name).click();
    await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();

    const last = page.getByRole('button', { name: `${prefix} 25`, exact: true });
    await last.scrollIntoViewIfNeeded();
    await last.click();
    const panel = page.getByRole('complementary', { name: 'Corpus settings' });
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel('Corpus name')).toHaveValue(`${prefix} 25`);
    const box = (await panel.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
  });
}
