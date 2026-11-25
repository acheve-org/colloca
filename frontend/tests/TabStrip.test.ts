import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TabStrip from '../src/lib/ui/TabStrip.svelte';
import { corpusStore } from '../src/lib/corpus.svelte';
import { go } from '../src/lib/router.svelte';
import { setLang } from '../src/lib/i18n';

let containerWidth = 10000;
let measured = 0;
let tabWidth = 100;
let observers: ResizeObserverCallback[] = [];

beforeEach(() => {
  containerWidth = 10000;
  measured = 0;
  tabWidth = 100;
  observers = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: ResizeObserverCallback) { observers.push(cb); }
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() { measured++; return tabWidth; },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    // the tab row is the element whose width is usable; its parent is wider (side margins)
    get(this: HTMLElement) { return this.getAttribute('role') === 'group' ? containerWidth : containerWidth + 24; },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  corpusStore.aligned = false;
  setLang('en');
  go('sources');
});

async function narrow(width: number) {
  containerWidth = width;
  observers.forEach((cb) => cb([], {} as ResizeObserver));
  await tick();
}

describe('TabStrip', () => {
  it('renders the Explore tabs in a named group', async () => {
    go('concordance');
    render(TabStrip, { area: 'explore' });
    await tick();
    const group = screen.getByRole('group', { name: 'Section screens' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(8);
    expect(screen.getByRole('link', { name: 'Concordance' })).toHaveAttribute('href', '#/concordance');
  });

  it('renders nothing for a single-screen area', () => {
    render(TabStrip, { area: 'corpus' });
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('marks only the active tab', async () => {
    go('keyness');
    render(TabStrip, { area: 'explore' });
    await tick();
    const current = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Keyness');
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  async function overflowing() {
    go('cloud');
    render(TabStrip, { area: 'explore' });
    await tick();
    await narrow(350);
  }

  it('folds tabs that do not fit into More and keeps the active one', async () => {
    await overflowing();
    const strip = screen.getByRole('group', { name: 'Section screens' });
    const names = screen.getAllByRole('link').map((a) => a.textContent?.trim());
    expect(names).toEqual(['Concordance', 'Word cloud']);
    expect(strip).toContainElement(screen.getByRole('link', { name: 'Word cloud' }));
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Collocations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Related terms' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Word cloud' })).toHaveLength(1);
  });

  it('Escape closes the popover and focuses More', async () => {
    await overflowing();
    const more = screen.getByRole('button', { name: 'More' });
    await fireEvent.click(more);
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Collocations' })).toBeNull();
    expect(more).toHaveFocus();
  });

  it('a click outside closes the popover', async () => {
    await overflowing();
    const more = screen.getByRole('button', { name: 'More' });
    await fireEvent.click(more);
    await fireEvent.pointerDown(document.body);
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Collocations' })).toBeNull();
  });

  it('fits tabs to the width of the tab row, not of its padded parent', async () => {
    go('concordance');
    render(TabStrip, { area: 'explore' });
    await tick();
    // row 299: 199 left after More, so one 100px tab; the parent reports 323, which would wrongly allow two
    await narrow(299);
    expect(screen.getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['Concordance']);
  });

  it('re-measures when the language changes and folds when the new names are wider', async () => {
    go('concordance');
    render(TabStrip, { area: 'explore' });
    await narrow(850);
    expect(screen.getAllByRole('link')).toHaveLength(8);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    const before = measured;
    tabWidth = 200; // longer names arrive with the new language
    setLang('es');
    await tick();
    await tick();
    expect(measured).toBeGreaterThan(before);
    expect(screen.getAllByRole('link').length).toBeLessThan(8);
    expect(screen.getByRole('button', { name: 'Más' })).toBeInTheDocument();
  });

  it('focuses the active tab after choosing one from More', async () => {
    await overflowing();
    await fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await fireEvent.click(screen.getByRole('link', { name: 'Collocations' }));
    await new Promise((r) => setTimeout(r, 20));
    await tick();
    expect(screen.getByRole('link', { name: 'Collocations' })).toHaveFocus();
  });

  it('does not announce the More popover as a menu', async () => {
    await overflowing();
    expect(screen.getByRole('button', { name: 'More' })).not.toHaveAttribute('aria-haspopup');
  });

  it('closes the popover when focus leaves it', async () => {
    await overflowing();
    const more = screen.getByRole('button', { name: 'More' });
    await fireEvent.click(more);
    const link = screen.getByRole('link', { name: 'Collocations' });
    await fireEvent.focusOut(link, { relatedTarget: document.body });
    await tick();
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });
});
