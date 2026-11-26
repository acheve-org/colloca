import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setViewportForTests } from '../src/lib/viewport.svelte';
import ListPanelHost from './ListPanelHost.svelte';

afterEach(() => {
  __setViewportForTests({ stacked: false });
});

describe('ListPanel', () => {
  it('wide: shows the list and the panel side by side, with no Back button', () => {
    __setViewportForTests({ stacked: false });
    render(ListPanelHost, { showPanel: false });
    expect(screen.getByText('the list')).toBeInTheDocument();
    expect(screen.getByText('the panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('names the list column navigation by its label', () => {
    render(ListPanelHost);
    expect(screen.getByRole('navigation', { name: 'Projects' })).toContainElement(screen.getByText('the list'));
  });

  it('stacked without showPanel: shows only the list', () => {
    __setViewportForTests({ stacked: true });
    render(ListPanelHost, { showPanel: false });
    expect(screen.getByRole('navigation', { name: 'Projects' })).toContainElement(screen.getByText('the list'));
    expect(screen.queryByText('the panel')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('stacked with showPanel: shows only the panel and a Back button that calls onback', async () => {
    __setViewportForTests({ stacked: true });
    const onback = vi.fn();
    render(ListPanelHost, { showPanel: true, onback });
    expect(screen.getByText('the panel')).toBeInTheDocument();
    expect(screen.queryByText('the list')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onback).toHaveBeenCalledOnce();
  });
});
