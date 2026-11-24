import { expect, test } from '@playwright/test';
import { escapeRegExp, newCorpus, newProject, unique } from './helpers';

const context = (page: import('@playwright/test').Page) => page.getByRole('group', { name: 'Working in' });

test('a project and a corpus made on the Projects page show as project, corpus and language in the rail', async ({ page }) => {
  await page.goto('/#/projects');
  const name = unique('Client');
  await page.getByLabel('New project', { exact: true }).fill(name);
  await page.getByRole('button', { name: /^(Add|Create project)$/ }).click();
  await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}`) }).click();
  await expect(page.getByRole('heading', { name: `Corpora in ${name}` })).toBeVisible();
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
  await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(a)}`) }).click();
  await page.getByRole('button', { name: `Open ${ca}` }).click();
  await expect(page.getByRole('row', { name: new RegExp(escapeRegExp(ca)) }).getByText('Working', { exact: true })).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Sources' }).click();
  await expect(context(page).getByText(ca)).toBeVisible();
  await expect(context(page).getByText(a, { exact: true })).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(b)}`) }).click();
  await page.getByRole('button', { name: `Open ${cb}` }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Sources' }).click();
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
  await page.getByRole('navigation').getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(p)}`) }).click();

  await page.getByRole('button', { name: `Delete ${p}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this project?' });
  await expect(dialog.getByText(/still has 1 corpus/)).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Delete', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Move corpora to…').selectOption({ label: other });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole('button', { name: new RegExp(`^${escapeRegExp(p)}`) })).toHaveCount(0);
  await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(other)}`) }).click();
  await expect(page.getByRole('row', { name: new RegExp(escapeRegExp(corpus)) })).toBeVisible();
});
