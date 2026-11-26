import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import SidePanelHost from './SidePanelHost.svelte';

async function openPanel() {
  render(SidePanelHost);
  const opener = screen.getByRole('button', { name: 'opener' });
  opener.focus();
  opener.click();
  await tick();
  return opener;
}

describe('SidePanel', () => {
  it('renders nothing while closed', () => {
    render(SidePanelHost);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
  });

  it('when open, is a region named by its title with a Close button', async () => {
    await openPanel();
    const panel = screen.getByRole('complementary', { name: 'Settings' });
    expect(screen.getByRole('heading', { level: 3, name: 'Settings' })).toBeInTheDocument();
    expect(panel).toContainElement(screen.getByRole('button', { name: 'Close' }));
  });

  it('renders the footer snippet', async () => {
    await openPanel();
    expect(screen.getByRole('complementary')).toContainElement(screen.getByRole('button', { name: 'Save' }));
  });

  it('moves focus to the first focusable element in the body on open', async () => {
    await openPanel();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'inner' }));
  });

  it('× closes: unbinds open, calls onclose and returns focus to the opener', async () => {
    const opener = await openPanel();
    screen.getByRole('button', { name: 'Close' }).click();
    await tick();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByTestId('open')).toHaveTextContent('false');
    expect(screen.getByTestId('closed')).toHaveTextContent('1');
    expect(document.activeElement).toBe(opener);
  });

  it('Esc while focus is inside closes and returns focus to the opener', async () => {
    const opener = await openPanel();
    await fireEvent.keyDown(screen.getByRole('textbox', { name: 'inner' }), { key: 'Escape' });
    await tick();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByTestId('closed')).toHaveTextContent('1');
    expect(document.activeElement).toBe(opener);
  });

  it('Esc outside the panel does not close it', async () => {
    const opener = await openPanel();
    await fireEvent.keyDown(opener, { key: 'Escape' });
    await tick();
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.getByTestId('closed')).toHaveTextContent('0');
  });
});
