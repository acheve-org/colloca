import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function newCorpus(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New corpus' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
}

test('aligned texts: import a two-column file, then search source + target', async ({ page }) => {
  await newCorpus(page, 'Alineados');

  await page.getByLabel('Aligned file').setInputFiles(join(import.meta.dirname, 'aligned.tsv'));
  await page.getByLabel('Translations go to').selectOption({ label: '+ new corpus…' });
  await page.getByLabel('Name of the new corpus').fill('Traduzioni');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('row', { name: /aligned/ })).toBeVisible({ timeout: 60_000 });

  // the memory goes back out as TMX
  const [tmx] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download TMX' }).click(),
  ]);
  expect(tmx.suggestedFilename()).toBe('Alineados.tmx');

  await page.getByRole('navigation').getByRole('link', { name: 'Concordance' }).click();
  await page.getByLabel('Word or phrase').fill('parque eólico');
  await page.getByLabel('Source + target').check();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const hits = page.locator('[role="row"].body');
  await expect(hits).toHaveCount(2);
  await expect(hits.first()).toContainText('parco eolico');
});

test('job analysis: paste a text and read the coverage report', async ({ page }) => {
  await newCorpus(page, 'Trabajo');
  await page.getByLabel('Pasted text', { exact: true }).fill(
    'El parque eólico produce energía limpia. El parque eólico de la sierra es nuevo.',
  );
  await page.getByRole('button', { name: 'Add text' }).click();
  await expect(page.getByRole('row', { name: /Pasted text|Untitled|parque/i }).first()).toBeVisible({ timeout: 60_000 });

  await page.getByRole('navigation').getByRole('link', { name: 'Job' }).click();
  await page.getByLabel('Or paste the text here').fill('El parque eólico necesita energía. El parque nuevo produce mucho.');
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
  await expect(page.getByText('words', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: /csv/i }).first()).toBeVisible();
});

test('segment lookup: a segment with one word changed finds its stored match and translation', async ({ page }) => {
  await newCorpus(page, 'Memoria');
  await page.getByLabel('Aligned file').setInputFiles(join(import.meta.dirname, 'aligned.tsv'));
  await page.getByLabel('Translations go to').selectOption({ label: '+ new corpus…' });
  await page.getByLabel('Name of the new corpus').fill('Memoria IT');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('row', { name: /aligned/ })).toBeVisible({ timeout: 60_000 });

  await page.getByRole('navigation').getByRole('link', { name: 'Segment lookup' }).click();
  await page.getByLabel('Segment to look up').fill('El parque eólico de la sierra es antiguo.');
  await page.getByLabel('At least').selectOption('70');
  await page.getByRole('button', { name: 'Look up' }).click();
  const first = page.getByRole('list', { name: 'Similar segments' }).getByRole('listitem').first();
  await expect(first).toContainText('%');
  await expect(first).toContainText('Il parco eolico della sierra è nuovo.');
  await expect(first.locator('.extra')).toHaveText('nuevo');
  await expect(first.locator('.missing')).toHaveText('antiguo');
});

test('related terms: words that keep similar company, learned from the corpus', async ({ page }) => {
  await newCorpus(page, 'Animales');
  const animals = ['perro', 'gato', 'caballo', 'conejo'];
  const things = ['coche', 'camión', 'autobús', 'furgón'];
  const withAnimals = ['come carne fresca', 'duerme cerca del jardín', 'tiene mucho pelo suave', 'corre por el campo verde'];
  const withThings = ['tiene cuatro ruedas grandes', 'consume mucha gasolina cara', 'circula por la carretera ancha', 'necesita un motor potente'];
  // independent choices of subject and context (a small deterministic generator), so words of one kind share contexts
  let seed = 12345;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed >> 8) % n;
  };
  const sentences: string[] = [];
  for (let i = 0; i < 500; i++) {
    sentences.push(
      next(2) ? `El ${animals[next(4)]} ${withAnimals[next(4)]}.` : `El ${things[next(4)]} ${withThings[next(4)]}.`,
    );
  }
  await page.getByLabel('Pasted text', { exact: true }).fill(sentences.join(' '));
  await page.getByRole('button', { name: 'Add text' }).click();
  await expect(page.getByRole('row', { name: /Pasted text|Untitled|El perro/i }).first()).toBeVisible({ timeout: 60_000 });

  await page.getByRole('navigation').getByRole('link', { name: 'Related terms' }).click();
  await page.getByLabel('Word (lemma)').fill('gato');
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(page.getByText(/Related terms \(statistical\)/)).toBeVisible();
  const rows = page.locator('[role="row"].body');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const top = (await rows.allTextContents()).slice(0, 6).join(' ');      // the nearest few; the long tail has everything
  expect(top).toContain('perro');
  expect(top).not.toMatch(/coche|camión|autobús|furgón/);
});
