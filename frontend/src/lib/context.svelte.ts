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

const languageNames = $state<{ names: Languages }>({ names: {} });

/** Loads the language names once per call; the Rail does it on mount. */
export async function loadLanguageNames(): Promise<void> {
  languageNames.names = await get<Languages>('/api/languages');
  tried = {};
}

// Codes already looked up without success: one reload per missing code, not one per render.
let tried: Record<string, true> = {};

/**
 * Reloads the names when the working corpus's language is not in the map (a language added
 * since the last load). Asks at most once per code; a failing load keeps the code as the name.
 */
export async function ensureLanguageName(): Promise<void> {
  const lang = corpusStore.current?.lang;
  if (!lang || lang in languageNames.names || lang in tried) return;
  tried[lang] = true;
  try {
    await loadLanguageNames();
  } catch {
    // The code stays as the name.
  }
}

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
