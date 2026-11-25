import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import DialogHost from './DialogHost.svelte';

describe('Dialog', () => {
  it('opens, shows title, closes on the native cancel event and restores focus to the opener', async () => {
    render(DialogHost);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    const dlg = document.querySelector('dialog')!;
    expect(dlg).not.toHaveAttribute('open');
    opener.click();
    await tick();
    expect(dlg).toHaveAttribute('open');
    expect(dlg).toHaveAccessibleName('Hello');
    await fireEvent(dlg, new Event('cancel', { cancelable: true }));
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

  it('scrolls only the body: header and footer stay outside the scroll container', async () => {
    render(DialogHost);
    screen.getByRole('button', { name: 'opener' }).click();
    await tick();
    const dlg = document.querySelector('dialog')!;
    const body = dlg.querySelector('.body')!;
    const footer = dlg.querySelector('footer')!;
    expect(body.contains(footer)).toBe(false);
    expect(body.contains(dlg.querySelector('header'))).toBe(false);
    expect(getComputedStyle(body).overflowY).toBe('auto');
    expect(getComputedStyle(dlg).overflowY).toBe('hidden');
  });
});

describe('Dialog long text', () => {
  it('the body wraps an unbroken word', () => {
    const src = import.meta.glob('../src/lib/ui/Dialog.svelte', { query: '?raw', import: 'default', eager: true });
    expect(Object.values(src)[0] as string).toMatch(/\.body[^}]*overflow-wrap:\s*anywhere/s);
  });
});
