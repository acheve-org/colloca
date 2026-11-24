import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ModelStatus from '../src/lib/ui/ModelStatus.svelte';

const model = (lang: string, size: string) => ({
  name: `${lang}_core_news_${size}`, version: '3.8.0', size, small: size === 'sm',
});

function stub(models: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, statusText: 'ok', json: async () => ({ spacy: '3.8.0', models }),
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe('ModelStatus', () => {
  it('shows the model for each language without a warning for lg', async () => {
    stub({ es: model('es', 'lg'), it: model('it', 'lg') });
    render(ModelStatus);
    await waitFor(() => expect(screen.getByText(/es_core_news_lg 3.8.0/)).toBeTruthy());
    expect(screen.getByText(/it_core_news_lg 3.8.0/)).toBeTruthy();
    expect(screen.queryByText(/small model/)).toBeNull();
  });

  it('warns for a language on a small model', async () => {
    stub({ es: model('es', 'sm'), it: model('it', 'lg') });
    render(ModelStatus);
    await waitFor(() => expect(screen.getByText(/small model/)).toBeTruthy());
    expect(screen.getAllByText(/small model/)).toHaveLength(1);
  });

  it('flags a missing model', async () => {
    stub({ es: { name: null, version: null, size: null, small: false }, it: model('it', 'md') });
    render(ModelStatus);
    await waitFor(() => expect(screen.getByText(/no model installed/)).toBeTruthy());
  });
});
