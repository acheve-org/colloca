import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import RailMenu from '../src/lib/ui/RailMenu.svelte';
import { session } from '../src/lib/session.svelte';

afterEach(() => {
  session.required = false;
});

const trigger = () => screen.getByRole('button', { name: 'Menu' });

describe('RailMenu', () => {
  it('is closed at first and opens the Theme and Language groups', async () => {
    render(RailMenu);
    expect(screen.queryByRole('group', { name: 'Theme' })).toBeNull();
    await fireEvent.click(trigger());
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
  });

  it('switches the theme', async () => {
    render(RailMenu);
    await fireEvent.click(trigger());
    const dark = screen.getByRole('button', { name: 'Dark' });
    await fireEvent.click(dark);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(dark).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers Log out only when a password is required', async () => {
    const first = render(RailMenu);
    await fireEvent.click(trigger());
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
    first.unmount();
    session.required = true;
    render(RailMenu);
    await fireEvent.click(trigger());
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('Escape closes it and focuses the Menu button', async () => {
    render(RailMenu);
    await fireEvent.click(trigger());
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Theme' })).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('an outside click closes it', async () => {
    render(RailMenu);
    await fireEvent.click(trigger());
    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'Theme' })).toBeNull();
  });
});
