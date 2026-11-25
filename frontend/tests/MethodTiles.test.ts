import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import MethodTiles from '../src/lib/ui/add/MethodTiles.svelte';

describe('MethodTiles', () => {
  it('links the four methods to the add page', () => {
    render(MethodTiles);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '#/sources/add?m=web', '#/sources/add?m=up', '#/sources/add?m=paste', '#/sources/add?m=al',
    ]);
  });

  it('names each method and describes it', () => {
    render(MethodTiles);
    for (const name of ['From the web', 'Upload files', 'Paste text', 'Aligned texts']) {
      expect(screen.getByRole('link', { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(screen.getByText('A page, a list of addresses, or an index page')).toBeInTheDocument();
    expect(screen.getByText('DOCX, PDF, XLSX/CSV, XLIFF, SRT, TXT…')).toBeInTheDocument();
  });
});
