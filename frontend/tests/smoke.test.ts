import { render, screen } from '@testing-library/svelte';
import { expect, test } from 'vitest';
import App from '../src/App.svelte';

test('app renders its name', () => {
  render(App);
  expect(screen.getByText('Corpora')).toBeInTheDocument();
});
