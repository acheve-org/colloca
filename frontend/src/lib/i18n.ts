import { locale } from './locale.svelte';
import { en } from './locales/en';
import { es } from './locales/es';
import { it } from './locales/it';
import type { Messages } from './locales/types';

export { LANGS, LANG_NAMES, locale, setLang } from './locale.svelte';
export type { Lang } from './locale.svelte';

export const catalogues: Record<'en' | 'es' | 'it', Messages> = { en, es, it };

/**
 * Look up a UI string in the current language; `{name}` placeholders are filled from vars.
 * A key missing from the language falls back to English; an unknown key returns the key.
 * Reading `locale.code` makes every template that calls `t` re-render when the language changes.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const s = catalogues[locale.code][key] ?? en[key];
  if (s === undefined) return key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** A number in the conventions of the interface language (1.234,5 in es and it; 1,234.5 in en). */
export function fmt(n: number, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(locale.code, opts);
}
