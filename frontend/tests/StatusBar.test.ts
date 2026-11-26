import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import StatusBar from '../src/lib/ui/StatusBar.svelte';
import { activity, resetActivity } from '../src/lib/activity.svelte';
import { messages } from '../src/lib/messages.svelte';

let mainEl: HTMLElement;

beforeEach(() => {
  messages.clear();
  resetActivity();
  mainEl = document.createElement('main');
  mainEl.id = 'main';
  mainEl.tabIndex = -1;
  document.body.appendChild(mainEl);
});

afterEach(() => {
  mainEl.remove();
  messages.clear();
  resetActivity();
});

describe('StatusBar', () => {
  it('shows the current message in the status region', async () => {
    render(StatusBar);
    messages.say('Saved', 'ok');
    await tick();
    expect(screen.getByRole('status', { name: 'Status' })).toHaveTextContent('Saved');
  });

  it('lets an error be dismissed, which clears it and moves focus to the page', async () => {
    render(StatusBar);
    messages.say('Bad query', 'err');
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(messages.current).toBeNull();
    expect(document.activeElement).toBe(mainEl);
  });

  it('offers no dismiss button for an ok message', async () => {
    render(StatusBar);
    messages.say('Saved', 'ok');
    await tick();
    expect(screen.queryByRole('button', { name: 'Dismiss message' })).toBeNull();
  });

  it('reads Working… while busy with no message', async () => {
    render(StatusBar);
    activity.busy = true;
    await tick();
    expect(screen.getByRole('status', { name: 'Status' })).toHaveTextContent('Working…');
  });
});
