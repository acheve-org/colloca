import { describe, expect, it } from 'vitest';
import { SCREENS } from '../src/lib/router.svelte';
import { AREAS, areaOf, fitTabs, visibleTabs } from '../src/lib/nav';

describe('nav model', () => {
  it('every screen belongs to exactly one area', () => {
    const all = AREAS.flatMap((a) => a.tabs);
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(SCREENS));
  });

  it('areaOf maps screens', () => {
    expect(areaOf('keyness')).toBe('explore');
    expect(areaOf('trash')).toBe('settings');
    expect(areaOf('sources')).toBe('corpus');
    expect(areaOf('job')).toBe('job');
  });

  it('settings tabs are Languages, Projects, Backup and Trash', () => {
    expect(visibleTabs('settings', false)).toEqual(['languages', 'projects', 'trash']);
  });

  it('visibleTabs hides aligned-only tabs', () => {
    const plain = visibleTabs('explore', false);
    expect(plain).toHaveLength(8);
    expect(plain).not.toContain('equivalents');
    expect(plain).not.toContain('lookup');
    const aligned = visibleTabs('explore', true);
    expect(aligned).toHaveLength(10);
    expect(aligned.slice(-2)).toEqual(['equivalents', 'lookup']);
  });

  it('settings is the bottom area', () => {
    expect(AREAS.filter((a) => a.bottom).map((a) => a.id)).toEqual(['settings']);
  });

  it('fitTabs shows everything that fits', () => {
    expect(fitTabs([50, 50, 50], 200, 0, 40)).toEqual([0, 1, 2]);
  });

  it('fitTabs reserves room for More and folds the rest', () => {
    expect(fitTabs([100, 100, 100, 100], 250, 0, 50)).toEqual([0, 1]);
  });

  it('fitTabs keeps the active tab shown by replacing the last one', () => {
    expect(fitTabs([100, 100, 100, 100], 250, 3, 50)).toEqual([0, 3]);
    expect(fitTabs([100, 100, 100, 100], 250, 1, 50)).toEqual([0, 1]);
  });

  it('fitTabs shows the active tab even when nothing fits', () => {
    expect(fitTabs([100, 100, 100], 50, 2, 40)).toEqual([2]);
  });

  it('fitTabs drops tabs until the swapped-in active tab and More fit', () => {
    expect(fitTabs([75, 90, 233], 310, 2, 48)).toEqual([2]);
    expect(fitTabs([50, 50, 50, 200], 250, 3, 40)).toEqual([3]);
    expect(fitTabs([50, 50, 50, 120], 250, 3, 40)).toEqual([0, 3]);
  });

  it('fitTabs keeps only the active tab when it alone overflows', () => {
    expect(fitTabs([75, 90, 400], 310, 2, 48)).toEqual([2]);
  });
});
