import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Logo from '../src/lib/ui/Logo.svelte';
import Rail from '../src/lib/ui/Rail.svelte';

describe('Logo', () => {
  it('draws both hands of the heart by default, hidden from assistive tech', () => {
    const { container } = render(Logo);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelectorAll('path')).toHaveLength(2);
    expect(svg.querySelector('path.right')).not.toBeNull();
  });

  it('draws only the left hand (the C) when half', () => {
    const { container } = render(Logo, { half: true, size: 20 });
    const svg = container.querySelector('svg')!;
    expect(svg.querySelectorAll('path')).toHaveLength(1);
    expect(svg).toHaveAttribute('width', '20');
  });

  it('heads the rail, named for screen readers', () => {
    const { container } = render(Rail);
    const brand = container.querySelector('.brand')!;
    expect(brand.querySelector('svg.logo')).not.toBeNull();
    expect(brand.textContent?.trim()).toBe('Corpora');
  });
});
