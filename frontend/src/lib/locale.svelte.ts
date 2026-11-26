/** The interface language: a reactive choice, remembered in localStorage, defaulting to the browser's language. */
export type Lang = 'en' | 'es' | 'it';

export const LANGS: readonly Lang[] = ['en', 'es', 'it'];

/** Endonyms: each language is named in itself, so a user can always find theirs. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', es: 'Español', it: 'Italiano' };

const KEY = 'corpora.lang';

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

function read(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (isLang(v)) return v;
  } catch {
    // storage unavailable: fall through to the browser language
  }
  const prefs = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]);
  for (const p of prefs) {
    const short = String(p).slice(0, 2).toLowerCase();
    if (isLang(short)) return short;
  }
  return 'en';
}

function apply(code: Lang): void {
  if (typeof document !== 'undefined') document.documentElement.lang = code;
}

export const locale = $state<{ code: Lang }>({ code: read() });
apply(locale.code);

export function setLang(code: Lang): void {
  locale.code = code;
  apply(code);
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // the choice just won't persist
  }
}
