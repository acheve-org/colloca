import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_FADE_MS, messages } from '../src/lib/messages.svelte';
import { t } from '../src/lib/i18n';

describe('messages fade', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    messages.clear();
  });

  afterEach(() => {
    messages.clear();
    vi.useRealTimers();
  });

  it('fades ok and info after MESSAGE_FADE_MS', () => {
    expect(MESSAGE_FADE_MS).toBe(6000);

    messages.say('Saved', 'ok');
    vi.advanceTimersByTime(MESSAGE_FADE_MS - 1);
    expect(messages.current).toEqual({ text: 'Saved', kind: 'ok' });
    vi.advanceTimersByTime(1);
    expect(messages.current).toBeNull();

    messages.say('Note', 'info');
    vi.advanceTimersByTime(MESSAGE_FADE_MS - 1);
    expect(messages.current).toEqual({ text: 'Note', kind: 'info' });
    vi.advanceTimersByTime(1);
    expect(messages.current).toBeNull();
  });

  it('keeps errors', () => {
    messages.say('Boom', 'err');
    vi.advanceTimersByTime(60_000);
    expect(messages.current).toEqual({ text: 'Boom', kind: 'err' });
  });

  it('keeps the Working text', () => {
    messages.say(t('corpus.working'));
    vi.advanceTimersByTime(60_000);
    expect(messages.current).toEqual({ text: t('corpus.working'), kind: 'info' });
  });

  it('an old timer does not clear a newer message', () => {
    messages.say('A', 'ok');
    vi.advanceTimersByTime(3000);
    messages.say('B', 'err');
    vi.advanceTimersByTime(10_000);
    expect(messages.current).toEqual({ text: 'B', kind: 'err' });

    messages.say('A', 'ok');
    vi.advanceTimersByTime(3000);
    messages.say('C', 'ok');
    vi.advanceTimersByTime(3001);
    expect(messages.current).toEqual({ text: 'C', kind: 'ok' });
    vi.advanceTimersByTime(3000);
    expect(messages.current).toBeNull();
  });

  it('clear cancels the timer', () => {
    messages.say('A', 'ok');
    messages.clear();
    expect(messages.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    messages.say('D', 'err');
    vi.advanceTimersByTime(MESSAGE_FADE_MS * 2);
    expect(messages.current).toEqual({ text: 'D', kind: 'err' });
  });
});
