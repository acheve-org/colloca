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
