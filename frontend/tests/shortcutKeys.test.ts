import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureKeys,
  keysOf,
  registerShortcut,
  resetBindings,
  setBinding,
  withKeys,
} from '../src/lib/shortcuts.svelte';

function press(init: KeyboardEventInit, target: EventTarget = document.body): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

const offs: (() => void)[] = [];
afterEach(() => {
  offs.splice(0).forEach((f) => f());
  resetBindings();
  document.body.innerHTML = '';
});

describe('configurable keys', () => {
  it('uses a rebound key instead of the default and persists it', () => {
    const run = vi.fn();
    offs.push(registerShortcut({ id: 'x', keys: 'a', label: 'X', run }));
    setBinding('x', 'j');
    expect(keysOf({ id: 'x', keys: 'a' })).toBe('j');
    press({ key: 'a' });
    expect(run).not.toHaveBeenCalled();
    press({ key: 'j' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('colloca.keys') ?? '{}')).toEqual({ x: 'j' });
    setBinding('x', null);
    press({ key: 'a' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('shows the current key in a tooltip', () => {
    offs.push(registerShortcut({ id: 'x', keys: 'a', label: 'X', run: () => {} }));
    expect(withKeys('Accept', 'x')).toBe('Accept (A)');
    expect(withKeys('Accept', 'missing')).toBe('Accept');
  });

  it('captures the next key combination without running shortcuts, Escape cancels', async () => {
    const run = vi.fn();
    offs.push(registerShortcut({ id: 'x', keys: 'a', label: 'X', run }));
    const p = captureKeys();
    press({ key: 'a' });
    expect(await p).toBe('a');
    expect(run).not.toHaveBeenCalled();
    const q = captureKeys();
    press({ key: 'Escape' });
    expect(await q).toBeNull();
  });

  it('does not fire plain keys while typing in an input', () => {
    const run = vi.fn();
    offs.push(registerShortcut({ id: 'x', keys: 'd', label: 'X', run }));
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    press({ key: 'd' }, input);
    expect(run).not.toHaveBeenCalled();
  });
});
