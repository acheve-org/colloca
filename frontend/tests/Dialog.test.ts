import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import DialogHost from './DialogHost.svelte';

describe('Dialog', () => {
  it('opens, shows title, closes on Escape and restores focus to the opener', async () => {
    render(DialogHost);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    const dlg = document.querySelector('dialog')!;
    expect(dlg).not.toHaveAttribute('open');
    opener.click();
    await tick();
    expect(dlg).toHaveAttribute('open');
    expect(dlg).toHaveAccessibleName('Hello');
    await fireEvent.keyDown(dlg, { key: 'Escape' });
    await tick();
    expect(dlg).not.toHaveAttribute('open');
    expect(screen.getByTestId('closed')).toHaveTextContent('1');
    expect(document.activeElement).toBe(opener);
  });

  it('closes from the footer button via bound open', async () => {
    render(DialogHost);
    screen.getByRole('button', { name: 'opener' }).click();
    await tick();
    screen.getByRole('button', { name: 'Done' }).click();
    await tick();
    expect(document.querySelector('dialog')).not.toHaveAttribute('open');
    expect(screen.getByTestId('closed')).toHaveTextContent('1');
  });
});
