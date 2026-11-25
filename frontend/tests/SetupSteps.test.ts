import { render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../src/lib/i18n';
import type { SetupStep } from '../src/lib/setup.svelte';
import SetupSteps from '../src/lib/ui/SetupSteps.svelte';

beforeEach(() => setLang('en'));
afterEach(() => setLang('en'));

const items = () => screen.getAllByRole('listitem');
const links = () => screen.queryAllByRole('link');

describe('SetupSteps', () => {
  it('is an ordered list of the three steps', () => {
    const { container } = render(SetupSteps, { props: { step: 'language' } });
    expect(container.querySelector('ol')).not.toBeNull();
    expect(items().map((li) => li.querySelector('.title')?.textContent)).toEqual([
      'Add a language',
      'Start a project',
      'Create a corpus',
    ]);
  });

  it('language: step 1 is current with a link to Languages, steps 2 and 3 are dimmed', () => {
    render(SetupSteps, { props: { step: 'language' } });
    const [one, two, three] = items();
    expect(one).toHaveAttribute('aria-current', 'step');
    expect(one).toHaveAttribute('data-state', 'current');
    expect(within(one).getByRole('link', { name: 'Add language' })).toHaveAttribute('href', '#/languages');
    expect(two).toHaveAttribute('data-state', 'later');
    expect(three).toHaveAttribute('data-state', 'later');
    expect(two).not.toHaveAttribute('aria-current');
    expect(within(two).queryByText('done')).toBeNull();
    expect(links()).toHaveLength(1);
  });

  it('project: step 1 is done (visually hidden "done"), step 2 is current with a link to Projects', () => {
    render(SetupSteps, { props: { step: 'project' } });
    const [one, two, three] = items();
    expect(one).toHaveAttribute('data-state', 'done');
    expect(within(one).getByText('done')).toBeInTheDocument();
    expect(within(one).queryByRole('link')).toBeNull();
    expect(two).toHaveAttribute('aria-current', 'step');
    expect(within(two).getByRole('link', { name: 'New project' })).toHaveAttribute('href', '#/projects');
    expect(three).toHaveAttribute('data-state', 'later');
    expect(links()).toHaveLength(1);
  });

  it('corpus: steps 1 and 2 are done, step 3 is current with a link to Projects', () => {
    render(SetupSteps, { props: { step: 'corpus' } });
    const [one, two, three] = items();
    expect(one).toHaveAttribute('data-state', 'done');
    expect(two).toHaveAttribute('data-state', 'done');
    expect(within(two).getByText('done')).toBeInTheDocument();
    expect(three).toHaveAttribute('aria-current', 'step');
    expect(within(three).getByRole('link', { name: 'New corpus' })).toHaveAttribute('href', '#/projects');
    expect(three.querySelector('[data-state="done"]')).toBeNull();
    expect(links()).toHaveLength(1);
  });

  it('every step shows its hint text', () => {
    render(SetupSteps, { props: { step: 'corpus' } });
    expect(screen.getByText('Choose the working languages before you create corpora.')).toBeInTheDocument();
    expect(screen.getByText('A project groups the corpora of one client or job.')).toBeInTheDocument();
    expect(screen.getByText('Corpora hold your sources. Create one in a project to start working.')).toBeInTheDocument();
  });

  it.each<SetupStep>(['language', 'project', 'corpus'])('%s: marks the done check glyph as decorative', (step) => {
    const { container } = render(SetupSteps, { props: { step } });
    for (const mark of container.querySelectorAll('.mark')) {
      expect(mark).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
