import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../src/lib/i18n';
import type { Doc } from '../src/lib/types';
import CorpusSizeGauge from '../src/lib/ui/CorpusSizeGauge.svelte';

const doc = (id: number, title: string, n_tokens: number) => ({ id, title, n_tokens }) as Doc;
const balanced = [doc(1, 'A', 60_800), doc(2, 'B', 60_800), doc(3, 'C', 60_800)]; // 182,400 words
const lopsided = [doc(1, 'Investigator brochure v4', 83_904), doc(2, 'B', 49_248), doc(3, 'C', 49_248)];

afterEach(() => setLang('en'));

const pill = () => screen.getByRole('button');
const popover = () => screen.queryByRole('group');

describe('CorpusSizeGauge', () => {
  it('renders nothing without documents or words', () => {
    const { container } = render(CorpusSizeGauge, { docs: [] });
    expect(container.querySelector('*')).toBeNull(); // only Svelte's comment anchors
    render(CorpusSizeGauge, { docs: [doc(1, 'Empty', 0)] });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the compact size and band on a collapsed pill', () => {
    render(CorpusSizeGauge, { docs: balanced });
    expect(pill()).toHaveTextContent('182k words · workable');
    expect(pill()).toHaveAttribute('aria-expanded', 'false');
    expect(pill()).not.toHaveAttribute('aria-haspopup');
    expect(pill().className).not.toMatch(/\bwarn\b/);
    expect(popover()).toBeNull();
  });

  it('opens the readiness popover, labelled by its heading', async () => {
    render(CorpusSizeGauge, { docs: balanced });
    await fireEvent.click(pill());
    expect(pill()).toHaveAttribute('aria-expanded', 'true');
    expect(popover()!.id).not.toBe('');
    expect(pill()).toHaveAttribute('aria-controls', popover()!.id);
    const g = screen.getByRole('group', { name: '182,400 words: enough for most analyses on core terms.' });
    expect(g).toHaveTextContent('Concordance, frequency');
    expect(g).toHaveTextContent('✓ core terms');
    expect(g).toHaveTextContent('~ rough below 200,000');
    expect(g).toHaveTextContent('Next band (solid) at 250,000: about 67,600 more words.');
    expect(g).not.toHaveTextContent('of the words');
  });

  it('closes with Esc and returns focus to the pill', async () => {
    render(CorpusSizeGauge, { docs: balanced });
    pill().focus();
    await fireEvent.click(pill());
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(popover()).toBeNull();
    expect(pill()).toHaveAttribute('aria-expanded', 'false');
    expect(pill()).toHaveFocus();
  });

  it('closes on a click outside', async () => {
    render(CorpusSizeGauge, { docs: balanced });
    await fireEvent.click(pill());
    await fireEvent.pointerDown(document.body);
    expect(popover()).toBeNull();
  });

  it('turns amber when the corpus is small', () => {
    render(CorpusSizeGauge, { docs: [doc(1, 'A', 12_000)] });
    expect(pill().className).toMatch(/\bwarn\b/);
  });

  it('turns amber and names the dominant document when unbalanced', async () => {
    render(CorpusSizeGauge, { docs: lopsided });
    expect(pill().className).toMatch(/\bwarn\b/);
    await fireEvent.click(pill());
    expect(popover()).toHaveTextContent('“Investigator brochure v4” holds 46% of the words, so its wording will dominate lists.');
  });

  it('speaks Spanish', async () => {
    setLang('es');
    render(CorpusSizeGauge, { docs: balanced });
    expect(pill()).toHaveTextContent('182 mil palabras · manejable');
    await fireEvent.click(pill());
    expect(screen.getByRole('group', { name: /^182\.400 palabras: / })).toHaveTextContent('Concordancia, frecuencia');
  });
});
