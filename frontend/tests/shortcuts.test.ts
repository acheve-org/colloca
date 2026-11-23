import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatKeys, listShortcuts, registerShortcut, setPlatform } from '../src/lib/shortcuts.svelte';

function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

const offs: (() => void)[] = [];
function reg(...a: Parameters<typeof registerShortcut>) {
  const off = registerShortcut(...a);
  offs.push(off);
  return off;
}

afterEach(() => {
  offs.splice(0).forEach((f) => f());
  setPlatform('other');
  document.body.innerHTML = '';
});

describe('shortcut registry', () => {
  it('fires Mod+K with Ctrl on non-Mac and Cmd on Mac', () => {
    const run = vi.fn();
    reg({ id: 'k', keys: 'Mod+K', label: 'Go', run });
    setPlatform('other');
    press({ key: 'k', ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    press({ key: 'k', metaKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    setPlatform('mac');
    press({ key: 'k', metaKey: true });
    expect(run).toHaveBeenCalledTimes(2);
    press({ key: 'k', ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('suppresses plain keys while typing in an input but not Mod or Escape', () => {
    const q = vi.fn();
    const k = vi.fn();
    const esc = vi.fn();
    reg({ id: 'q', keys: '?', label: 'Help', run: q });
    reg({ id: 'k', keys: 'Mod+K', label: 'Go', run: k });
    reg({ id: 'e', keys: 'Escape', label: 'Close', run: esc });
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    press({ key: '?', shiftKey: true }, input);
    expect(q).not.toHaveBeenCalled();
    press({ key: 'k', ctrlKey: true }, input);
    expect(k).toHaveBeenCalledTimes(1);
    press({ key: 'Escape' }, input);
    expect(esc).toHaveBeenCalledTimes(1);
    press({ key: '?', shiftKey: true });
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('unregister stops it firing', () => {
    const run = vi.fn();
    const off = reg({ id: 'k', keys: 'Mod+K', label: 'Go', run });
    off();
    press({ key: 'k', ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it('respects when() and preventDefaults handled keys', () => {
    let on = false;
    const run = vi.fn();
    reg({ id: 'k', keys: 'Mod+K', label: 'Go', when: () => on, run });
    expect(press({ key: 'k', ctrlKey: true }).defaultPrevented).toBe(false);
    on = true;
    expect(press({ key: 'k', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not match extra modifiers', () => {
    const run = vi.fn();
    reg({ id: 'e', keys: 'Escape', label: 'Close', run });
    press({ key: 'Escape', ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it('lists registered shortcuts and formats keys per platform', () => {
    reg({ id: 'k', keys: 'Mod+K', label: 'Go', run: () => {} });
    expect(listShortcuts().map((s) => s.id)).toContain('k');
    setPlatform('mac');
    expect(formatKeys('Mod+K')).toBe('⌘K');
    setPlatform('other');
    expect(formatKeys('Mod+K')).toBe('Ctrl+K');
    expect(formatKeys('Escape')).toBe('Esc');
  });
});
