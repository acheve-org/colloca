import type { LanguageSetting } from './types';

/** The state a language's status dot shows. */
export type Dot = 'ok' | 'busy' | 'error' | 'missing';

/** The model, OCR and base-corpus dots of a language in the Languages list. */
export function langStatus(r: LanguageSetting, hasBase: boolean): { model: Dot; ocr: Dot; base: Dot } {
  const model: Dot =
    r.model.state === 'installing' ? 'busy' : r.model.state === 'failed' ? 'error' : r.model.name ? 'ok' : 'missing';
  const ocr: Dot = r.ocr.available ? 'ok' : r.ocr.state === 'installing' ? 'busy' : r.ocr.state === 'failed' ? 'error' : 'missing';
  return { model, ocr, base: hasBase ? 'ok' : 'missing' };
}
