import { get } from './api';
import { corpusStore } from './corpus.svelte';
import { projectOf } from './projects.svelte';
import type { Corpus, Languages, Project } from './types';

/** Where the user is working: the language of the working corpus, its project and the corpus. */
export interface WorkingContext {
  language: string;
  languageName: string;
  project: Project | null;
  corpus: Corpus;
}

const languageNames = $state<{ names: Languages; loaded: boolean; failed: boolean }>({
  names: {},
  loaded: false,
  failed: false,
});

/** True once the language list has been read (so "no languages" is not a loading flash). */
export const languagesLoaded = (): boolean => languageNames.loaded;
/** True when the last read of the language list failed (no first-run claim then). */
export const languagesFailed = (): boolean => languageNames.failed;
export const languageCount = (): number => Object.keys(languageNames.names).length;

// Codes already looked up by ensureLanguageName without success: one reload per missing code.
let tried: Record<string, true> = {};

async function fetchNames(): Promise<void> {
  try {
    languageNames.names = await get<Languages>('/api/languages');
    languageNames.failed = false;
  } catch (err) {
    languageNames.failed = true;
    throw err;
  } finally {
    languageNames.loaded = true;
  }
}

/** Explicit refresh (Rail mount, Languages screen changes): reads the names and lets missing codes be retried. */
export async function loadLanguageNames(): Promise<void> {
  await fetchNames();
  tried = {};
}

/**
 * Reloads the names when the working corpus's language is not in the map (a language added
 * since the last load). Asks at most once per code, even when the API succeeds without it;
 * a failing load keeps the code as the name.
 */
export async function ensureLanguageName(): Promise<void> {
  const lang = corpusStore.current?.lang;
  if (!lang || lang in languageNames.names || lang in tried) return;
  tried[lang] = true;
  try {
    await fetchNames();
  } catch {
    // The code stays as the name.
  }
}

/** The language's name, or its code while the names are not loaded or the code is unknown. */
export const languageName = (code: string): string => languageNames.names[code] ?? code;

export function workingContext(): WorkingContext | null {
  const corpus = corpusStore.current;
  if (!corpus) return null;
  return {
    language: corpus.lang,
    languageName: languageNames.names[corpus.lang] ?? corpus.lang,
    project: projectOf(corpus),
    corpus,
  };
}
