import { describe, expect, it } from 'vitest';
import { langStatus } from '../src/lib/langStatus';
import type { LanguageSetting } from '../src/lib/types';

type Model = Partial<LanguageSetting['model']>;
type Ocr = Partial<LanguageSetting['ocr']>;
const lang = (model: Model = {}, ocr: Ocr = {}, over: Partial<LanguageSetting> = {}): LanguageSetting => ({
  code: 'es', name: 'Spanish', model_size: null, tesseract: 'spa', corpus_count: 0,
  model: { name: 'es_core_news_md', version: '3.8.0', size: 'md', small: false, state: 'idle', message: '', ...model },
  ocr: { engine: true, tesseract: 'spa', available: true, state: 'idle', message: '', ...ocr },
  ...over,
});

describe('langStatus', () => {
  it('model: installed is ok', () => expect(langStatus(lang(), false).model).toBe('ok'));
  it('model: installing is busy', () => expect(langStatus(lang({ name: null, state: 'installing' }), false).model).toBe('busy'));
  it('model: installing over an installed one is busy', () => expect(langStatus(lang({ state: 'installing' }), false).model).toBe('busy'));
  it('model: failed is error', () => expect(langStatus(lang({ name: null, state: 'failed', message: 'x' }), false).model).toBe('error'));
  it('model: failed over an installed one is error', () => expect(langStatus(lang({ state: 'failed' }), false).model).toBe('error'));
  it('model: not installed is missing', () => expect(langStatus(lang({ name: null, version: null, size: null }), false).model).toBe('missing'));

  it('ocr: available is ok', () => expect(langStatus(lang(), false).ocr).toBe('ok'));
  it('ocr: installing is busy', () => expect(langStatus(lang({}, { available: false, state: 'installing' }), false).ocr).toBe('busy'));
  it('ocr: failed is error', () => expect(langStatus(lang({}, { available: false, state: 'failed', message: 'x' }), false).ocr).toBe('error'));
  it('ocr: no engine is missing', () => expect(langStatus(lang({}, { engine: false, available: false }), false).ocr).toBe('missing'));
  it('ocr: no OCR code is missing', () => expect(langStatus(lang({}, { tesseract: '', available: false }, { tesseract: '' }), false).ocr).toBe('missing'));
  it('ocr: data not installed is missing', () => expect(langStatus(lang({}, { available: false }), false).ocr).toBe('missing'));

  it('base: a reference corpus is ok', () => expect(langStatus(lang(), true).base).toBe('ok'));
  it('base: no reference corpus is missing', () => expect(langStatus(lang(), false).base).toBe('missing'));
});
