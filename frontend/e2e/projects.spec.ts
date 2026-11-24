import { expect, test } from '@playwright/test';
import { newCorpus, newProject, unique } from './helpers';

const context = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Working context' });

test('first run: a project and a corpus made on the Projects page show in the context bar', async ({ page }) => {
  await page.goto('/#/projects');
  const name = unique('Client');
  await page.getByLabel('New project', { exact: true }).fill(name);
  await page.getByRole('button', { name: /^(Add|Create project)$/ }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole('heading', { name: `Corpora in ${name}` })).toBeVisible();
  await expect(page.getByText('This project has no corpus yet.')).toBeVisible();

  const corpus = unique('Corpus');
  await newCorpus(page, corpus, undefined, name);
  const bar = context(page);
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('link', { name })).toBeVisible();
  await expect(bar.getByText(corpus)).toBeVisible();
  await expect(bar.getByRole('link').first()).toHaveText(/\S/); // the language name
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
  await page.getByRole('button', { name: new RegExp(`^${a}`) }).click();
  await page.getByRole('button', { name: `Open ${ca}` }).click();
  await expect(page.getByRole('row', { name: new RegExp(ca) }).getByText('Working', { exact: true })).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Sources' }).click();
  await expect(context(page).getByText(ca)).toBeVisible();
  await expect(context(page).getByRole('link', { name: a })).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('button', { name: new RegExp(`^${b}`) }).click();
  await page.getByRole('button', { name: `Open ${cb}` }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Sources' }).click();
  await expect(context(page).getByText(cb)).toBeVisible();
  await expect(context(page).getByRole('link', { name: b })).toBeVisible();
});

test('quick switch: the rail selector changes the working corpus', async ({ page }) => {
  const p = unique('Proj Q');
  const c1 = unique('Quick 1');
  const c2 = unique('Quick 2');
  const id = (await (await page.request.post('/api/projects', { data: { name: p } })).json()).id;
  for (const name of [c1, c2]) {
    expect((await page.request.post('/api/corpora', { data: { name, lang: 'es', project_id: id } })).ok()).toBeTruthy();
  }
  await page.goto('/#/sources');
  await page.reload();
  const quick = page.getByLabel('Corpus', { exact: true });
  await quick.selectOption({ label: c1 });
  await expect(context(page).getByText(c1)).toBeVisible();
  await quick.selectOption({ label: c2 });
  await expect(context(page).getByText(c2)).toBeVisible();
  await expect(context(page).getByText(c1)).toHaveCount(0);
});

test('delete guard: a project with a corpus asks where the corpora go', async ({ page }) => {
  const p = await newProject(page, 'Doomed');
  const other = unique('Safe');
  expect((await page.request.post('/api/projects', { data: { name: other } })).ok()).toBeTruthy();
  const corpus = unique('Orphan');
  await newCorpus(page, corpus, undefined, p);
  await page.getByRole('navigation').getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('button', { name: new RegExp(`^${p}`) }).click();

  await page.getByRole('button', { name: `Delete ${p}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this project?' });
  await expect(dialog.getByText(/still has 1 corpus/)).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Delete', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Move corpora to…').selectOption({ label: other });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole('button', { name: new RegExp(`^${p}`) })).toHaveCount(0);
  await page.getByRole('button', { name: new RegExp(`^${other}`) }).click();
  await expect(page.getByRole('row', { name: new RegExp(corpus) })).toBeVisible();
});
