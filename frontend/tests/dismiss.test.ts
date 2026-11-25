import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismiss } from '../src/lib/ui/dismiss';

function setup() {
  const trigger = document.createElement('button');
  const node = document.createElement('div');
  const inside = document.createElement('a');
  inside.href = '#x';
  node.append(inside);
  const outside = document.createElement('input');
  document.body.append(trigger, node, outside);
  const close = vi.fn();
  const action = dismiss(node, { close, trigger });
  return { trigger, node, inside, outside, close, action };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('dismiss', () => {
  it('closes on a pointer press outside, not inside or on the trigger', () => {
    const { trigger, inside, outside, close, action } = setup();
    inside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    trigger.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(close).not.toHaveBeenCalled();
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
    action.destroy();
  });

  it('Escape closes and focuses the trigger', () => {
    const { trigger, close, action } = setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
    action.destroy();
  });

  it('closes when focus moves outside the popover and its trigger', () => {
    const { trigger, node, inside, outside, close, action } = setup();
    node.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: inside }));
    node.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: trigger }));
    expect(close).not.toHaveBeenCalled();
    node.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    expect(close).toHaveBeenCalledTimes(1);
    action.destroy();
  });

  it('stops listening once destroyed', () => {
    const { node, outside, close, action } = setup();
    action.destroy();
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    node.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    expect(close).not.toHaveBeenCalled();
  });
});
