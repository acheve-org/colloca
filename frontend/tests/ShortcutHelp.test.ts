import { render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ShortcutHelp from '../src/lib/ui/ShortcutHelp.svelte';
import { setPlatform } from '../src/lib/shortcuts.svelte';

afterEach(() => setPlatform('other'));

describe('ShortcutHelp', () => {
  it('lists the built-in keys of tables and dialogs next to the registered shortcuts', () => {
    setPlatform('other');
    render(ShortcutHelp, { open: true });
    const dialog = screen.getByRole('dialog');
    const row = (label: string) => {
      const dd = within(dialog).getByText(label);
      return [...(dd.previousElementSibling?.querySelectorAll('kbd') ?? [])].map((k) => k.textContent);
    };
    expect(row('Move through the rows')).toEqual(['↑', '↓']);
    expect(row('Open or activate the selected row')).toEqual(['Enter']);
    expect(row('Close the dialog')).toEqual(['Esc']);
  });
});
