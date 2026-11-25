import { render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AddDocuments from '../src/screens/AddDocuments.svelte';
import Candidates from '../src/screens/Candidates.svelte';
import CheckText from '../src/screens/CheckText.svelte';
import Concordance from '../src/screens/Concordance.svelte';
import ExploreScreen from '../src/screens/ExploreScreen.svelte';
import Job from '../src/screens/Job.svelte';
import SegmentLookup from '../src/screens/SegmentLookup.svelte';
import Sources from '../src/screens/Sources.svelte';
import { setLang } from '../src/lib/i18n';
import { corpusStore } from '../src/lib/corpus.svelte';

type AnyScreen = Component<Record<string, unknown>>;

const screensUnderTest = {
  Candidates,
  SegmentLookup,
  CheckText,
  Concordance,
  ExploreScreen,
  Job,
  Sources,
  AddDocuments,
} as unknown as Record<string, AnyScreen>;

const CARD_TEXT = 'Create or select a corpus first.';
const LINK_TEXT = 'Choose a corpus';

beforeEach(() => {
  setLang('en');
  corpusStore.list = [];
  corpusStore.currentId = null;
});
afterEach(() => {
  setLang('en');
  corpusStore.loaded = false;
});

describe.each(Object.entries(screensUnderTest))('%s without a corpus', (_name, Screen) => {
  it('shows the choose-a-corpus card with a link to projects', () => {
    corpusStore.loaded = true;
    render(Screen);
    expect(screen.getByText(CARD_TEXT)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: LINK_TEXT });
    expect(link).toHaveAttribute('href', '#/projects');
  });

  it('shows nothing while the corpus list is still loading', () => {
    corpusStore.loaded = false;
    render(Screen);
    expect(screen.queryByText(CARD_TEXT)).toBeNull();
    expect(screen.queryByRole('link', { name: LINK_TEXT })).toBeNull();
  });

  it('no longer renders the old centered EmptyState markup', () => {
    corpusStore.loaded = true;
    const { container } = render(Screen);
    expect(container.querySelector('.empty')).toBeNull();
  });
});
