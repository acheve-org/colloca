import { describe, expect, it } from 'vitest';
import { SCREENS } from '../src/lib/router.svelte';
import { AREAS, areaOf, visibleTabs } from '../src/lib/nav';

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
});
