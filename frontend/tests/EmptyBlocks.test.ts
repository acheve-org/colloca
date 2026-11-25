import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../src/lib/i18n';
import EmptyCard from '../src/lib/ui/EmptyCard.svelte';
import LinkButton from '../src/lib/ui/LinkButton.svelte';
import NoCorpus from '../src/lib/ui/NoCorpus.svelte';
import ReadyHint from '../src/lib/ui/ReadyHint.svelte';

const raw = (html: string) => createRawSnippet(() => ({ render: () => html }));

beforeEach(() => setLang('en'));
afterEach(() => setLang('en'));

describe('EmptyCard', () => {
  it('renders title, hint, reasons, actions and footer', () => {
    const { container } = render(EmptyCard, {
      props: {
        icon: 'none',
        title: 'No hits',
        hint: 'Try another form.',
        reasons: ['Lemma is on', 'The filter hides a document'],
        actions: raw('<button>Search again</button>'),
        footer: raw('<a href="#/help">How it works</a>'),
      },
    });
    expect(screen.getByText('No hits')).toBeInTheDocument();
    expect(screen.getByText('Try another form.')).toBeInTheDocument();
    const items = container.querySelectorAll('li');
    expect([...items].map((li) => li.textContent)).toEqual(['Lemma is on', 'The filter hides a document']);
    expect(screen.getByRole('button', { name: 'Search again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How it works' })).toBeInTheDocument();
  });

  it('hides its icon from assistive technology', () => {
    const { container } = render(EmptyCard, { props: { icon: 'book', title: 'Empty' } });
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('has no status role unless live', () => {
    const { container, unmount } = render(EmptyCard, { props: { title: 'Quiet' } });
    expect(container.querySelector('[role="status"]')).toBeNull();
    unmount();
    const live = render(EmptyCard, { props: { title: 'Live', live: true } });
    expect(live.container.querySelector('[role="status"]')).not.toBeNull();
  });
});

describe('ReadyHint', () => {
  it('renders title and hint without a role and without chips', () => {
    const { container } = render(ReadyHint, { props: { title: 'Word frequencies', hint: 'Press Show to list words.' } });
    expect(screen.getByText('Word frequencies')).toBeInTheDocument();
    expect(screen.getByText('Press Show to list words.')).toBeInTheDocument();
    expect(container.querySelector('[role]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Try:')).toBeNull();
  });

  it('shows the try label and chips that call onclick', async () => {
    const onclick = vi.fn();
    render(ReadyHint, {
      props: { title: 'Frequency', tries: [{ label: 'only nouns', onclick }] },
    });
    expect(screen.getByText('Try:')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'only nouns' }));
    expect(onclick).toHaveBeenCalledTimes(1);
  });
});

describe('LinkButton', () => {
  it('renders a link with the href and the variant class', () => {
    render(LinkButton, { props: { href: '#/projects', variant: 'primary', children: raw('Go') } });
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link).toHaveAttribute('href', '#/projects');
    expect(link).toHaveClass('primary');
  });

  it('defaults to the default variant', () => {
    render(LinkButton, { props: { href: '#/x', children: raw('Other') } });
    expect(screen.getByRole('link', { name: 'Other' })).toHaveClass('default');
  });
});

describe('NoCorpus', () => {
  it('asks for a corpus and links to the projects screen', () => {
    render(NoCorpus);
    expect(screen.getByText('Create or select a corpus first.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose a corpus' })).toHaveAttribute('href', '#/projects');
  });
});
