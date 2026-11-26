import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import ActionMenu from '../src/lib/ui/ActionMenu.svelte';

const src = import.meta.glob('../src/lib/ui/ActionMenu.svelte', { query: '?raw', import: 'default', eager: true });
const source = Object.values(src)[0] as string;

describe('ActionMenu', () => {
  it('a disabled item is reachable from the keyboard and clicking it does nothing', async () => {
    const rename = vi.fn();
    const remove = vi.fn();
    render(ActionMenu, {
      label: 'Item actions',
      items: [
        { label: 'Rename', onclick: rename },
        { label: 'Remove', onclick: remove, danger: true, disabled: true },
      ],
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Item actions' }));
    await tick();
    const first = screen.getByRole('menuitem', { name: 'Rename' });
    const disabled = screen.getByRole('menuitem', { name: 'Remove' });
    expect(first).toHaveFocus();
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    expect(disabled).not.toBeDisabled();   // still focusable

    await fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(disabled).toHaveFocus();

    await fireEvent.click(disabled);
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();   // the menu stays open

    await fireEvent.click(first);
    expect(rename).toHaveBeenCalledOnce();
  });

  it('hover and pressed looks skip disabled items', () => {
    // jsdom does not apply :hover, so check the rule itself: every background change excludes aria-disabled items.
    const rules = source.match(/[^{}]*\{[^}]*background: var\(--surface\)[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).toContain(":not([aria-disabled='true'])");
  });
});
